import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { EquipeClient } from './_components/equipe-client'

export const dynamic = 'force-dynamic'

export default async function EquipePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resolve conta (owner ou membro)
  let contaId: string | null = null
  const { data: conta } = await supabase
    .from('contas')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (conta) {
    contaId = conta.id
  } else {
    const { data: membro } = await supabase
      .from('membros_conta')
      .select('conta_id, role')
      .eq('user_id', user.id)
      .eq('ativo', true)
      .maybeSingle()
    contaId = membro?.conta_id ?? null
  }

  if (!contaId) redirect('/login')

  const [{ data: membros }, { data: departamentos }] = await Promise.all([
    supabase
      .from('membros_conta')
      .select('id, nome, email, role, ativo, criado_em')
      .eq('conta_id', contaId)
      .order('criado_em', { ascending: true }),
    supabase
      .from('departamentos')
      .select('id, nome, cor, criado_em')
      .eq('conta_id', contaId)
      .order('criado_em', { ascending: true }),
  ])

  return (
    <EquipeClient
      membros={membros ?? []}
      departamentos={departamentos ?? []}
    />
  )
}
