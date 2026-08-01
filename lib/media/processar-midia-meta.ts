import { createAdminClient } from '@/lib/supabase/admin'

const META_GRAPH = 'https://graph.facebook.com/v19.0'

function mimeParaExt(mime: string): string {
  const m: Record<string, string> = {
    'image/jpeg':    'jpg',
    'image/png':     'png',
    'image/webp':    'webp',
    'image/gif':     'gif',
    'audio/ogg':     'ogg',
    'audio/mpeg':    'mp3',
    'audio/mp4':     'm4a',
    'video/mp4':     'mp4',
    'video/3gpp':    '3gp',
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/msword': 'doc',
    'application/vnd.ms-excel': 'xls',
  }
  return m[mime] ?? 'bin'
}

/**
 * Baixa mídia via Meta Graph API e armazena no Supabase Storage.
 * Retorna a URL pública permanente, ou null em caso de erro.
 */
export async function processarMidiaMeta(
  contaId: string,
  mediaId: string,
  mimeType: string,
): Promise<string | null> {
  const supabase = createAdminClient()

  const { data: cfg } = await supabase
    .from('configuracoes')
    .select('meta_access_token')
    .eq('conta_id', contaId)
    .maybeSingle()

  const token = (cfg as any)?.meta_access_token as string | undefined
  if (!token) return null

  try {
    // 1. Resolve URL de download via Graph API
    const infoRes = await fetch(`${META_GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache:   'no-store',
    })
    if (!infoRes.ok) {
      console.error('[processarMidiaMeta] info fetch', infoRes.status)
      return null
    }
    const info = await infoRes.json()
    const downloadUrl = info.url as string | undefined
    if (!downloadUrl) return null

    // 2. Baixa o arquivo com auth
    const fileRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache:   'no-store',
    })
    if (!fileRes.ok) {
      console.error('[processarMidiaMeta] file fetch', fileRes.status)
      return null
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer())

    // 3. Faz upload para Supabase Storage
    const ext  = mimeParaExt(mimeType)
    const path = `${contaId}/${mediaId}.${ext}`

    const { error } = await supabase.storage
      .from('midia-wa')
      .upload(path, buffer, { contentType: mimeType, upsert: true })

    if (error) {
      console.error('[processarMidiaMeta] upload', error.message)
      return null
    }

    const { data: { publicUrl } } = supabase.storage.from('midia-wa').getPublicUrl(path)
    return publicUrl
  } catch (err: any) {
    console.error('[processarMidiaMeta]', err?.message)
    return null
  }
}
