import https from 'node:https'
import { createAdminClient } from '@/lib/supabase/admin'

export type EfiCreds = {
  clientId:     string
  clientSecret: string
  pixKey:       string
  certBase64:   string
  sandbox:      boolean
}

export type EfiResponse = { ok: boolean; status: number; data: any }

export async function getEfiCreds(contaId: string): Promise<EfiCreds | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('configuracoes')
    .select('efi_client_id, efi_client_secret, efi_pix_key, efi_cert_base64, efi_sandbox')
    .eq('conta_id', contaId)
    .maybeSingle()

  const c = data as any
  if (!c?.efi_client_id || !c?.efi_client_secret || !c?.efi_pix_key || !c?.efi_cert_base64) {
    return null
  }
  return {
    clientId:     c.efi_client_id     as string,
    clientSecret: c.efi_client_secret as string,
    pixKey:       c.efi_pix_key       as string,
    certBase64:   c.efi_cert_base64   as string,
    sandbox:      !!(c.efi_sandbox),
  }
}

export function efiBaseUrl(sandbox: boolean): string {
  return sandbox
    ? 'https://pix-h.api.efipay.com.br'
    : 'https://pix.api.efipay.com.br'
}

// Requisição mTLS via node:https (suporta certificado pfx)
export function efiRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  certBase64: string,
): Promise<EfiResponse> {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url)
    const pfx     = Buffer.from(certBase64, 'base64')
    const options: https.RequestOptions = {
      hostname:   parsed.hostname,
      port:       parsed.port || 443,
      path:       parsed.pathname + parsed.search,
      method,
      headers,
      pfx,
      passphrase: '',
    }

    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', (chunk: Buffer) => { raw += chunk.toString() })
      res.on('end', () => {
        const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300
        try {
          resolve({ ok, status: res.statusCode ?? 0, data: JSON.parse(raw) })
        } catch {
          resolve({ ok: false, status: res.statusCode ?? 0, data: raw })
        }
      })
    })

    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

export async function getEfiToken(creds: EfiCreds): Promise<string> {
  const base     = efiBaseUrl(creds.sandbox)
  const basic    = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')
  const res      = await efiRequest(
    `${base}/oauth/token`,
    'POST',
    { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    JSON.stringify({ grant_type: 'client_credentials' }),
    creds.certBase64,
  )
  if (!res.ok) throw new Error(`EfiBanK auth falhou (${res.status}): ${JSON.stringify(res.data)}`)
  return res.data.access_token as string
}

export async function efiAuthRequest(
  url: string,
  method: string,
  body: object | undefined,
  creds: EfiCreds,
  token: string,
): Promise<EfiResponse> {
  return efiRequest(
    url,
    method,
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body ? JSON.stringify(body) : undefined,
    creds.certBase64,
  )
}
