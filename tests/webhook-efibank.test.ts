// Webhook de PIX da EfiBank (app/api/webhooks/efibank).
// PAG-N1: a cobrança PIX era marcada "concluida" ANTES da baixa; se a baixa falhasse, o
// webhook respondia 200 e a EfiBank não reenviava — cliente pagou e a parcela ficava aberta.
//
// A RPC baixar_parcela é simulada em JS (semântica da migration 0013). Atomicidade real da
// função SQL só se prova em Postgres — pendente (TST-C3).
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => ({
  db: { atual: null as unknown },
  enviarWhatsAppImediato: vi.fn(),
  renovarLookDefenseImediato: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))
vi.mock('@/lib/whatsapp/enviar-imediato', () => ({ enviarWhatsAppImediato: mocks.enviarWhatsAppImediato }))
vi.mock('@/lib/lookdefense/renovar-imediato', () => ({ renovarLookDefenseImediato: mocks.renovarLookDefenseImediato }))

import { POST } from '@/app/api/webhooks/efibank/route'

const CONTA = 'conta-1'
const PARCELA = 'parc-1'
const COBRANCA = 'cob-1'
const CLIENTE = 'cli-1'
const TXID = 'TX123'
const SEGREDO = 'segredo-de-teste'

function cenario(opts: { recorrente?: boolean; parcelaStatus?: string; pixStatus?: string; loginExterno?: boolean; confirmacaoWhatsapp?: boolean } = {}) {
  const db = new FakeDb({
    cobrancas_pix: [{ id: 'pix-1', conta_id: CONTA, parcela_id: PARCELA, txid: TXID, status: opts.pixStatus ?? 'ativa', pago_em: null }],
    parcelas: [{ id: PARCELA, conta_id: CONTA, cobranca_id: COBRANCA, numero: 1, valor: 150, data_vencimento: '2026-10-05', status: opts.parcelaStatus ?? 'aberta' }],
    cobrancas: [{ id: COBRANCA, conta_id: CONTA, cliente_id: CLIENTE, recorrente: opts.recorrente ?? false, dia_pagamento: 5, valor_mensalidade: 150, status: 'ativa' }],
    clientes: [{ id: CLIENTE, conta_id: CONTA, login_externo: opts.loginExterno ? 'joao.iptv' : null, tipo_integracao: opts.loginExterno ? 'lookdefense' : null }],
    notificacoes_config: [{ conta_id: CONTA, tipo: 'pagamento_confirmado', ativo_whatsapp: opts.confirmacaoWhatsapp ?? true }],
    notificacoes_enviadas: [],
    lancamentos: [],
    baixas_externas: [],
  })

  // Mesma semântica da RPC baixar_parcela (migration 0013).
  db.rpcs.baixar_parcela = ({ p_parcela_id, p_conta_id, p_hoje }) => {
    const parcela = db.linhas('parcelas').find(p => p.id === p_parcela_id && p.conta_id === p_conta_id && p.status === 'aberta')
    if (!parcela) return { data: { ok: false, erro: 'Parcela não encontrada ou já paga' }, error: null }
    parcela.status = 'paga'
    parcela.data_pagamento = p_hoje
    db.linhas('lancamentos').push({ conta_id: p_conta_id, parcela_id: parcela.id, tipo: 'entrada', valor: parcela.valor })
    db.linhas('notificacoes_enviadas')
      .filter(n => n.parcela_id === p_parcela_id && n.status === 'fila')
      .forEach(n => { n.status = 'cancelado' })
    const cob = db.linhas('cobrancas').find(c => c.id === parcela.cobranca_id)!
    return {
      data: { ok: true, parcela_id: parcela.id, cobranca_id: cob.id, conta_id: p_conta_id, recorrente: cob.recorrente, cliente_id: cob.cliente_id },
      error: null,
    }
  }

  mocks.db.atual = db.cliente()
  return db
}

const chamar = (txids: string[] = [TXID], token: string | null = SEGREDO) =>
  POST(new NextRequest(`http://localhost/api/webhooks/efibank${token === null ? '' : `?token=${token}`}`, {
    method: 'POST',
    body: JSON.stringify({ pix: txids.map(txid => ({ txid })) }),
    headers: { 'content-type': 'application/json' },
  }))

const pix = (db: FakeDb) => db.linhas('cobrancas_pix')[0]
const parcela = (db: FakeDb) => db.linhas('parcelas')[0]

beforeEach(() => {
  process.env.CRON_SECRET = SEGREDO
  delete process.env.EFIBANK_WEBHOOK_SECRET
  mocks.enviarWhatsAppImediato.mockReset().mockResolvedValue(true)
  mocks.renovarLookDefenseImediato.mockReset().mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.CRON_SECRET
  delete process.env.EFIBANK_WEBHOOK_SECRET
})

describe('autenticação', () => {
  it('recusa sem token', async () => {
    const db = cenario()
    expect((await chamar([TXID], null)).status).toBe(401)
    expect(parcela(db).status).toBe('aberta')
  })

  it('recusa token errado', async () => {
    cenario()
    expect((await chamar([TXID], 'errado')).status).toBe(401)
  })

  it('recusa tudo quando nenhum segredo está configurado no servidor', async () => {
    cenario()
    delete process.env.CRON_SECRET
    expect((await chamar([TXID], 'undefined')).status).toBe(401)
  })

  it('com EFIBANK_WEBHOOK_SECRET configurado, o CRON_SECRET deixa de valer neste webhook', async () => {
    const db = cenario()
    process.env.EFIBANK_WEBHOOK_SECRET = 'segredo-proprio'
    expect((await chamar([TXID], SEGREDO)).status).toBe(401)
    expect(parcela(db).status).toBe('aberta')
    expect((await chamar([TXID], 'segredo-proprio')).status).toBe(200)
    expect(parcela(db).status).toBe('paga')
  })

  it('corpo que não é JSON → 400', async () => {
    cenario()
    const res = await POST(new NextRequest(`http://localhost/x?token=${SEGREDO}`, { method: 'POST', body: 'não é json' }))
    expect(res.status).toBe(400)
  })
})

describe('PIX pago', () => {
  it('dá baixa na parcela, registra o lançamento e marca a cobrança PIX como concluída', async () => {
    const db = cenario()
    const res = await chamar()
    expect(res.status).toBe(200)
    expect(parcela(db).status).toBe('paga')
    expect(db.linhas('lancamentos')).toHaveLength(1)
    expect(pix(db).status).toBe('concluida')
    expect(pix(db).pago_em).toBeTruthy()
  })

  it('cancela as notificações em fila da parcela (não cobrar quem pagou)', async () => {
    const db = cenario()
    db.linhas('notificacoes_enviadas').push({ id: 'n1', conta_id: CONTA, parcela_id: PARCELA, tipo: '3d', canal: 'whatsapp', status: 'fila' })
    await chamar()
    expect(db.linhas('notificacoes_enviadas').find(n => n.id === 'n1')!.status).toBe('cancelado')
  })

  it('enfileira a confirmação por WhatsApp e tenta enviar na hora', async () => {
    const db = cenario()
    await chamar()
    const confirmacao = db.linhas('notificacoes_enviadas').find(n => n.tipo === 'pagamento_confirmado')
    expect(confirmacao).toMatchObject({ conta_id: CONTA, parcela_id: PARCELA, canal: 'whatsapp', status: 'fila' })
    expect(mocks.enviarWhatsAppImediato).toHaveBeenCalledWith(CONTA, confirmacao!.id, PARCELA, COBRANCA, CLIENTE, 'pagamento_confirmado')
  })

  it('confirmação desativada na conta: não envia', async () => {
    const db = cenario({ confirmacaoWhatsapp: false })
    await chamar()
    expect(db.linhas('notificacoes_enviadas')).toHaveLength(0)
    expect(mocks.enviarWhatsAppImediato).not.toHaveBeenCalled()
  })

  it('cliente com login externo: registra a baixa externa e renova no LookDefense', async () => {
    const db = cenario({ loginExterno: true })
    await chamar()
    expect(db.linhas('baixas_externas')).toHaveLength(1)
    expect(mocks.renovarLookDefenseImediato).toHaveBeenCalledWith(CONTA, db.linhas('baixas_externas')[0].id, 'joao.iptv', 0)
  })

  it('cliente sem login externo: não mexe no LookDefense', async () => {
    const db = cenario({ loginExterno: false })
    await chamar()
    expect(db.linhas('baixas_externas')).toHaveLength(0)
    expect(mocks.renovarLookDefenseImediato).not.toHaveBeenCalled()
  })
})

describe('PAG-N1 — falha na baixa não pode encerrar a cobrança PIX', () => {
  it('erro na RPC: NÃO marca concluída e responde 500 para a EfiBank reenviar', async () => {
    const db = cenario()
    const baixaOriginal = db.rpcs.baixar_parcela
    db.rpcs.baixar_parcela = () => ({ data: null, error: { message: 'timeout' } })

    const res = await chamar()
    expect(res.status).toBe(500)
    expect(pix(db).status).toBe('ativa')
    expect(parcela(db).status).toBe('aberta')

    // A EfiBank reenvia e desta vez funciona: a parcela é baixada e a cobrança encerrada.
    db.rpcs.baixar_parcela = baixaOriginal
    expect((await chamar()).status).toBe(200)
    expect(parcela(db).status).toBe('paga')
    expect(pix(db).status).toBe('concluida')
    expect(db.linhas('lancamentos')).toHaveLength(1)
  })

  it('erro ao consultar a cobrança PIX: responde 500 (tenta de novo)', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'cobrancas_pix', operacao: 'select', vezes: 1 })
    expect((await chamar()).status).toBe(500)
    expect(parcela(db).status).toBe('aberta')
  })

  it('um txid com problema não impede os outros da mesma notificação', async () => {
    const db = cenario()
    db.linhas('cobrancas_pix').push({ id: 'pix-2', conta_id: CONTA, parcela_id: 'parc-2', txid: 'TX2', status: 'ativa' })
    db.linhas('parcelas').push({ id: 'parc-2', conta_id: CONTA, cobranca_id: COBRANCA, numero: 2, valor: 150, data_vencimento: '2026-11-05', status: 'aberta' })
    const original = db.rpcs.baixar_parcela
    db.rpcs.baixar_parcela = args => args.p_parcela_id === PARCELA ? { data: null, error: { message: 'boom' } } : original(args)

    const res = await chamar([TXID, 'TX2'])
    expect(res.status).toBe(500)
    expect(db.linhas('parcelas').find(p => p.id === 'parc-2')!.status).toBe('paga')
    expect(db.linhas('cobrancas_pix').find(p => p.txid === 'TX2')!.status).toBe('concluida')
    expect(pix(db).status).toBe('ativa')
  })

  it('erro em efeito colateral (WhatsApp) não desfaz a baixa nem pede reenvio', async () => {
    const db = cenario({ loginExterno: true })
    mocks.enviarWhatsAppImediato.mockRejectedValue(new Error('meta fora do ar'))
    const res = await chamar()
    expect(res.status).toBe(200)
    expect(parcela(db).status).toBe('paga')
    expect(pix(db).status).toBe('concluida')
    // os demais efeitos ainda são tentados
    expect(mocks.renovarLookDefenseImediato).toHaveBeenCalled()
  })

  it('erro ao marcar a cobrança PIX como concluída não desfaz a baixa (a entrega repetida é tratada como "já paga")', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'cobrancas_pix', operacao: 'update', vezes: 1 })
    expect((await chamar()).status).toBe(200)
    expect(parcela(db).status).toBe('paga')

    // reentrega: a RPC responde "já paga", e agora a cobrança é encerrada sem repetir efeitos
    mocks.enviarWhatsAppImediato.mockClear()
    expect((await chamar()).status).toBe(200)
    expect(pix(db).status).toBe('concluida')
    expect(db.linhas('lancamentos')).toHaveLength(1)
    expect(mocks.enviarWhatsAppImediato).not.toHaveBeenCalled()
  })
})

describe('idempotência e casos de borda', () => {
  it('parcela já paga (baixa manual antes do PIX): encerra a cobrança PIX sem repetir efeitos', async () => {
    const db = cenario({ parcelaStatus: 'paga', loginExterno: true })
    const res = await chamar()
    expect(res.status).toBe(200)
    expect(pix(db).status).toBe('concluida')
    expect(db.linhas('lancamentos')).toHaveLength(0)
    expect(mocks.enviarWhatsAppImediato).not.toHaveBeenCalled()
    expect(mocks.renovarLookDefenseImediato).not.toHaveBeenCalled()
  })

  it('entrega repetida depois de concluída: não chama a baixa de novo', async () => {
    const db = cenario({ pixStatus: 'concluida', parcelaStatus: 'paga' })
    expect((await chamar()).status).toBe(200)
    expect(db.chamadasRpc).toHaveLength(0)
  })

  it('duas entregas simultâneas do mesmo txid: um lançamento só e efeitos uma vez só', async () => {
    const db = cenario({ loginExterno: true })
    const [a, b] = await Promise.all([chamar(), chamar()])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(db.linhas('lancamentos')).toHaveLength(1)
    expect(mocks.enviarWhatsAppImediato).toHaveBeenCalledTimes(1)
    expect(mocks.renovarLookDefenseImediato).toHaveBeenCalledTimes(1)
    expect(pix(db).status).toBe('concluida')
  })

  it('txid desconhecido: responde 200 sem alterar nada (a EfiBank também notifica cobranças de fora do sistema)', async () => {
    const db = cenario()
    expect((await chamar(['OUTRO'])).status).toBe(200)
    expect(parcela(db).status).toBe('aberta')
    expect(db.chamadasRpc).toHaveLength(0)
  })

  it('PIX pago mas parcela inexistente: registra erro para revisão manual e NÃO fica reenviando para sempre', async () => {
    const db = cenario()
    db.linhas('parcelas').length = 0
    const res = await chamar()
    expect(res.status).toBe(200)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('revisar manualmente'), expect.objectContaining({ txid: TXID }))
    expect(pix(db).status).toBe('ativa')
  })

  it('notificação sem pix / lista vazia: 200', async () => {
    cenario()
    const res = await POST(new NextRequest(`http://localhost/x?token=${SEGREDO}`, { method: 'POST', body: JSON.stringify({}) }))
    expect(res.status).toBe(200)
  })
})

describe('cobrança recorrente (comportamento atual preservado — decisão RN-C1 pendente)', () => {
  it('sem parcela aberta sobrando: gera a próxima com o vencimento do mês seguinte', async () => {
    const db = cenario({ recorrente: true })
    await chamar()
    const proxima = db.linhas('parcelas').find(p => p.numero === 2)
    expect(proxima).toMatchObject({ cobranca_id: COBRANCA, status: 'aberta', valor: 150, data_vencimento: '2026-11-05' })
  })

  it('já existe outra parcela aberta: não gera', async () => {
    const db = cenario({ recorrente: true })
    db.linhas('parcelas').push({ id: 'parc-2', conta_id: CONTA, cobranca_id: COBRANCA, numero: 2, valor: 150, data_vencimento: '2026-11-05', status: 'aberta' })
    await chamar()
    expect(db.linhas('parcelas')).toHaveLength(2)
  })

  it('cobrança não recorrente: não gera', async () => {
    const db = cenario({ recorrente: false })
    await chamar()
    expect(db.linhas('parcelas')).toHaveLength(1)
  })

  it('vencimento em dia inexistente no mês cai no último dia (31 → fevereiro)', async () => {
    const db = cenario({ recorrente: true })
    db.linhas('cobrancas')[0].dia_pagamento = 31
    db.linhas('parcelas')[0].data_vencimento = '2027-01-31'
    await chamar()
    expect(db.linhas('parcelas').find(p => p.numero === 2)!.data_vencimento).toBe('2027-02-28')
  })
})
