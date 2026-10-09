import { createAdminClient } from '@/lib/supabase/admin'
import { decifrarSegredo } from '@/lib/crypto/segredos'

// Mercado Pago como provedor de PIX do CLIENTE FINAL: cada conta usa o Access Token da própria
// conta Mercado Pago (o dinheiro cai nela). Não confundir com o MP_ACCESS_TOKEN da plataforma,
// que cobra a assinatura do SaaS (app/api/mercadopago/webhook).
//
// API usada: Orders API (POST/GET /v1/orders) — a Orders API NÃO aceita notification_url por
// requisição (diferente da Preferences API de cartão): o Mercado Pago só chama a URL FIXA
// configurada no painel do próprio app ("Suas integrações" → Webhooks). Por isso cada conta
// configura essa URL única no seu app Mercado Pago e cola aqui a Secret Key gerada lá.
const MP_API = 'https://api.mercadopago.com'
const TIMEOUT_MS = 15_000

export type MpCreds = { accessToken: string }
export type MpResposta = { ok: boolean; status: number; data: any }

export async function getMpCreds(contaId: string): Promise<MpCreds | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('configuracoes')
    .select('mp_access_token')
    .eq('conta_id', contaId)
    .maybeSingle()

  if (error) throw new Error(`Falha ao ler as credenciais do Mercado Pago: ${error.message}`)
  if (!data?.mp_access_token) return null
  return { accessToken: decifrarSegredo(data.mp_access_token) }
}

export async function getMpWebhookSecret(contaId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('configuracoes')
    .select('mp_webhook_secret')
    .eq('conta_id', contaId)
    .maybeSingle()

  if (error) throw new Error(`Falha ao ler o webhook secret do Mercado Pago: ${error.message}`)
  if (!data?.mp_webhook_secret) return null
  return decifrarSegredo(data.mp_webhook_secret)
}

export async function mpRequest(
  path: string,
  opts: { method: 'GET' | 'POST'; token: string; body?: object; idempotencyKey?: string },
): Promise<MpResposta> {
  const res = await fetch(`${MP_API}${path}`, {
    method: opts.method,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
      ...(opts.idempotencyKey ? { 'X-Idempotency-Key': opts.idempotencyKey } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const texto = await res.text()
  let data: any = texto
  try { data = JSON.parse(texto) } catch { /* corpo não-JSON (ex.: HTML de erro): devolve o texto */ }
  return { ok: res.ok, status: res.status, data }
}
