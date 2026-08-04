// Webhook WhatsApp — recebe mensagens de clientes via uazapi ou Meta Cloud API.
// URL a configurar no uazapi: https://seu-dominio.com/api/webhooks/whatsapp?conta=UUID
// URL Meta: https://seu-dominio.com/api/webhooks/whatsapp (GET para verificação + POST para eventos)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processarMidiaMeta } from '@/lib/media/processar-midia-meta'
import { celularVariantes } from '@/lib/utils/celular'

// ── Meta Cloud API: verificação do webhook (GET) ─────────────────────────────
export async function GET(req: NextRequest) {
  const params    = req.nextUrl.searchParams
  const mode      = params.get('hub.mode')
  const token     = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ ok: true })
}

// ── Receber mensagens (POST) ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const contaId  = req.nextUrl.searchParams.get('conta') ?? null
    const supabase = createAdminClient()

    // ── Twilio WhatsApp ───────────────────────────────────────────────────────
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const raw        = await req.text()
      const params     = new URLSearchParams(raw)
      const from       = (params.get('From') ?? '').replace('whatsapp:+', '').replace(/\D/g, '')
      const texto      = params.get('Body') ?? ''
      const waId       = params.get('MessageSid') ?? null
      const accountSid = params.get('AccountSid') ?? null

      if (!from || !texto) return NextResponse.json({ ok: true })

      const cid = accountSid
        ? await resolverContaPorTwilioSid(supabase, accountSid)
        : (contaId ?? await resolverContaPorCelular(supabase, from))

      if (cid) {
        await salvarMensagem(supabase, { contaId: cid, celular: from, texto, waId, direcao: 'in' })
      }
      return NextResponse.json({ ok: true })
    }

    const body     = await req.json()

    // ── Meta Cloud API ────────────────────────────────────────────────────────
    if (body?.object === 'whatsapp_business_account') {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value ?? {}

          // Resolve conta pelo phone_number_id do metadata
          const phoneId = value.metadata?.phone_number_id as string | undefined
          const msgs    = value.messages ?? []
          const firstCelular = msgs[0]?.from ?? ''
          const cid = phoneId
            ? await resolverContaPorMetaPhoneId(supabase, phoneId)
            : (contaId ?? (firstCelular ? await resolverContaPorCelular(supabase, firstCelular) : null))

          if (!cid) continue

          // ── Status de entrega (enviado → entregue → lido / erro) ──────────
          for (const st of (value.statuses ?? []) as any[]) {
            const interno = metaStatusParaInterno(st.status as string)
            if (interno && st.id) {
              await supabase.from('mensagens_wa')
                .update({ status: interno } as any)
                .eq('wa_id', st.id)
                .eq('conta_id', cid)
            }
          }

          // ── Mensagens recebidas ───────────────────────────────────────────
          for (const msg of msgs) {
            const celular = msg.from as string
            const waId    = msg.id   as string
            if (!celular) continue

            const info = extrairInfoMeta(msg)
            if (!info.texto && !info.mediaId) continue

            let midiaUrl: string | null = null
            if (info.mediaId && info.mimeType) {
              midiaUrl = await processarMidiaMeta(cid, info.mediaId, info.mimeType)
            }

            await salvarMensagem(supabase, {
              contaId: cid, celular, texto: info.texto, waId, direcao: 'in',
              tipo: info.tipo, midiaUrl,
            })
          }
        }
      }
      return NextResponse.json({ ok: true })
    }

    // ── uazapiGO: body.EventType + phone em body.chat.phone ──────────────────
    if (body?.EventType) {
      if (body.EventType !== 'messages') return NextResponse.json({ ok: true })

      const msg    = body.message
      const fromMe = msg?.fromMe ?? msg?.key?.fromMe ?? false
      if (!msg || fromMe) return NextResponse.json({ ok: true })

      const rawPhone = (body?.chat?.phone ?? msg?.chatId ?? msg?.key?.remoteJid ?? msg?.from ?? '') as string
      const celular  = rawPhone.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '')
      if (!celular) return NextResponse.json({ ok: true })

      const texto = extrairTexto(msg) as string
      const tipo  = detectarTipoUazapi(msg)

      const waId     = (msg?.id ?? msg?.key?.id ?? null) as string | null
      const cid      = contaId
                    ?? await resolverContaPorInstancia(supabase, body?.instanceName)
                    ?? await resolverContaPorCelular(supabase, celular)
      if (!cid) return NextResponse.json({ ok: true })

      await salvarMensagem(supabase, { contaId: cid, celular, texto, waId, direcao: 'in', tipo })
      return NextResponse.json({ ok: true })
    }

    // ── uazapi v2 / Baileys: body.event (minúsculo) ───────────────────────────
    const event = (body?.event ?? '') as string
    const msgs: any[] = (() => {
      if (Array.isArray(body?.data?.messages)) return body.data.messages
      if (Array.isArray(body?.data))           return body.data
      if (Array.isArray(body?.messages))       return body.messages
      if (body?.data)                          return [body.data]
      if (body?.message)                       return [body.message]
      return []
    })()

    if (event.startsWith('message') || event === 'msg' || msgs.length > 0) {
      const cid = contaId ?? await resolverContaPorInstancia(supabase, body?.instance ?? body?.instanceName)

      for (const msg of msgs) {
        const fromMe = msg?.key?.fromMe ?? msg?.fromMe ?? false
        if (fromMe) continue

        const remoteJid = (msg?.key?.remoteJid ?? msg?.remoteJid ?? msg?.from ?? '') as string
        const celular   = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '')
        if (!celular) continue

        const texto = extrairTexto(msg) as string
        const tipo  = detectarTipoUazapi(msg)

        const waId     = (msg?.key?.id ?? msg?.id ?? null) as string | null
        const cidFinal = cid ?? await resolverContaPorCelular(supabase, celular)
        if (!cidFinal) continue

        await salvarMensagem(supabase, { contaId: cidFinal, celular, texto, waId, direcao: 'in', tipo })
      }
    }

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error('[webhook/whatsapp]', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type MetaMsgInfo = { texto: string; tipo: string; mediaId: string | null; mimeType: string | null }

function extrairInfoMeta(msg: any): MetaMsgInfo {
  const tipo = (msg?.type ?? 'text') as string
  switch (tipo) {
    case 'text':
      return { texto: msg.text?.body ?? '', tipo: 'text', mediaId: null, mimeType: null }
    case 'image':
      return {
        texto:    msg.image?.caption ? `[Imagem] ${msg.image.caption}` : '[Imagem]',
        tipo:     'image',
        mediaId:  msg.image?.id     ?? null,
        mimeType: msg.image?.mime_type ?? 'image/jpeg',
      }
    case 'audio':
      return {
        texto:    '[Áudio]',
        tipo:     'audio',
        mediaId:  msg.audio?.id     ?? null,
        mimeType: msg.audio?.mime_type ?? 'audio/ogg',
      }
    case 'video':
      return {
        texto:    msg.video?.caption ? `[Vídeo] ${msg.video.caption}` : '[Vídeo]',
        tipo:     'video',
        mediaId:  msg.video?.id     ?? null,
        mimeType: msg.video?.mime_type ?? 'video/mp4',
      }
    case 'document':
      return {
        texto:    msg.document?.filename ?? msg.document?.caption ?? '[Arquivo]',
        tipo:     'document',
        mediaId:  msg.document?.id       ?? null,
        mimeType: msg.document?.mime_type ?? 'application/octet-stream',
      }
    case 'sticker':
      return {
        texto:    '[Figurinha]',
        tipo:     'sticker',
        mediaId:  msg.sticker?.id     ?? null,
        mimeType: msg.sticker?.mime_type ?? 'image/webp',
      }
    case 'interactive': {
      const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply
      return { texto: reply?.title ?? '[Resposta interativa]', tipo: 'interactive', mediaId: null, mimeType: null }
    }
    case 'location':
      return {
        texto:    `[Localização: ${msg.location?.latitude},${msg.location?.longitude}]`,
        tipo:     'location', mediaId: null, mimeType: null,
      }
    case 'contacts':
      return { texto: '[Contato]', tipo: 'contacts', mediaId: null, mimeType: null }
    default:
      return { texto: `[${tipo}]`, tipo, mediaId: null, mimeType: null }
  }
}

function detectarTipoUazapi(msg: any): string {
  const m = msg?.message ?? {}
  if (m.imageMessage)                      return 'image'
  if (m.audioMessage || m.pttMessage)      return 'audio'
  if (m.videoMessage)                      return 'video'
  if (m.documentMessage)                   return 'document'
  if (m.stickerMessage)                    return 'sticker'
  // uazapiGO: mediaType field
  const mt = (msg?.mediaType ?? '') as string
  if (mt === 'image')    return 'image'
  if (mt === 'audio')    return 'audio'
  if (mt === 'video')    return 'video'
  if (mt === 'document') return 'document'
  return 'text'
}

function metaStatusParaInterno(s: string): string | null {
  if (s === 'sent')      return 'enviado'
  if (s === 'delivered') return 'entregue'
  if (s === 'read')      return 'lido'
  if (s === 'failed')    return 'erro'
  return null
}

async function encontrarOuCriarAtendimento(
  supabase: ReturnType<typeof createAdminClient>,
  contaId: string,
  celular: string,
  clienteId: string | null,
  texto: string,
): Promise<string | null> {
  // Busca atendimento aberto — tenta variantes do número para evitar duplicatas
  // quando WhatsApp envia o número com ou sem o 9 transitório brasileiro
  const { data: existing } = await supabase
    .from('atendimentos')
    .select('id, cliente_id')
    .eq('conta_id', contaId)
    .in('celular', celularVariantes(celular))
    .neq('status', 'finalizado')
    .maybeSingle()

  if (existing) {
    const vincularCliente = clienteId && !(existing as any).cliente_id
    await supabase.from('atendimentos').update({
      ultima_mensagem: texto,
      ultima_msg_em:   new Date().toISOString(),
      ...(vincularCliente ? { cliente_id: clienteId } : {}),
    } as any).eq('id', (existing as any).id)
    return (existing as any).id
  }

  // Busca departamento padrão (Geral) da conta
  const { data: deptGeral } = await supabase
    .from('departamentos')
    .select('id')
    .eq('conta_id', contaId)
    .eq('nome', 'Geral')
    .maybeSingle()

  const { data: novo, error } = await supabase
    .from('atendimentos')
    .insert({
      conta_id:        contaId,
      celular,
      cliente_id:      clienteId,
      departamento_id: deptGeral?.id ?? null,
      status:          'aguardando',
      ultima_mensagem: texto,
      ultima_msg_em:   new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    // conflito de unicidade (race condition): busca novamente
    if (error.code === '23505') {
      const { data: race } = await supabase
        .from('atendimentos')
        .select('id')
        .eq('conta_id', contaId)
        .eq('celular', celular)
        .neq('status', 'finalizado')
        .maybeSingle()
      return race?.id ?? null
    }
    console.error('[webhook] encontrarOuCriarAtendimento', error)
    return null
  }

  return novo?.id ?? null
}

function extrairTexto(msg: any): string {
  // 1. Proto padrão: texto simples
  if (msg?.message?.conversation)              return msg.message.conversation
  // 2. Proto padrão: texto extendido (com contextInfo, reply, etc.)
  if (msg?.message?.extendedTextMessage?.text) return msg.message.extendedTextMessage.text
  // 3. Legenda de mídia
  if (msg?.message?.imageMessage?.caption)     return msg.message.imageMessage.caption
  if (msg?.message?.videoMessage?.caption)     return msg.message.videoMessage.caption
  // 4. uazapiGO: content pode ser objeto {text, contextInfo} ou JSON string do mesmo
  const content = msg?.content
  if (content) {
    if (typeof content === 'object' && content.text) return content.text
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content)
        if (parsed?.text) return parsed.text
        if (parsed?.URL || parsed?.url) return '[Mídia]'
      } catch { /* não é JSON */ }
    }
  }
  // 5. Campos simples
  if (msg?.body && typeof msg.body === 'string') return msg.body
  if (msg?.text && typeof msg.text === 'string') return msg.text
  // 6. Mídia sem texto detectável
  const tipo = msg?.mediaType ?? msg?.message?.audioMessage ? 'Áudio' : 'Mídia'
  return `[${tipo}]`
}

async function salvarMensagem(
  supabase: ReturnType<typeof createAdminClient>,
  params: {
    contaId: string; celular: string; texto: string; waId: string | null; direcao: 'in' | 'out'
    tipo?: string; midiaUrl?: string | null
  },
) {
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('conta_id', params.contaId)
    .in('celular', celularVariantes(params.celular))
    .maybeSingle()

  // Para mensagens recebidas (in), vincula ao atendimento (cria se necessário)
  let atendimentoId: string | null = null
  if (params.direcao === 'in') {
    atendimentoId = await encontrarOuCriarAtendimento(
      supabase,
      params.contaId,
      params.celular,
      cliente?.id ?? null,
      params.texto,
    )
  }

  const { error } = await supabase.from('mensagens_wa').insert({
    conta_id:       params.contaId,
    cliente_id:     cliente?.id ?? null,
    atendimento_id: atendimentoId,
    celular:        params.celular,
    direcao:        params.direcao,
    texto:          params.texto,
    tipo:           params.tipo ?? 'text',
    midia_url:      params.midiaUrl ?? null,
    wa_id:          params.waId,
    lida:           false,
  } as any)

  // Duplicata (wa_id já existe) → ignorar silenciosamente
  if (error && error.code !== '23505') {
    console.error('[webhook/whatsapp] salvarMensagem', error, params)
  }
}

async function resolverContaPorTwilioSid(
  supabase: ReturnType<typeof createAdminClient>,
  accountSid: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('configuracoes')
    .select('conta_id')
    .eq('twilio_account_sid', accountSid)
    .maybeSingle()
  return (data?.conta_id as string) ?? null
}

async function resolverContaPorMetaPhoneId(
  supabase: ReturnType<typeof createAdminClient>,
  phoneNumberId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('configuracoes')
    .select('conta_id')
    .eq('meta_phone_number_id', phoneNumberId)
    .maybeSingle()
  return (data?.conta_id as string) ?? null
}

async function resolverContaPorInstancia(
  supabase: ReturnType<typeof createAdminClient>,
  instanceName: string | undefined,
): Promise<string | null> {
  if (!instanceName) return null
  // Nome da instância: quita + primeiros 10 chars do contaId sem hífens
  // Buscar todas as contas e achar qual bate
  const { data: conexoes } = await supabase
    .from('conexoes')
    .select('conta_id')

  for (const row of conexoes ?? []) {
    const cid = row.conta_id as string
    const expected = `quita${cid.replace(/-/g, '').slice(0, 10)}`
    if (expected === instanceName) return cid
  }
  return null
}

async function resolverContaPorCelular(
  supabase: ReturnType<typeof createAdminClient>,
  celular: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('clientes')
    .select('conta_id')
    .in('celular', celularVariantes(celular))
    .limit(1)
    .maybeSingle()
  return (data?.conta_id as string) ?? null
}
