// Regressão (relatada pelo Felippe, 2026-10-08, com print do modal "Confirmar Pagamento"): a data
// escolhida em "Próximo pagamento" não aparecia na mensagem de confirmação enviada ao cliente.
// Causa raiz dupla: (1) o #VENCIMENTO# do template sempre vinha da parcela que acabou de ser paga,
// nunca da próxima em aberto (corrigido em resolver-variaveis.ts/resolverVariaveis — ver
// tests/resolver-variaveis.test.ts); (2) mesmo corrigindo (1), a ordem das operações enviava a
// confirmação ANTES de a próxima parcela existir no banco — corrigido aqui: a geração da próxima
// parcela roda antes do envio.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => ({
  db: { atual: null as unknown },
  usuario: { atual: { id: 'user-1' } as { id: string } | null },
  enviarWhatsAppImediato: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    ...(mocks.db.atual as object),
    auth: { getUser: async () => ({ data: { user: mocks.usuario.atual } }) },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))
vi.mock('@/lib/whatsapp/enviar-imediato', () => ({ enviarWhatsAppImediato: mocks.enviarWhatsAppImediato }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { baixarParcelaComConfirmacaoAction } from '@/app/(app)/cobrancas/_actions/parcelas'

// baixarParcelaComConfirmacaoAction valida formato UUID (v4: versão e variante corretas) antes de
// qualquer lógica — ids precisam parecer UUID de verdade (diferente de outros testes de FakeDb que
// usam ids livres, onde isso não é validado).
const CONTA    = '11111111-1111-4111-8111-111111111111'
const PARCELA  = '22222222-2222-4222-8222-222222222222'
const COBRANCA = '33333333-3333-4333-8333-333333333333'
const CLIENTE  = '44444444-4444-4444-8444-444444444444'
const ESTADO = { error: null }

function cenario(opts: { recorrente?: boolean } = {}) {
  const db = new FakeDb({
    contas: [{ id: CONTA, owner_user_id: 'user-1' }],
    cobrancas: [{ id: COBRANCA, conta_id: CONTA, cliente_id: CLIENTE, recorrente: opts.recorrente ?? true, dia_pagamento: 5, valor_mensalidade: 150 }],
    parcelas: [{ id: PARCELA, conta_id: CONTA, cobranca_id: COBRANCA, numero: 1, valor: 150, data_vencimento: '2026-10-05', status: 'aberta' }],
    notificacoes_config: [{ conta_id: CONTA, tipo: 'pagamento_confirmado', ativo_whatsapp: true }],
    notificacoes_enviadas: [],
    lancamentos: [],
  })

  // Mesma semântica da RPC baixar_parcela (migration 0013).
  db.rpcs.baixar_parcela = ({ p_parcela_id, p_conta_id, p_hoje }) => {
    const parcela = db.linhas('parcelas').find(p => p.id === p_parcela_id && p.conta_id === p_conta_id && p.status === 'aberta')
    if (!parcela) return { data: { ok: false, erro: 'Parcela não encontrada ou já paga' }, error: null }
    parcela.status = 'paga'
    parcela.data_pagamento = p_hoje
    db.linhas('lancamentos').push({ conta_id: p_conta_id, parcela_id: parcela.id, tipo: 'entrada', valor: parcela.valor })
    const cob = db.linhas('cobrancas').find(c => c.id === parcela.cobranca_id)!
    return {
      data: { ok: true, parcela_id: parcela.id, cobranca_id: cob.id, conta_id: p_conta_id, recorrente: cob.recorrente, cliente_id: cob.cliente_id },
      error: null,
    }
  }

  mocks.db.atual = db.cliente()
  return db
}

const form = (campos: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

const chamar = (campos: Record<string, string> = {}) =>
  baixarParcelaComConfirmacaoAction(ESTADO, form({ parcela_id: PARCELA, cobranca_id: COBRANCA, valor: '150', ...campos }))

beforeEach(() => {
  mocks.usuario.atual = { id: 'user-1' }
  mocks.enviarWhatsAppImediato.mockReset().mockResolvedValue(true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('baixarParcelaComConfirmacaoAction — ordem das operações (regressão)', () => {
  it('a próxima parcela (com a data escolhida em "Próximo pagamento") já existe no banco quando a confirmação é enviada', async () => {
    const db = cenario({ recorrente: true })

    let parcelasAbertasNoEnvio: { numero: number; data_vencimento: string }[] | null = null
    mocks.enviarWhatsAppImediato.mockImplementation(async () => {
      parcelasAbertasNoEnvio = db.linhas('parcelas')
        .filter(p => p.status === 'aberta')
        .map(p => ({ numero: p.numero, data_vencimento: p.data_vencimento }))
      return true
    })

    const r = await chamar({ proximo_vencimento: '2026-12-25' })

    expect(r).toEqual({ error: null, success: true })
    expect(mocks.enviarWhatsAppImediato).toHaveBeenCalledTimes(1)
    // Se isto vier vazio, a mensagem foi montada ANTES de a próxima parcela existir — exatamente o bug relatado.
    expect(parcelasAbertasNoEnvio).toEqual([{ numero: 2, data_vencimento: '2026-12-25' }])
  })

  it('a data informada no modal ("próximo pagamento") é a gravada na próxima parcela — não a calculada automaticamente', async () => {
    const db = cenario({ recorrente: true })
    await chamar({ proximo_vencimento: '2026-12-25' })

    const proxima = db.linhas('parcelas').find(p => p.numero === 2)
    expect(proxima).toMatchObject({ status: 'aberta', data_vencimento: '2026-12-25', valor: 150 })
  })

  it('sem data informada: calcula o próximo vencimento a partir do dia de pagamento da cobrança', async () => {
    const db = cenario({ recorrente: true })
    await chamar({})
    expect(db.linhas('parcelas').find(p => p.numero === 2)).toMatchObject({ data_vencimento: '2026-11-05' })
  })

  it('cobrança NÃO recorrente: não gera próxima parcela, e a confirmação ainda assim é enviada', async () => {
    const db = cenario({ recorrente: false })
    const r = await chamar({})
    expect(r).toEqual({ error: null, success: true })
    expect(db.linhas('parcelas')).toHaveLength(1)
    expect(mocks.enviarWhatsAppImediato).toHaveBeenCalledTimes(1)
  })

  it('já existe outra parcela aberta: não gera uma segunda (RN-C1 — nunca mais de 1 parcela aberta)', async () => {
    const db = cenario({ recorrente: true })
    db.linhas('parcelas').push({ id: 'parc-2', conta_id: CONTA, cobranca_id: COBRANCA, numero: 2, valor: 150, data_vencimento: '2026-11-05', status: 'aberta' })
    await chamar({ proximo_vencimento: '2026-12-25' })
    expect(db.linhas('parcelas').filter(p => p.status === 'aberta')).toHaveLength(1)
  })
})
