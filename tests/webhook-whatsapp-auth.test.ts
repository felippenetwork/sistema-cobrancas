// Regressão do achado SEG-N1 (auditoria 2026-09-19): POST /api/webhooks/whatsapp
// aceitava qualquer requisição externa, sem validar o segredo da uazapi — dava
// pra injetar mensagem/atendimento falso em qualquer conta.
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseAtual: { current: unknown } = { current: null }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => supabaseAtual.current,
}))

import { POST } from '@/app/api/webhooks/whatsapp/route'

const CONTA_ID   = 'conta-uuid-1'
const UAZAPI_SEG = 'segredo-uazapi-de-teste'

// Fake mínimo do client Supabase — os testes de autenticação em si retornam
// antes de qualquer consulta real (EventType diferente de "messages").
function fakeSupabase() {
  return {
    from() {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        in: () => cadeia,
        neq: () => cadeia,
        is: () => cadeia,
        limit: () => cadeia,
        insert: () => cadeia,
        update: () => cadeia,
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      }
      return cadeia
    },
  }
}

function requisicao(corpo: string, opts: { url?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(opts.url ?? 'http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    body: corpo,
    headers: { 'content-type': 'application/json', ...opts.headers },
  })
}

describe('POST /api/webhooks/whatsapp — autenticação da uazapi', () => {
  const secretOriginal = process.env.UAZAPI_WEBHOOK_SECRET

  beforeEach(() => {
    supabaseAtual.current = fakeSupabase()
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
