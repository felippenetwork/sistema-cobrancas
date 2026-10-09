// Webhook de PIX do Mercado Pago (app/api/webhooks/mercadopago-pix) — Orders API, dinheiro entrando.
// URL única e fixa (sem conta_id): a Orders API só chama a URL configurada no painel de cada app
// Mercado Pago, então o tenant é achado pelo id da ORDEM (globalmente único) em cobrancas_pix.txid.
// Autenticação real do Mercado Pago: x-signature (HMAC-SHA256 do manifest oficial) com a Secret Key
// DAQUELA conta. A notificação NUNCA é confiada: o estado da ordem vem sempre de GET /v1/orders/{id}
// (simulado aqui) com o token da conta, e só dá baixa se status/status_detail = processed/accredited.
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'
import { cifrarSegredo } from '@/lib/crypto/segredos'

const mocks = vi.hoisted(() => ({
  db: { atual: null as unknown },
  enviarWhatsAppImediato: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))
vi.mock('@/lib/whatsapp/enviar-imediato', () => ({ enviarWhatsAppImediato: mocks.enviarWhatsAppImediato }))

import { POST } from '@/app/api/webhooks/mercadopago-pix/route'

const CONTA = 'conta-1'
const OUTRA_CONTA = 'conta-2'
const PARCELA = 'parc-1'
const COBRANCA = 'cob-1'
const CLIENTE = 'cli-1'
const ORDER_ID = 'ORDTST01M17VR2XC7JQ76M89EX6YT8SF'
const TOKEN_MP = 'APP_USR-token-da-conta-1-de-teste'
const SECRET_MP = 'secret-webhook-da-conta-1'
const REQUEST_ID = 'req-abc-123'
const TS = '1756500000000'

const respostaMp = (status: number, corpo: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(corpo),
})

const ordemMp = (extra: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  status: 'processed',
  status_detail: 'accredited',
  ...extra,
})

function cenario(opts: {
  recorrente?: boolean; parcelaStatus?: string; pixStatus?: string; pixConta?: string; provedor?: string
  confirmacaoWhatsapp?: boolean; semToken?: boolean; semSecret?: boolean
} = {}) {
  const db = new FakeDb({
    cobrancas_pix: [{
      id: 'pix-1', conta_id: opts.pixConta ?? CONTA, provedor: opts.provedor ?? 'mercadopago', parcela_id: PARCELA, txid: ORDER_ID,
      valor: 150, status: opts.pixStatus ?? 'ativa', pago_em: null,
    }],
    parcelas: [{ id: PARCELA, conta_id: CONTA, cobranca_id: COBRANCA, numero: 1, valor: 150, data_vencimento: '2026-10-05', status: opts.parcelaStatus ?? 'aberta' }],
    cobrancas: [{ id: COBRANCA, conta_id: CONTA, cliente_id: CLIENTE, recorrente: opts.recorrente ?? false, dia_pagamento: 5, valor_mensalidade: 150, status: 'ativa' }],
    clientes: [{ id: CLIENTE, conta_id: CONTA }],
    configuracoes: [
      { conta_id: CONTA, mp_access_token: opts.semToken ? null : cifrarSegredo(TOKEN_MP), mp_webhook_secret: opts.semSecret ? null : cifrarSegredo(SECRET_MP) },
      { conta_id: OUTRA_CONTA, mp_access_token: cifrarSegredo('APP_USR-token-da-conta-2'), mp_webhook_secret: cifrarSegredo('secret-da-conta-2') },
    ],
    notificacoes_config: [{ conta_id: CONTA, tipo: 'pagamento_confirmado', ativo_whatsapp: opts.confirmacaoWhatsapp ?? true }],
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

function assinatura(orderId: string, requestId: string, ts: string, secret: string): string {
  const manifest = `id:${orderId.toLowerCase()};request-id:${requestId};ts:${ts};`
  return `ts=${ts},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`
}

type Chamada = { orderId?: string | null; xSignature?: string | null; xRequestId?: string | null; secret?: string }

const chamar = ({ orderId = ORDER_ID, xSignature, xRequestId = REQUEST_ID, secret = SECRET_MP }: Chamada = {}) => {
  const params = new URLSearchParams()
  if (orderId) params.set('data.id', orderId)
  const url = `http://localhost/api/webhooks/mercadopago-pix?${params.toString()}`
  const headers = new Headers()
  const sig = xSignature === null ? null : (xSignature ?? (orderId ? assinatura(orderId, xRequestId ?? REQUEST_ID, TS, secret) : undefined))
  if (sig) headers.set('x-signature', sig)
  if (xRequestId !== null) headers.set('x-request-id', xRequestId ?? REQUEST_ID)
  return POST(new NextRequest(url, { method: 'POST', headers, body: JSON.stringify({ action: 'order.processed', data: { id: orderId } }) }))
}

const pix = (db: FakeDb) => db.linhas('cobrancas_pix')[0]
const parcela = (db: FakeDb) => db.linhas('parcelas')[0]

beforeEach(() => {
  process.env.CREDENCIAIS_KEY = Buffer.alloc(32, 7).toString('base64')
  mocks.enviarWhatsAppImediato.mockReset().mockResolvedValue(true)
  mocks.fetch.mockReset().mockResolvedValue(respostaMp(200, ordemMp()))
  vi.stubGlobal('fetch', mocks.fetch)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.CREDENCIAIS_KEY
})

describe('payload incompleto: recusa antes de tocar no banco', () => {
  it('sem data.id', async () => {
    const db = cenario()
    expect((await chamar({ orderId: null })).status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(parcela(db).status).toBe('aberta')
  })

  it('sem x-signature', async () => {
    expect((await chamar({ xSignature: null })).status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('sem x-request-id', async () => {
    expect((await chamar({ xRequestId: null })).status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

describe('assinatura (HMAC-SHA256 oficial do Mercado Pago, com a Secret Key da conta)', () => {
  it('assinatura malformada (sem ts= ou v1=): recusa', async () => {
    cenario()
    expect((await chamar({ xSignature: 'lixo-sem-formato' })).status).toBe(401)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('assinatura com secret errado: 401, nunca reconsulta nem dá baixa', async () => {
    const db = cenario()
    expect((await chamar({ secret: 'secret-errado' })).status).toBe(401)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(parcela(db).status).toBe('aberta')
  })

  it('assinatura calculada com a Secret Key de OUTRA conta: 401 (cada conta só valida com a própria)', async () => {
    const db = cenario()
    expect((await chamar({ secret: 'secret-da-conta-2' })).status).toBe(401)
    expect(parcela(db).status).toBe('aberta')
  })

  it('ts adulterado (assinatura não bate mais com o manifest): 401', async () => {
    cenario()
    const sig = assinatura(ORDER_ID, REQUEST_ID, TS, SECRET_MP)
    const tsFalso = String(Number(TS) + 1)
    expect((await chamar({ xSignature: sig.replace(TS, tsFalso) })).status).toBe(401)
  })
})

describe('ordem paga (processed/accredited)', () => {
  it('reconsulta a ordem na API do Mercado Pago com o token da conta, dá baixa e conclui a cobrança PIX', async () => {
    const db = cenario()
    const res = await chamar()
    expect(res.status).toBe(200)

    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe(`https://api.mercadopago.com/v1/orders/${ORDER_ID}`)
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN_MP}`)

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

  it('erro no WhatsApp não desfaz a baixa nem pede reenvio', async () => {
    const db = cenario()
    mocks.enviarWhatsAppImediato.mockRejectedValue(new Error('uazapi fora do ar'))
    expect((await chamar()).status).toBe(200)
    expect(parcela(db).status).toBe('paga')
    expect(pix(db).status).toBe('concluida')
  })

  it('cobrança recorrente: sem parcela aberta sobrando, gera a próxima com o vencimento do mês seguinte (RN-C1)', async () => {
    const db = cenario({ recorrente: true })
    await chamar()
    expect(db.linhas('parcelas').find(p => p.numero === 2)).toMatchObject({ cobranca_id: COBRANCA, status: 'aberta', valor: 150, data_vencimento: '2026-11-05' })
  })
})

describe('o que NÃO dá baixa', () => {
  it.each([
    ['action_required/waiting_transfer (ainda não paga)', { status: 'action_required', status_detail: 'waiting_transfer' }],
    ['processed mas status_detail diferente de accredited', { status: 'processed', status_detail: 'other' }],
    ['status diferente de processed mesmo com accredited', { status: 'expired', status_detail: 'accredited' }],
    ['cancelada', { status: 'cancelled', status_detail: 'cancelled' }],
  ])('%s: não dá baixa e a cobrança PIX continua ativa', async (_nome, corpoMp) => {
    const db = cenario()
    mocks.fetch.mockResolvedValue(respostaMp(200, ordemMp(corpoMp)))
    expect((await chamar()).status).toBe(200)
    expect(parcela(db).status).toBe('aberta')
    expect(pix(db).status).toBe('ativa')
    expect(db.chamadasRpc).toHaveLength(0)
  })

  it('notificação de teste do dashboard (order id fictício, nenhuma cobrança nossa): 200, sem consultar a API', async () => {
    const db = cenario()
    expect((await chamar({ orderId: 'ORD-FICTICIO', secret: SECRET_MP })).status).toBe(200)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(parcela(db).status).toBe('aberta')
  })

  it('cobrança PIX de OUTRA conta com o mesmo id: só é resolvida por aquela conta (assinatura com a secret certa da OUTRA conta)', async () => {
    const db = cenario({ pixConta: OUTRA_CONTA })
    // Assinada com a secret da conta 1 (a única credencial que o chamador teria) — mas a ordem é da conta 2.
    expect((await chamar({ secret: SECRET_MP })).status).toBe(401)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(parcela(db).status).toBe('aberta')
  })

  it('cobrança PIX de outro provedor (EfiBank) com o mesmo id: ignorada', async () => {
    const db = cenario({ provedor: 'efibank' })
    expect((await chamar()).status).toBe(200)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(parcela(db).status).toBe('aberta')
  })

  it('conta sem token do Mercado Pago salvo: não dá para confirmar — 200, sem baixa', async () => {
    const db = cenario({ semToken: true })
    expect((await chamar()).status).toBe(200)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(parcela(db).status).toBe('aberta')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('credenciais completas'), expect.anything())
  })

  it('conta sem webhook secret salvo: não dá para validar a assinatura — 200, sem baixa', async () => {
    const db = cenario({ semSecret: true })
    expect((await chamar()).status).toBe(200)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(parcela(db).status).toBe('aberta')
  })
})

describe('falhas transitórias: o Mercado Pago reenvia (5xx), sem perder o pagamento', () => {
  it.each([500, 502, 429])('API do Mercado Pago responde %i ao reconsultar: 500 para reenviar e nada é baixado', async (status) => {
    const db = cenario()
    mocks.fetch.mockResolvedValue(respostaMp(status))
    expect((await chamar()).status).toBe(500)
    expect(parcela(db).status).toBe('aberta')
    expect(pix(db).status).toBe('ativa')
  })

  it('falha de rede ao consultar a ordem: 500, e no reenvio a baixa acontece', async () => {
    const db = cenario()
    mocks.fetch.mockRejectedValueOnce(new Error('ETIMEDOUT'))
    expect((await chamar()).status).toBe(500)
    expect(parcela(db).status).toBe('aberta')

    expect((await chamar()).status).toBe(200)
    expect(parcela(db).status).toBe('paga')
    expect(pix(db).status).toBe('concluida')
  })

  it('token revogado / ordem inexistente (401/404) ao reconsultar: 200 (reenviar não resolve) e registra para revisão', async () => {
    const db = cenario()
    for (const status of [401, 404]) {
      mocks.fetch.mockResolvedValue(respostaMp(status))
      expect((await chamar()).status).toBe(200)
    }
    expect(parcela(db).status).toBe('aberta')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('revisar manualmente'), expect.anything())
  })

  it('erro na RPC de baixa: NÃO conclui a cobrança PIX e responde 500 (PAG-N1)', async () => {
    const db = cenario()
    const baixaOriginal = db.rpcs.baixar_parcela
    db.rpcs.baixar_parcela = () => ({ data: null, error: { message: 'timeout' } })

    expect((await chamar()).status).toBe(500)
    expect(pix(db).status).toBe('ativa')
    expect(parcela(db).status).toBe('aberta')

    db.rpcs.baixar_parcela = baixaOriginal
    expect((await chamar()).status).toBe(200)
    expect(parcela(db).status).toBe('paga')
    expect(pix(db).status).toBe('concluida')
    expect(db.linhas('lancamentos')).toHaveLength(1)
  })

  it('erro ao ler a cobrança PIX: 500 (tenta de novo)', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'cobrancas_pix', operacao: 'select', vezes: 1 })
    expect((await chamar()).status).toBe(500)
    expect(parcela(db).status).toBe('aberta')
  })

  it('sem CREDENCIAIS_KEY não dá para decifrar as credenciais: 500 (reenvia quando a configuração voltar)', async () => {
    const db = cenario()
    delete process.env.CREDENCIAIS_KEY
    expect((await chamar()).status).toBe(500)
    expect(parcela(db).status).toBe('aberta')
  })
})

describe('idempotência', () => {
  it('entrega repetida depois de concluída: não consulta o Mercado Pago nem chama a baixa de novo', async () => {
    const db = cenario({ pixStatus: 'concluida', parcelaStatus: 'paga' })
    expect((await chamar()).status).toBe(200)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(db.chamadasRpc).toHaveLength(0)
  })

  it('parcela já paga (baixa manual antes do PIX): encerra a cobrança PIX sem repetir efeitos', async () => {
    const db = cenario({ parcelaStatus: 'paga' })
    expect((await chamar()).status).toBe(200)
    expect(pix(db).status).toBe('concluida')
    expect(db.linhas('lancamentos')).toHaveLength(0)
    expect(mocks.enviarWhatsAppImediato).not.toHaveBeenCalled()
  })

  it('duas notificações simultâneas da mesma ordem: um lançamento só e efeitos uma vez só', async () => {
    const db = cenario()
    const [a, b] = await Promise.all([chamar(), chamar()])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(db.linhas('lancamentos')).toHaveLength(1)
    expect(mocks.enviarWhatsAppImediato).toHaveBeenCalledTimes(1)
    expect(pix(db).status).toBe('concluida')
  })
})
