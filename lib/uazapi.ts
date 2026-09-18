const UAZAPI_URL   = process.env.UAZAPI_URL          || 'https://supercloudstore.uazapi.com'
// Suporta UAZAPI_ADMIN_TOKEN (local) e UAZAPI_GLOBAL_TOKEN (VPS legado)
const ADMIN_TOKEN  = process.env.UAZAPI_ADMIN_TOKEN  || process.env.UAZAPI_GLOBAL_TOKEN || ''

// 429 é rate limit transitório da uazapi — nunca deve ser tratado como "instância
// não existe mais". Um falso negativo aqui levaria a apagar/recriar uma instância
// que pode estar conectada de verdade, só porque a CHECAGEM foi limitada.
export class UazapiRateLimitError extends Error {}

export interface InstanceInfo {
  status: 'connected' | 'qr_ready' | 'connecting' | 'disconnected'
  qr:     string | null
  phone:  string | null
  nome?:  string | null
  rateLimited?: boolean
}

export interface CreatedInstance {
  id:    string
  token: string
}

export interface UazapiInstanceListItem {
  id:      string
  name:    string
  token:   string
  status:  string
  qrcode:  string | null
  owner:   string | null
}

// Nome determinístico da instância uazapi por conta — usado pelo painel (Vercel)
// e precisa continuar batendo com o que já existe no uazapi (não trocar).
export function instName(contaId: string): string {
  return `quita${contaId.replace(/-/g, '').slice(0, 10)}`
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function createInstance(name: string): Promise<CreatedInstance> {
  const res = await fetch(`${UAZAPI_URL}/instance/create`, {
    method:  'POST',
    headers: { admintoken: ADMIN_TOKEN, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name }),
  })
  if (res.status === 429) throw new UazapiRateLimitError('uazapi createInstance → 429')
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`uazapi createInstance HTTP ${res.status}: ${body.slice(0, 120)}`)
  }
  const data = await res.json() as { instance: { id: string; token: string } }
  return { id: data.instance.id, token: data.instance.token }
}

export async function deleteInstance(instanceToken: string): Promise<void> {
  await fetch(`${UAZAPI_URL}/instance`, {
    method:  'DELETE',
    headers: { token: instanceToken },
  }).catch(() => {})
}

// Apaga pelo nome determinístico (admintoken) — usado quando ainda não temos o
// token da instância em mãos (ex: primeira conexão, ou token perdido).
export async function deleteInstanceByName(name: string): Promise<void> {
  await fetch(`${UAZAPI_URL}/instance/${name}`, {
    method:  'DELETE',
    headers: { admintoken: ADMIN_TOKEN },
  }).catch(() => {})
}

// Lista todas as instâncias do projeto — leve, não aciona reconexão ao
// WhatsApp. Usar para sincronizar status de várias contas de uma vez
// (cron) ou recuperar o token de uma instância já existente.
export async function getAllInstances(): Promise<UazapiInstanceListItem[]> {
  const res = await fetch(`${UAZAPI_URL}/instance/all`, {
    headers: { admintoken: ADMIN_TOKEN },
  })
  if (res.status === 429) throw new UazapiRateLimitError('uazapi getAllInstances → 429')
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`uazapi getAllInstances HTTP ${res.status}: ${body.slice(0, 120)}`)
  }
  const data = await res.json()
  return Array.isArray(data) ? data as UazapiInstanceListItem[] : []
}

// ─── Por instância ────────────────────────────────────────────────────────────

// Triggers connection and returns the current QR / status.
// Safe to call repeatedly — just refreshes the QR if already connecting.
export async function connectInstance(instanceToken: string): Promise<InstanceInfo> {
  try {
    const res = await fetch(`${UAZAPI_URL}/instance/connect`, {
      method:  'POST',
      headers: { token: instanceToken },
    })
    if (res.status === 429) {
      // Não sabemos o estado real — reportar 'disconnected' aqui faria o
      // chamador apagar/recriar a instância por engano (ver conectarAction).
      return { status: 'connecting', qr: null, phone: null, rateLimited: true }
    }
    if (!res.ok) return { status: 'disconnected', qr: null, phone: null }

    const data = await res.json() as {
      connected: boolean
      instance:  { status: string; qrcode: string; owner: string; profileName?: string; name?: string }
    }
    const inst = data.instance

    if (data.connected) {
      const phone = inst.owner
        ? inst.owner.replace('@s.whatsapp.net', '').replace(/\D/g, '')
        : null
      return { status: 'connected', qr: null, phone, nome: inst.profileName ?? inst.name ?? null }
    }
    if (inst?.qrcode) return { status: 'qr_ready', qr: inst.qrcode, phone: null }
    return { status: 'connecting', qr: null, phone: null }
  } catch {
    return { status: 'disconnected', qr: null, phone: null }
  }
}

// Checagem leve de status — GET /instance/status, sem acionar reconexão.
// Usar para sincronização periódica (cron), nunca em loop apertado.
export async function getInstanceStatus(instanceToken: string): Promise<InstanceInfo> {
  try {
    const res = await fetch(`${UAZAPI_URL}/instance/status`, {
      headers: { token: instanceToken },
    })
    if (res.status === 429) return { status: 'connecting', qr: null, phone: null, rateLimited: true }
    if (!res.ok) return { status: 'disconnected', qr: null, phone: null }

    const data = await res.json() as { instance?: { owner?: string; profileName?: string; qrcode?: string } }
    const owner = data?.instance?.owner
    if (owner) {
      return {
        status: 'connected', qr: null,
        phone: owner.replace('@s.whatsapp.net', '').replace(/\D/g, ''),
        nome:  data?.instance?.profileName ?? null,
      }
    }
    const qr = data?.instance?.qrcode ?? null
    return { status: qr ? 'qr_ready' : 'disconnected', qr, phone: null }
  } catch {
    return { status: 'disconnected', qr: null, phone: null }
  }
}

export function formatPhoneNumber(number: string): string {
  let formatted = number.replace(/\D/g, '')
  if (!formatted.startsWith('55') && formatted.length <= 11) {
    formatted = '55' + formatted
  }
  return formatted
}

export async function sendText(
  instanceToken: string,
  number: string,
  text: string,
): Promise<void> {
  const res = await fetch(`${UAZAPI_URL}/send/text`, {
    method:  'POST',
    headers: { token: instanceToken, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ number: formatPhoneNumber(number), text }),
  })
  if (res.status === 429) throw new UazapiRateLimitError('uazapi sendText → 429')
  if (!res.ok) {
    const err = await res.json().catch(() => ({} as { error?: string }))
    throw new Error((err as { error?: string }).error || `uazapi sendText HTTP ${res.status}`)
  }
}

// Simula "digitando…"/"gravando áudio…" antes de mandar a mensagem de verdade —
// comportamento humano mínimo, pedido do dono do projeto. Best-effort: uma
// falha aqui nunca deve impedir o envio real que vem em seguida.
export async function sendPresence(
  instanceToken: string,
  number: string,
  delayMs: number,
  presence: 'composing' | 'recording' = 'composing',
): Promise<void> {
  await fetch(`${UAZAPI_URL}/message/presence`, {
    method:  'POST',
    headers: { token: instanceToken, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ number: formatPhoneNumber(number), presence, delay: delayMs }),
  }).catch(() => {})
}

export async function setWebhook(instanceToken: string, url: string): Promise<void> {
  await fetch(`${UAZAPI_URL}/webhook`, {
    method:  'POST',
    headers: { token: instanceToken, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url, enabled: true }),
  }).catch(() => {})
}
