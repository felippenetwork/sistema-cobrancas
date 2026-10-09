// Regressão: se a consulta da parcela falhava, resolverVariaveis formatava `R$ 0,00`
// e a mensagem de cobrança seguia para o cliente com o valor errado.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'
import { resolverVariaveis, resolverVariaveisLeves, VariaveisIndisponiveisError } from '@/lib/whatsapp/resolver-variaveis'

const CONTA = 'conta-1'
const OUTRA = 'conta-2'

function cenario() {
  const db = new FakeDb({
    parcelas: [
      { id: 'p1', conta_id: CONTA, valor: 1234.5, data_vencimento: '2026-10-05' },
      { id: 'p-outra', conta_id: OUTRA, valor: 99, data_vencimento: '2026-10-05' },
    ],
    clientes: [
      { id: 'c1', conta_id: CONTA, nome: 'Maria', sobrenome: 'Silva' },
      { id: 'c-outra', conta_id: OUTRA, nome: 'Intruso', sobrenome: 'X' },
    ],
    saudacoes: [{ conta_id: CONTA, texto: 'Oi, tudo bem?' }],
    cobrancas: [{ id: 'cob1', conta_id: CONTA, meio_pagamento_id: 'm1' }],
    meios_pagamento: [
      { id: 'm1', conta_id: CONTA, mensagem: 'Pix da cobrança', is_padrao: false },
      { id: 'm2', conta_id: CONTA, mensagem: 'Pix padrão', is_padrao: true },
    ],
  })
  return { db, supabase: db.cliente() as any }
}

const base = { contaId: CONTA, parcelaId: 'p1', clienteId: 'c1' }

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('resolverVariaveis', () => {
  it('substitui valor, vencimento, nome e saudação', async () => {
    const { supabase } = cenario()
    const texto = await resolverVariaveis(supabase, {
      ...base, template: '#SAUDACAO# #NOME#! Fatura de #VALOR# vence em #VENCIMENTO#.',
    })
    expect(texto).toMatch(/^Oi, tudo bem\? Maria! Fatura de R\$\s1\.234,50 vence em 05\/10\/2026\.$/)
  })

  it('#NOMECOMPLETO# junta nome e sobrenome', async () => {
    const { supabase } = cenario()
    expect(await resolverVariaveis(supabase, { ...base, template: '#NOMECOMPLETO#' })).toBe('Maria Silva')
  })

  it('erro ao consultar a parcela lança erro_banco — NUNCA manda R$ 0,00', async () => {
    const { db, supabase } = cenario()
    db.falhas.push({ tabela: 'parcelas', operacao: 'select', vezes: 1 })
    const chamada = resolverVariaveis(supabase, { ...base, template: 'Fatura de #VALOR#' })
    await expect(chamada).rejects.toBeInstanceOf(VariaveisIndisponiveisError)
    // a falha foi consumida: a chamada seguinte funciona normalmente
    await expect(resolverVariaveis(supabase, { ...base, template: '#VALOR#' })).resolves.toMatch(/1\.234,50/)
  })

  it('parcela inexistente lança nao_encontrado', async () => {
    const { supabase } = cenario()
    await expect(resolverVariaveis(supabase, { ...base, parcelaId: 'sumiu', template: '#VALOR#' }))
      .rejects.toMatchObject({ motivo: 'nao_encontrado' })
  })

  it('parcela de OUTRA conta lança nao_encontrado (não vaza valor de outro tenant)', async () => {
    const { supabase } = cenario()
    await expect(resolverVariaveis(supabase, { ...base, parcelaId: 'p-outra', template: '#VALOR#' }))
      .rejects.toMatchObject({ motivo: 'nao_encontrado' })
  })

  it('cliente de OUTRA conta lança nao_encontrado (não usa o nome de outro tenant)', async () => {
    const { supabase } = cenario()
    await expect(resolverVariaveis(supabase, { ...base, clienteId: 'c-outra', template: '#NOME#' }))
      .rejects.toMatchObject({ motivo: 'nao_encontrado' })
  })

  it('erro ao consultar o cliente lança erro_banco', async () => {
    const { db, supabase } = cenario()
    db.falhas.push({ tabela: 'clientes', operacao: 'select', vezes: 1 })
    await expect(resolverVariaveis(supabase, { ...base, template: '#NOME#' })).rejects.toMatchObject({ motivo: 'erro_banco' })
  })

  it('falha nas saudações é cosmética: usa "Olá!" e segue', async () => {
    const { db, supabase } = cenario()
    db.falhas.push({ tabela: 'saudacoes', operacao: 'select', vezes: 1 })
    expect(await resolverVariaveis(supabase, { ...base, template: '#SAUDACAO#' })).toBe('Olá!')
  })

  // Bug relatado pelo Felippe (2026-10-08): no modal "Confirmar Pagamento", a data escolhida em
  // "Próximo pagamento" não aparecia na mensagem enviada ao cliente. Causa: #VENCIMENTO# sempre
  // vinha da parcela que acabou de ser paga (a amarrada à notificação), nunca da próxima parcela em
  // aberto — que é a data que o dono efetivamente escolheu/gerou na tela.
  describe('#VENCIMENTO# em pagamento_confirmado', () => {
    function cenarioComProxima() {
      const { db, supabase } = cenario()
      db.linhas('parcelas').push(
        { id: 'p2', conta_id: CONTA, cobranca_id: 'cob1', numero: 2, valor: 1234.5, data_vencimento: '2026-12-25', status: 'aberta' },
      )
      db.linhas('parcelas')[0].cobranca_id = 'cob1'
      db.linhas('parcelas')[0].numero = 1
      db.linhas('parcelas')[0].status = 'paga'
      return { db, supabase }
    }

    it('usa o vencimento da PRÓXIMA parcela em aberto da cobrança, não o da parcela paga', async () => {
      const { supabase } = cenarioComProxima()
      const texto = await resolverVariaveis(supabase, {
        ...base, cobrancaId: 'cob1', tipo: 'pagamento_confirmado', template: 'vence em #VENCIMENTO#',
      })
      expect(texto).toBe('vence em 25/12/2026')
    })

    it('sem próxima parcela em aberto (última de uma cobrança fixa): cai no vencimento da parcela paga', async () => {
      const { db, supabase } = cenario()
      db.linhas('parcelas')[0].cobranca_id = 'cob1'
      db.linhas('parcelas')[0].status = 'paga'
      const texto = await resolverVariaveis(supabase, {
        ...base, cobrancaId: 'cob1', tipo: 'pagamento_confirmado', template: 'vence em #VENCIMENTO#',
      })
      expect(texto).toBe('vence em 05/10/2026')
    })

    it('outros tipos (lembrete, manual) continuam usando o vencimento da PRÓPRIA parcela — não regride', async () => {
      const { supabase } = cenarioComProxima()
      const texto = await resolverVariaveis(supabase, {
        ...base, cobrancaId: 'cob1', tipo: '3d', template: 'vence em #VENCIMENTO#',
      })
      expect(texto).toBe('vence em 05/10/2026')
    })

    it('sem #VENCIMENTO# no template não consulta a próxima parcela (nada para falhar por dado não usado)', async () => {
      const { db, supabase } = cenarioComProxima()
      db.falhas.push({ tabela: 'parcelas', operacao: 'select', quando: c => c.filtros.some(f => f.col === 'status' && f.val === 'aberta'), vezes: 99 })
      await expect(resolverVariaveis(supabase, { ...base, cobrancaId: 'cob1', tipo: 'pagamento_confirmado', template: '#NOME#' })).resolves.toBe('Maria')
    })

    it('erro ao consultar a próxima parcela lança erro_banco (nunca manda a data da parcela errada por engano)', async () => {
      const { db, supabase } = cenarioComProxima()
      db.falhas.push({ tabela: 'parcelas', operacao: 'select', quando: c => c.filtros.some(f => f.col === 'status' && f.val === 'aberta'), vezes: 1 })
      await expect(resolverVariaveis(supabase, { ...base, cobrancaId: 'cob1', tipo: 'pagamento_confirmado', template: '#VENCIMENTO#' }))
        .rejects.toMatchObject({ motivo: 'erro_banco' })
    })
  })

  describe('#PIX#', () => {
    it('sem #PIX# no template não consulta meios de pagamento (nada para falhar por dado não usado)', async () => {
      const { db, supabase } = cenario()
      db.falhas.push({ tabela: 'meios_pagamento', operacao: 'select', vezes: 99 })
      await expect(resolverVariaveis(supabase, { ...base, template: '#NOME#' })).resolves.toBe('Maria')
      expect(db.consultas.filter(c => c.tabela === 'meios_pagamento')).toHaveLength(0)
    })

    it('usa o meio de pagamento da cobrança quando informado', async () => {
      const { supabase } = cenario()
      expect(await resolverVariaveis(supabase, { ...base, cobrancaId: 'cob1', template: '#PIX#' })).toBe('Pix da cobrança')
    })

    it('sem cobrança, usa o meio padrão da conta', async () => {
      const { supabase } = cenario()
      expect(await resolverVariaveis(supabase, { ...base, template: '#PIX#' })).toBe('Pix padrão')
    })

    it('nenhum meio configurado → "(Pix não configurado)"', async () => {
      const { db, supabase } = cenario()
      db.linhas('meios_pagamento').length = 0
      expect(await resolverVariaveis(supabase, { ...base, template: '#PIX#' })).toBe('(Pix não configurado)')
    })

    it('erro ao consultar o meio de pagamento lança erro_banco (não manda "Pix não configurado" por engano)', async () => {
      const { db, supabase } = cenario()
      db.falhas.push({ tabela: 'meios_pagamento', operacao: 'select', vezes: 1 })
      await expect(resolverVariaveis(supabase, { ...base, template: '#PIX#' })).rejects.toMatchObject({ motivo: 'erro_banco' })
    })
  })
})

describe('resolverVariaveisLeves', () => {
  it('substitui nome, nome completo e saudação', async () => {
    const { supabase } = cenario()
    const texto = await resolverVariaveisLeves(supabase, { contaId: CONTA, clienteId: 'c1', template: '#SAUDACAO# #NOMECOMPLETO#' })
    expect(texto).toBe('Oi, tudo bem? Maria Silva')
  })

  it('cliente inexistente / de outra conta lança nao_encontrado', async () => {
    const { supabase } = cenario()
    await expect(resolverVariaveisLeves(supabase, { contaId: CONTA, clienteId: 'c-outra', template: '#NOME#' }))
      .rejects.toMatchObject({ motivo: 'nao_encontrado' })
  })

  it('erro ao consultar o cliente lança erro_banco', async () => {
    const { db, supabase } = cenario()
    db.falhas.push({ tabela: 'clientes', operacao: 'select', vezes: 1 })
    await expect(resolverVariaveisLeves(supabase, { contaId: CONTA, clienteId: 'c1', template: '#NOME#' }))
      .rejects.toMatchObject({ motivo: 'erro_banco' })
  })
})
