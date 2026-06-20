// Página de descadastro de e-mail (unsubscribe).
// Acessível sem autenticação (link enviado por e-mail).
// Usa service role para atualizar clientes.optout_email = true.

import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import DescadastrarForm from './_form'

export const metadata = { title: 'Descadastro de e-mail' }

export default async function DescadastrarPage({
  params,
}: {
  params: Promise<{ clienteId: string }>
}) {
  const { clienteId } = await params
  const admin = createAdminClient()

  const { data: cliente } = await admin
    .from('clientes')
    .select('id, nome, optout_email, deleted_at')
    .eq('id', clienteId)
    .is('deleted_at', null)
    .single()

  if (!cliente) notFound()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
        {(cliente as any).optout_email ? (
          <>
            <h1 className="text-base font-semibold text-foreground">Já descadastrado</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Você já não está recebendo e-mails desta empresa.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-base font-semibold text-foreground">Descadastro de e-mail</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Deseja parar de receber e-mails de cobrança de{' '}
              <strong className="text-foreground">{(cliente as any).nome}</strong>?
            </p>
            <DescadastrarForm clienteId={clienteId} />
          </>
        )}
      </div>
    </div>
  )
}
