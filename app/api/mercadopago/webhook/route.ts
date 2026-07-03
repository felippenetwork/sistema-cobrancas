import { createHmac } from 'crypto'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/types/database'

// POST /api/mercadopago/webhook
// Recebe eventos do MP e atualiza assinaturas + validade do plano.
// Idempotência: verifica se o evento já foi processado via ultimo_evento_mp.
// Segurança: valida HMAC-SHA256 da assinatura MP (x-signature header).
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const secret  = process.env.MP_WEBHOOK_SECRET

  if (!secret) {
    console.error('[mp-webhook] MP_WEBHOOK_SECRET não configurado — recusando requisição.')
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }

  // Validar assinatura (obrigatório)
  const xSignature = request.headers.get('x-signature') ?? ''
  const xRequestId = request.headers.get('x-request-id') ?? ''

  // Formato: ts={ts},v1={hash}
  const tsMatch   = xSignature.match(/ts=(\d+)/)
  const hashMatch = xSignature.match(/v1=([a-f0-9]+)/)

  if (!tsMatch || !hashMatch) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 401 })
  }

  const ts       = tsMatch[1]
  const expected = createHmac('sha256', secret)
    .update(`id:;request-id:${xRequestId};ts:${ts}`)  // MP signing template
    .digest('hex')

  if (expected !== hashMatch[1]) {
    console.warn('[mp-webhook] Assinatura HMAC inválida — possível tentativa não autorizada.')
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  let body: { type?: string; action?: string; data?: { id?: string }; id?: string | number }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const admin = createAdminClient()

  // ── Evento de pagamento ────────────────────────────────────────────────────
  if (body.type === 'payment' && body.data?.id) {
    await processarPagamento(admin, String(body.data.id))
  }

  // ── Evento de preapproval (atualização de status) ──────────────────────────
  if (body.type === 'subscription_preapproval' && body.data?.id) {
    await sincronizarPreapproval(admin, String(body.data.id))
  }

  return NextResponse.json({ ok: true })
}

// ── Processar pagamento aprovado ─────────────────────────────────────────────
async function processarPagamento(admin: ReturnType<typeof createAdminClient>, paymentId: string) {
  const token = process.env.MP_ACCESS_TOKEN
  if (!token) return

  // Buscar detalhes do pagamento no MP
  const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null)
  if (!payRes?.ok) return

  const payment = await payRes.json()
  if (payment.status !== 'approved') return

  const preapprovalId = payment.metadata?.preapproval_id ?? payment.preapproval_id
  if (!preapprovalId) return

  // Buscar assinatura correspondente
  const { data: assinatura } = await admin
    .from('assinaturas')
    .select('id, conta_id, ultimo_evento_mp, status')
    .eq('mp_preapproval_id', preapprovalId)
    .maybeSingle()
  if (!assinatura) return

  // Idempotência: ignorar evento já processado
  const ultimo = assinatura.ultimo_evento_mp as { payment_id?: string } | null
  if (ultimo?.payment_id === paymentId) return

  // Renovar validade do plano (+30 dias a partir de hoje em SP)
  const hojeStr   = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const nova      = new Date(`${hojeStr}T00:00:00-03:00`)
  nova.setDate(nova.getDate() + 30)
  const novaValidade = nova.toISOString().slice(0, 10)

  await admin.from('contas')
    .update({ status: 'ativa', validade_plano: novaValidade })
    .eq('id', assinatura.conta_id)

  await admin.from('assinaturas')
    .update({
      status:            'ativa',
      proximo_vencimento: novaValidade,
      ultimo_evento_mp:  { payment_id: paymentId, data: new Date().toISOString() },
    })
    .eq('id', assinatura.id)
}

// ── Sincronizar status do preapproval ───────────────────────────────────────
async function sincronizarPreapproval(admin: ReturnType<typeof createAdminClient>, preapprovalId: string) {
  const token = process.env.MP_ACCESS_TOKEN
  if (!token) return

  const res = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null)
  if (!res?.ok) return

  const pp     = await res.json()
  const status = pp.status  // authorized | paused | cancelled

  const statusMap: Record<string, Enums<'assinatura_status'>> = {
    authorized: 'ativa',
    paused:     'inadimplente',
    cancelled:  'cancelada',
  }
  const novoStatus = statusMap[status]
  if (!novoStatus) return

  await admin.from('assinaturas')
    .update({ status: novoStatus })
    .eq('mp_preapproval_id', preapprovalId)

  // Suspender conta se assinatura cancelada ou inadimplente
  if (novoStatus === 'cancelada') {
    const { data: ass } = await admin.from('assinaturas').select('conta_id').eq('mp_preapproval_id', preapprovalId).single()
    if (ass) {
      const { error: suspErr } = await admin.from('contas').update({ status: 'suspensa' }).eq('id', ass.conta_id)
      if (suspErr) console.error('[mp-webhook] contas.suspender', suspErr, { contaId: ass.conta_id })
    }
  }
}
