import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from './_components/app-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: conta } = await supabase
    .from('contas')
    .select('id, status, validade_plano, nome_empresa')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (!conta) redirect('/sem-conta')

  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  const isBlocked =
    conta.status === 'suspensa' ||
    conta.status === 'expirada' ||
    (conta.validade_plano !== null && new Date(conta.validade_plano as string) < hoje)

  if (isBlocked) redirect('/plano-expirado')

  return (
    <AppShell nomeEmpresa={(conta as any).nome_empresa ?? ''}>
      {children}
    </AppShell>
  )
}
