import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/descadastrar/{clienteId}
// Marca o cliente como optout_email=true (acessível sem autenticação — link de e-mail).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ clienteId: string }> },
) {
  const { clienteId } = await params
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
