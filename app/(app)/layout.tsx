import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from './_components/app-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Tenta resolver a conta do usuário: owner direto ou membro convidado
  let conta: { id: string; status: string | null; validade_plano: string | null; nome_empresa: string | null } | null = null

  const { data: contaOwner } = await supabase
    .from('contas')
    .select('id, status, validade_plano, nome_empresa')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (contaOwner) {
    conta = contaOwner
  } else {
    // Membro convidado — busca conta via membros_conta
    const { data: membro } = await supabase
      .from('membros_conta')
      .select('conta_id')
      .eq('user_id', user.id)
      .eq('ativo', true)
      .maybeSingle()

    if (membro) {
      const { data: contaMembro } = await supabase
        .from('contas')
        .select('id, status, validade_plano, nome_empresa')
        .eq('id', membro.conta_id)
        .maybeSingle()

      conta = contaMembro ?? null
    }
  }

  if (!conta) redirect('/sem-conta')

  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  const isBlocked =
    conta.status === 'suspensa' ||
    conta.status === 'expirada' ||
    (conta.validade_plano !== null && new Date(conta.validade_plano as string) < hoje)

  if (isBlocked) redirect('/plano-expirado')

  return (
    <AppShell nomeEmpresa={conta.nome_empresa ?? ''}>
      {children}
    </AppShell>
  )
}
