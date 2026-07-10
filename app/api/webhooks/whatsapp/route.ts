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
          const msgs = change.value?.messages ?? []
          for (const msg of msgs) {
            if (msg.type !== 'text') continue
            const celular = msg.from as string
            const texto   = (msg.text?.body ?? '') as string
            const waId    = msg.id as string

            const cid = contaId ?? await resolverContaPorCelular(supabase, celular)
            if (!cid) continue

            await salvarMensagem(supabase, { contaId: cid, celular, texto, waId, direcao: 'in' })
          }
        }
      }
      return NextResponse.json({ ok: true })
    }

    // ── uazapi: evento messages.upsert ────────────────────────────────────────
    const event = body?.event as string | undefined
    if (event === 'messages.upsert' || event === 'message') {
      const msgs: any[] = body?.data?.messages ?? (body?.data ? [body.data] : [])

      for (const msg of msgs) {
        const fromMe  = msg?.key?.fromMe as boolean
        if (fromMe) continue  // ignorar mensagens enviadas por nós

        const remoteJid = (msg?.key?.remoteJid ?? msg?.remoteJid ?? '') as string
        const celular   = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '')
        if (!celular) continue

        const texto = (
          msg?.message?.conversation ??
          msg?.message?.extendedTextMessage?.text ??
          msg?.message?.imageMessage?.caption ??
          '[Mídia não suportada]'
        ) as string

        const waId = (msg?.key?.id ?? null) as string | null

        const cid = contaId ?? await resolverContaPorInstancia(supabase, body?.instance)
        if (!cid) continue

        await salvarMensagem(supabase, { contaId: cid, celular, texto, waId, direcao: 'in' })
      }
      return NextResponse.json({ ok: true })
    }

    // Evento não tratado — responde 200 para o uazapi não retentar
    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error('[webhook/whatsapp]', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function salvarMensagem(
  supabase: ReturnType<typeof createAdminClient>,
  params: { contaId: string; celular: string; texto: string; waId: string | null; direcao: 'in' | 'out' },
) {
  // Encontrar cliente pelo celular (normalizado)
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('conta_id', params.contaId)
    .eq('celular', params.celular)
    .maybeSingle()

  const { error } = await supabase.from('mensagens_wa').insert({
    conta_id:   params.contaId,
    cliente_id: cliente?.id ?? null,
    celular:    params.celular,
    direcao:    params.direcao,
    texto:      params.texto,
    wa_id:      params.waId,
    lida:       false,
  })

  // Duplicata (wa_id já existe) → ignorar silenciosamente
  if (error && error.code !== '23505') {
    console.error('[webhook/whatsapp] salvarMensagem', error, params)
  }
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
