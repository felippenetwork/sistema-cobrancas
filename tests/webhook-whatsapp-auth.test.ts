// Regressão do achado SEG-N1 (auditoria 2026-09-19): POST /api/webhooks/whatsapp
// aceitava qualquer requisição externa, sem validar assinatura da Meta nem
// segredo da uazapi — dava pra injetar mensagem/atendimento falso em qualquer conta.
import { createHmac } from 'crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseAtual: { current: unknown } = { current: null }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => supabaseAtual.current,
}))
vi.mock('@/lib/media/processar-midia-meta', () => ({
  processarMidiaMeta: vi.fn(),
}))

import { POST } from '@/app/api/webhooks/whatsapp/route'

const PHONE_ID   = 'phone-123'
const CONTA_ID   = 'conta-uuid-1'
const APP_SECRET = 'app-secret-de-teste'
const UAZAPI_SEG = 'segredo-uazapi-de-teste'

// Fake mínimo do client Supabase: só o que o webhook consulta antes de processar
// mensagens (resolver conta por phone_number_id e ler meta_app_secret).
function fakeSupabase(opts: { appSecret: string | null | undefined }) {
  return {
    from(tabela: string) {
      const filtros: Record<string, unknown> = {}
      const cadeia = {
        select: () => cadeia,
        eq: (col: string, val: unknown) => { filtros[col] = val; return cadeia },
        in: () => cadeia,
        neq: () => cadeia,
        is: () => cadeia,
        limit: () => cadeia,
        insert: () => cadeia,
        update: () => cadeia,
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => {
          if (tabela === 'configuracoes' && 'meta_phone_number_id' in filtros) {
            return { data: filtros['meta_phone_number_id'] === PHONE_ID ? { conta_id: CONTA_ID } : null, error: null }
          }
          if (tabela === 'configuracoes' && filtros['conta_id'] === CONTA_ID) {
            return { data: opts.appSecret === undefined ? null : { meta_app_secret: opts.appSecret }, error: null }
          }
          return { data: null, error: null }
        },
      }
      return cadeia
    },
  }
}

function payloadMeta() {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE_ID }, messages: [], statuses: [] } }] }],
  }
}

function assinar(corpo: string, segredo: string) {
  return 'sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex')
}

function requisicao(corpo: string, opts: { url?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(opts.url ?? 'http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    body: corpo,
    headers: { 'content-type': 'application/json', ...opts.headers },
  })
}

describe('POST /api/webhooks/whatsapp — autenticação da Meta', () => {
  beforeEach(() => {
    supabaseAtual.current = fakeSupabase({ appSecret: APP_SECRET })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('rejeita com 401 evento Meta sem header de assinatura', async () => {
    const res = await POST(requisicao(JSON.stringify(payloadMeta())))
    expect(res.status).toBe(401)
  })

  it('rejeita com 401 evento Meta assinado com segredo errado', async () => {
    const corpo = JSON.stringify(payloadMeta())
    const res = await POST(requisicao(corpo, { headers: { 'x-hub-signature-256': assinar(corpo, 'outro-segredo') } }))
    expect(res.status).toBe(401)
  })

  it('rejeita com 401 evento Meta quando o corpo foi adulterado depois de assinado', async () => {
    const original = JSON.stringify(payloadMeta())
    const assinatura = assinar(original, APP_SECRET)
    const adulterado = JSON.stringify({ ...payloadMeta(), extra: 'injetado' })
    const res = await POST(requisicao(adulterado, { headers: { 'x-hub-signature-256': assinatura } }))
    expect(res.status).toBe(401)
  })

  it('rejeita com 401 quando a conta não tem meta_app_secret configurado (fail closed)', async () => {
    supabaseAtual.current = fakeSupabase({ appSecret: null })
    const corpo = JSON.stringify(payloadMeta())
    const res = await POST(requisicao(corpo, { headers: { 'x-hub-signature-256': assinar(corpo, APP_SECRET) } }))
    expect(res.status).toBe(401)
  })

  it('aceita com 200 evento Meta com assinatura válida do app secret da conta', async () => {
    const corpo = JSON.stringify(payloadMeta())
    const res = await POST(requisicao(corpo, { headers: { 'x-hub-signature-256': assinar(corpo, APP_SECRET) } }))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/webhooks/whatsapp — autenticação da uazapi', () => {
  const secretOriginal = process.env.UAZAPI_WEBHOOK_SECRET

  beforeEach(() => {
    supabaseAtual.current = fakeSupabase({ appSecret: APP_SECRET })
    process.env.UAZAPI_WEBHOOK_SECRET = UAZAPI_SEG
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    if (secretOriginal === undefined) delete process.env.UAZAPI_WEBHOOK_SECRET
    else process.env.UAZAPI_WEBHOOK_SECRET = secretOriginal
  })

  // EventType diferente de "messages" retorna logo após a validação — não precisa de mais nada do banco.
  const corpoUazapi = JSON.stringify({ EventType: 'presence' })

  it('rejeita com 401 evento uazapi sem secret na URL', async () => {
    const res = await POST(requisicao(corpoUazapi, { url: `http://localhost/api/webhooks/whatsapp?conta=${CONTA_ID}` }))
    expect(res.status).toBe(401)
  })

  it('rejeita com 401 evento uazapi com secret errado', async () => {
    const res = await POST(requisicao(corpoUazapi, { url: `http://localhost/api/webhooks/whatsapp?conta=${CONTA_ID}&secret=errado` }))
    expect(res.status).toBe(401)
  })

  it('rejeita com 401 evento uazapi quando UAZAPI_WEBHOOK_SECRET não está configurado no servidor (fail closed)', async () => {
    delete process.env.UAZAPI_WEBHOOK_SECRET
    const res = await POST(requisicao(corpoUazapi, { url: `http://localhost/api/webhooks/whatsapp?conta=${CONTA_ID}&secret=qualquer` }))
    expect(res.status).toBe(401)
  })

  it('aceita com 200 evento uazapi com o secret correto na URL', async () => {
    const res = await POST(requisicao(corpoUazapi, { url: `http://localhost/api/webhooks/whatsapp?conta=${CONTA_ID}&secret=${UAZAPI_SEG}` }))
    expect(res.status).toBe(200)
  })

  it('aceita o secret enviado pelo header x-webhook-secret', async () => {
    const res = await POST(requisicao(corpoUazapi, { headers: { 'x-webhook-secret': UAZAPI_SEG } }))
    expect(res.status).toBe(200)
  })
})
