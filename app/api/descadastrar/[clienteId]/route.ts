import { createHmac, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/descadastrar/{clienteId}?token={hmac}
// Marca o cliente como optout_email=true (link de e-mail).
// Requer token HMAC-SHA256(UNSUB_SECRET, clienteId) para impedir opt-out em massa por UUID.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clienteId: string }> },
) {
  const { clienteId } = await params
  const token = request.nextUrl.searchParams.get('token') ?? ''

  const secret = process.env.UNSUB_SECRET
  if (!secret) {
    console.error('[descadastrar] UNSUB_SECRET não configurado.')
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }

  const expected    = createHmac('sha256', secret).update(clienteId).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')

  if (token.length !== expected.length || !/^[0-9a-f]+$/i.test(token)) {
    return NextResponse.json({ error: 'token_invalido' }, { status: 401 })
  }

  if (!timingSafeEqual(Buffer.from(token, 'hex'), expectedBuf)) {
    return NextResponse.json({ error: 'token_invalido' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { error } = await admin
    .from('clientes')
    .update({ optout_email: true })
    .eq('id', clienteId)
    .is('deleted_at', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
