// Webhook WhatsApp — recebe mensagens de clientes via uazapi ou Meta Cloud API.
// URL a configurar no uazapi: https://seu-dominio.com/api/webhooks/whatsapp?conta=UUID
// URL Meta: https://seu-dominio.com/api/webhooks/whatsapp (GET para verificação + POST para eventos)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
    const body     = await req.json()
    const contaId  = req.nextUrl.searchParams.get('conta') ?? null
    const supabase = createAdminClient()

    // ── Meta Cloud API ────────────────────────────────────────────────────────
    if (body?.object === 'whatsapp_business_account') {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value   = change.value ?? {}
          const msgs    = value.messages ?? []
          if (!msgs.length) continue

          // Resolve a conta pelo phone_number_id do metadata da Meta
          const phoneId = value.metadata?.phone_number_id as string | undefined
          const cid     = phoneId
            ? await resolverContaPorMetaPhoneId(supabase, phoneId)
            : (contaId ?? await resolverContaPorCelular(supabase, msgs[0]?.from ?? ''))

          if (!cid) continue

          for (const msg of msgs) {
            if (msg.type !== 'text') continue
            const celular = msg.from as string
            const texto   = (msg.text?.body ?? '') as string
            const waId    = msg.id as string

            await salvarMensagem(supabase, { contaId: cid, celular, texto, waId, direcao: 'in' })
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

      const waId     = (msg?.id ?? msg?.key?.id ?? null) as string | null
      const cid      = contaId
                    ?? await resolverContaPorInstancia(supabase, body?.instanceName)
                    ?? await resolverContaPorCelular(supabase, celular)
      if (!cid) return NextResponse.json({ ok: true })

      await salvarMensagem(supabase, { contaId: cid, celular, texto, waId, direcao: 'in' })
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

        const texto = (
          msg?.message?.conversation ??
          msg?.message?.extendedTextMessage?.text ??
          msg?.message?.imageMessage?.caption ??
          msg?.body ??
          msg?.text ??
          '[Mídia não suportada]'
        ) as string

        const waId     = (msg?.key?.id ?? msg?.id ?? null) as string | null
        const cidFinal = cid ?? await resolverContaPorCelular(supabase, celular)
        if (!cidFinal) continue

        await salvarMensagem(supabase, { contaId: cidFinal, celular, texto, waId, direcao: 'in' })
      }
    }

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error('[webhook/whatsapp]', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function encontrarOuCriarAtendimento(
  supabase: ReturnType<typeof createAdminClient>,
  contaId: string,
  celular: string,
  clienteId: string | null,
  texto: string,
): Promise<string | null> {
  // Busca atendimento aberto (aguardando | em_atendimento)
  const { data: existing } = await supabase
    .from('atendimentos')
    .select('id')
    .eq('conta_id', contaId)
    .eq('celular', celular)
    .neq('status', 'finalizado')
    .maybeSingle()

  if (existing) {
    await supabase
      .from('atendimentos')
      .update({ ultima_mensagem: texto, ultima_msg_em: new Date().toISOString() })
      .eq('id', existing.id)
    return existing.id
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
  params: { contaId: string; celular: string; texto: string; waId: string | null; direcao: 'in' | 'out' },
) {
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('conta_id', params.contaId)
    .eq('celular', params.celular)
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
    wa_id:          params.waId,
    lida:           false,
  })

  // Duplicata (wa_id já existe) → ignorar silenciosamente
  if (error && error.code !== '23505') {
    console.error('[webhook/whatsapp] salvarMensagem', error, params)
  }
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
    .eq('celular', celular)
    .limit(1)
    .maybeSingle()
  return (data?.conta_id as string) ?? null
}
