const UAZAPI_URL   = process.env.UAZAPI_URL          || 'https://supercloudstore.uazapi.com'
// Suporta UAZAPI_ADMIN_TOKEN (local) e UAZAPI_GLOBAL_TOKEN (VPS legado)
const ADMIN_TOKEN  = process.env.UAZAPI_ADMIN_TOKEN  || process.env.UAZAPI_GLOBAL_TOKEN || ''

export interface InstanceInfo {
  status: 'connected' | 'qr_ready' | 'connecting' | 'disconnected'
  qr:     string | null
  phone:  string | null
}

export interface CreatedInstance {
  id:    string
  token: string
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function createInstance(name: string): Promise<CreatedInstance> {
  const res = await fetch(`${UAZAPI_URL}/instance/create`, {
    method:  'POST',
    headers: { admintoken: ADMIN_TOKEN, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name }),
  })
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

// ─── Por instância ────────────────────────────────────────────────────────────

// Seguro chamar repetidamente — retorna QR atualizado se ainda conectando.
export async function connectInstance(instanceToken: string): Promise<InstanceInfo> {
  try {
    const res = await fetch(`${UAZAPI_URL}/instance/connect`, {
      method:  'POST',
      headers: { token: instanceToken },
    })
    if (!res.ok) return { status: 'disconnected', qr: null, phone: null }

    const data = await res.json() as {
      connected: boolean
      instance:  { status: string; qrcode: string; owner: string }
    }
    const inst = data.instance

    if (data.connected) {
      const phone = inst.owner
        ? inst.owner.replace('@s.whatsapp.net', '').replace(/\D/g, '')
        : null
      return { status: 'connected', qr: null, phone }
    }
    if (inst?.qrcode) return { status: 'qr_ready', qr: inst.qrcode, phone: null }
    return { status: 'connecting', qr: null, phone: null }
  } catch {
    return { status: 'disconnected', qr: null, phone: null }
  }
}

export async function sendText(
  instanceToken: string,
  number: string,
  text: string,
): Promise<void> {
  let formatted = number.replace(/\D/g, '')
  if (!formatted.startsWith('55') && formatted.length <= 11) formatted = '55' + formatted

  const res = await fetch(`${UAZAPI_URL}/send/text`, {
    method:  'POST',
    headers: { token: instanceToken, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ number: formatted, text }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({} as { error?: string }))
    throw new Error((err as { error?: string }).error || `uazapi sendText HTTP ${res.status}`)
  }
}

export async function setWebhook(instanceToken: string, url: string): Promise<void> {
  await fetch(`${UAZAPI_URL}/webhook`, {
    method:  'POST',
    headers: { token: instanceToken, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url, enabled: true }),
  }).catch(() => {})
}
