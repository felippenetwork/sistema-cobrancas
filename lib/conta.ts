import { createClient } from '@/lib/supabase/server'

export type ContaCtx = {
  supabase: Awaited<ReturnType<typeof createClient>>
  contaId: string
  userId: string
  isOwner: boolean
}

// Retorna o contexto da conta para o usuário autenticado.
// Funciona tanto para owners (donos) quanto para membros convidados.
export async function getConta(): Promise<ContaCtx> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')

  const { data: conta } = await supabase
    .from('contas')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (conta) {
    return { supabase, contaId: conta.id as string, userId: user.id, isOwner: true }
  }

  const { data: membro } = await supabase
    .from('membros_conta')
    .select('conta_id')
    .eq('user_id', user.id)
    .eq('ativo', true)
    .maybeSingle()

  if (!membro) throw new Error('Conta não encontrada.')
  return { supabase, contaId: membro.conta_id as string, userId: user.id, isOwner: false }
}
