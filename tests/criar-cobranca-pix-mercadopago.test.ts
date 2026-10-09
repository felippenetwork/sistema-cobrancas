// PIX de cobrança do cliente final pelo Mercado Pago (lib/mercadopago/pix — Orders API). O corpo e a
// resposta usados aqui espelham a captura REAL contra o sandbox do Mercado Pago (integração irmã
// ERP-Rifas Clube do Churrasco, confirmada em 2026-08-29/09-05) — não são inventados. O Mercado Pago
// é 100% simulado (fetch); o banco é o FakeDb. Provas principais:
//  - usa o Access Token DA CONTA (decifrado) e nunca o de outra;
//  - um PIX que não foi gravado NUNCA é entregue (o webhook não acharia o pagamento);
//  - sem token não gera PIX.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'
import { cifrarSegredo } from '@/lib/crypto/segredos'

const mocks = vi.hoisted(() => ({
  db: { atual: null as unknown },
  fetch: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))

import { criarCobrancaPixMercadoPago } from '@/lib/mercadopago/pix'

const CONTA = 'conta-1'
const PARCELA = 'parc-1'
const COBRANCA = 'cob-1'
const CLIENTE = 'c1234567-aaaa-bbbb'
const TOKEN_MP = 'APP_USR-token-da-conta-1-de-teste'

const respostaMp = (status: number, corpo: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(corpo),
})

// Resposta real capturada contra o sandbox (ver ERP-Rifas src/lib/mercadopago.test.ts).
const ORDEM_SANDBOX_REAL = {
  id: 'ORDTST01M17VR2XC7JQ76M89EX6YT8SF',
  type: 'online',
  status: 'action_required',
  status_detail: 'waiting_transfer',
  transactions: {
    payments: [{
      id: 'PAY01M17VR2Y18ZZY4WDY7ZT7SHCH',
      amount: '150.00',
      date_of_expiration: '2026-08-30T22:55:19.320+00:00',
      payment_method: {
        id: 'pix', type: 'bank_transfer',
        qr_code: '00020126580014br.gov.bcb.pix0136b76aa9c2-2ec4-4110-954e-ebfe34f05b61520400005303986540525.505802BR5918TESTUSER14300677626009Sao Paulo62250521mpqrinter1762881592446304183B',
        qr_code_base64: 'iVBORw0KGgo...',
      },
    }],
  },
}

function cenario(opts: { linhasPix?: Record<string, unknown>[]; semToken?: boolean; emailCliente?: string | null; outrasConfigs?: Record<string, unknown>[] } = {}) {
  const db = new FakeDb({
    configuracoes: [
      { conta_id: CONTA, mp_access_token: opts.semToken ? null : cifrarSegredo(TOKEN_MP) },
      ...(opts.outrasConfigs ?? []),
    ],
    parcelas: [{ id: PARCELA, conta_id: CONTA, cobranca_id: COBRANCA }],
    cobrancas: [{ id: COBRANCA, conta_id: CONTA, cliente_id: CLIENTE }],
    clientes: [{ id: CLIENTE, conta_id: CONTA, email: opts.emailCliente === undefined ? 'cliente@exemplo.test' : opts.emailCliente }],
    cobrancas_pix: (opts.linhasPix ?? []) as Record<string, any>[],
  })
  mocks.db.atual = db.cliente()
  return db
}

const chamadaMp = () => {
  const [url, init] = mocks.fetch.mock.calls[0]
  return { url: url as string, init: init as RequestInit, corpo: JSON.parse(init.body as string) }
}

const daqui = (minutos: number) => new Date(Date.now() + minutos * 60_000).toISOString()

beforeEach(() => {
  process.env.CREDENCIAIS_KEY = Buffer.alloc(32, 7).toString('base64')
  mocks.fetch.mockReset().mockResolvedValue(respostaMp(201, ORDEM_SANDBOX_REAL))
  vi.stubGlobal('fetch', mocks.fetch)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.CREDENCIAIS_KEY
})

describe('criarCobrancaPixMercadoPago — criação (Orders API)', () => {
  it('cria a ordem com o token da conta, grava em cobrancas_pix e devolve o código PIX', async () => {
    const db = cenario()
    const res = await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150, 'Mensalidade')

    expect(res).toMatchObject({
      txid: 'ORDTST01M17VR2XC7JQ76M89EX6YT8SF',
      pixCopiaCola: ORDEM_SANDBOX_REAL.transactions.payments[0].payment_method.qr_code,
      qrCodeBase64: 'iVBORw0KGgo...',
      linkPagamento: null,
      expiraEm: '2026-08-30T22:55:19.320Z',
    })
    expect(db.linhas('cobrancas_pix')).toHaveLength(1)
    expect(db.linhas('cobrancas_pix')[0]).toMatchObject({
      conta_id: CONTA, parcela_id: PARCELA, provedor: 'mercadopago', txid: 'ORDTST01M17VR2XC7JQ76M89EX6YT8SF', status: 'ativa', valor: 150,
    })
  })

  it('monta a requisição no formato da Orders API: endpoint, token, idempotência, total_amount, transactions.payments e external_reference', async () => {
    cenario()
    await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150, 'Mensalidade')

    const { url, init, corpo } = chamadaMp()
    expect(url).toBe('https://api.mercadopago.com/v1/orders')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${TOKEN_MP}`)
    expect(headers['X-Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(corpo).toEqual({
      type: 'online',
      total_amount: '150.00',
      external_reference: PARCELA,
      processing_mode: 'automatic',
      transactions: { payments: [{ amount: '150.00', payment_method: { id: 'pix', type: 'bank_transfer' } }] },
      payer: { email: 'cliente@exemplo.test' },
    })
  })

  it('duas chamadas seguidas usam Idempotency-Key diferentes (nunca reaproveita)', async () => {
    cenario()
    await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)
    await criarCobrancaPixMercadoPago(CONTA, 'parc-2', 150)
    const chamadas = mocks.fetch.mock.calls
    expect((chamadas[0][1] as RequestInit & { headers: Record<string, string> }).headers['X-Idempotency-Key'])
      .not.toBe((chamadas[1][1] as RequestInit & { headers: Record<string, string> }).headers['X-Idempotency-Key'])
  })

  it('cliente sem e-mail: usa um e-mail sintético e único por cliente (o Mercado Pago exige o campo)', async () => {
    cenario({ emailCliente: null })
    await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)
    expect(chamadaMp().corpo.payer.email).toBe('pagador+c1234567@cobranx.site')
  })

  it('e-mail inválido no cadastro do cliente também cai no e-mail sintético', async () => {
    cenario({ emailCliente: 'isso-nao-e-email' })
    await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)
    expect(chamadaMp().corpo.payer.email).toBe('pagador+c1234567@cobranx.site')
  })

  it('usa o token da PRÓPRIA conta mesmo havendo outra conta configurada (isolamento)', async () => {
    cenario({ outrasConfigs: [{ conta_id: 'conta-2', mp_access_token: cifrarSegredo('APP_USR-token-da-conta-2') }] })
    await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)
    expect((chamadaMp().init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN_MP}`)
  })
})

describe('criarCobrancaPixMercadoPago — nunca entregar PIX que não será reconhecido', () => {
  it('se NÃO conseguir gravar a cobrança, devolve erro e NÃO entrega o código', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'cobrancas_pix', operacao: 'upsert', vezes: 1 })
    const res = await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)
    expect(res).toHaveProperty('erro')
    expect(res).not.toHaveProperty('pixCopiaCola')
    expect(db.linhas('cobrancas_pix')).toHaveLength(0)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('código NÃO entregue'),
      expect.objectContaining({ contaId: CONTA, parcelaId: PARCELA, txid: 'ORDTST01M17VR2XC7JQ76M89EX6YT8SF' }),
    )
  })

  it('resposta sem qr_code (formato inesperado): devolve erro e não grava nada', async () => {
    const db = cenario()
    mocks.fetch.mockResolvedValue(respostaMp(201, { id: 'ORD123', transactions: { payments: [{ payment_method: {} }] } }))
    expect(await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)).toHaveProperty('erro')
    expect(db.linhas('cobrancas_pix')).toHaveLength(0)
  })

  it('resposta sem id da ordem: devolve erro e não grava nada', async () => {
    const db = cenario()
    mocks.fetch.mockResolvedValue(respostaMp(201, { transactions: ORDEM_SANDBOX_REAL.transactions }))
    expect(await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)).toHaveProperty('erro')
    expect(db.linhas('cobrancas_pix')).toHaveLength(0)
  })
})

describe('criarCobrancaPixMercadoPago — reaproveitar PIX ativo', () => {
  const ativo = (extra: Record<string, unknown> = {}) => ({
    id: 'x', conta_id: CONTA, parcela_id: PARCELA, provedor: 'mercadopago', valor: 150, txid: '111', status: 'ativa',
    pix_copia_cola: '00020126ANTIGO', qr_code_base64: null, link_pagamento: null, expira_em: daqui(30), ...extra,
  })

  it('reutiliza a cobrança ativa, não expirada, do mesmo valor, em vez de criar outra', async () => {
    cenario({ linhasPix: [ativo()] })
    const res = await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)
    expect(res).toMatchObject({ txid: '111', pixCopiaCola: '00020126ANTIGO' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['expirada', { expira_em: daqui(-1) }],
    ['de OUTRA conta', { conta_id: 'conta-2' }],
    ['de OUTRO provedor (EfiBank)', { provedor: 'efibank' }],
    ['com valor diferente (parcela editada)', { valor: 100 }],
    ['já concluída', { status: 'concluida' }],
  ])('cobrança %s não é reutilizada', async (_nome, extra) => {
    cenario({ linhasPix: [ativo(extra)] })
    const res = await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)
    expect(res).toMatchObject({ txid: 'ORDTST01M17VR2XC7JQ76M89EX6YT8SF' })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('erro ao consultar cobranças existentes: devolve erro sem gerar um segundo PIX às cegas', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'cobrancas_pix', operacao: 'select', vezes: 1 })
    expect(await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)).toHaveProperty('erro')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

describe('criarCobrancaPixMercadoPago — falhas do Mercado Pago e da configuração', () => {
  it('conta sem token salvo: erro claro, sem chamar a API', async () => {
    cenario({ semToken: true })
    const res = await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)
    expect(res).toMatchObject({ erro: expect.stringContaining('não configurado') })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('sem CREDENCIAIS_KEY não dá para decifrar o token: erro claro, sem chamar a API', async () => {
    cenario()
    delete process.env.CREDENCIAIS_KEY
    expect(await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)).toMatchObject({ erro: expect.stringContaining('credenciais') })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('token recusado (401): pede para atualizar o token e não grava nada', async () => {
    const db = cenario()
    mocks.fetch.mockResolvedValue(respostaMp(401, { message: 'invalid access token' }))
    expect(await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)).toMatchObject({ erro: expect.stringContaining('Access Token') })
    expect(db.linhas('cobrancas_pix')).toHaveLength(0)
  })

  it('e-mail de sandbox recusado: mensagem específica', async () => {
    cenario()
    mocks.fetch.mockResolvedValue(respostaMp(400, { errors: [{ code: 'invalid_email_for_sandbox' }] }))
    expect(await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)).toMatchObject({ erro: expect.stringContaining('ambiente de testes') })
  })

  it('outro erro do Mercado Pago: devolve erro genérico com o status e não grava nada', async () => {
    const db = cenario()
    mocks.fetch.mockResolvedValue(respostaMp(500, {}))
    expect(await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)).toMatchObject({ erro: expect.stringContaining('500') })
    expect(db.linhas('cobrancas_pix')).toHaveLength(0)
  })

  it('falha de rede: devolve erro e não grava nada', async () => {
    const db = cenario()
    mocks.fetch.mockRejectedValue(new Error('ECONNRESET'))
    expect(await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)).toHaveProperty('erro')
    expect(db.linhas('cobrancas_pix')).toHaveLength(0)
  })

  it('o log de falha nunca leva o Access Token nem o e-mail do pagador', async () => {
    cenario()
    mocks.fetch.mockResolvedValue(respostaMp(401, { message: 'invalid access token' }))
    await criarCobrancaPixMercadoPago(CONTA, PARCELA, 150)
    const logado = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)
    expect(logado).not.toContain(TOKEN_MP)
    expect(logado).not.toContain('cliente@exemplo.test')
  })
})
