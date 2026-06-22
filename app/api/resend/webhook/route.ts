import { Webhook } from 'svix'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Mapeamento de eventos Resend → status interno
const STATUS_MAP: Record<string, string> = {
  'email.sent':             'enviado',
  'email.delivered':        'entregue',
  'email.opened':           'aberto',
  'email.bounced':          'falhou',
  'email.complained':       'falhou',
  'email.delivery_delayed': 'enviado',  // ainda em trânsito, não é falha
}

// POST /api/resend/webhook
// Recebe eventos do Resend e atualiza notificacoes_enviadas.status.
// Configurar RESEND_WEBHOOK_SECRET no painel do Resend → Webhooks.
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET

  if (!secret) {
    console.error('RESEND_WEBHOOK_SECRET não configurado.')
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 })
  }

  const rawBody = await request.text()

  // Verificar assinatura Svix (Resend usa Svix para entrega de webhooks)
  const wh = new Webhook(secret)
  let event: { type: string; data: { email_id: string; [k: string]: unknown } }

  try {
    event = wh.verify(rawBody, {
      'svix-id':        request.headers.get('svix-id')        ?? '',
      'svix-timestamp': request.headers.get('svix-timestamp') ?? '',
      'svix-signature': request.headers.get('svix-signature') ?? '',
    }) as typeof event
  } catch {
    console.warn('[resend-webhook] Assinatura Svix inválida — possível tentativa não autorizada.')
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 })
  }

  const novoStatus = STATUS_MAP[event.type]
  if (!novoStatus) {
    // Evento desconhecido — ack e ignora
    return NextResponse.json({ ok: true })
  }

  const resendMsgId = event.data?.email_id as string | undefined
  if (!resendMsgId) {
    return NextResponse.json({ error: 'missing_email_id' }, { status: 400 })
  }

  // Atualizar status da notificação correspondente (service role bypassa RLS)
  const admin = createAdminClient()
  await admin
    .from('notificacoes_enviadas')
    .update({ status: novoStatus })
    .eq('resend_message_id', resendMsgId)
    .in('status', ['fila', 'enviado', 'entregue'])  // não regredir status

  return NextResponse.json({ ok: true })
}
