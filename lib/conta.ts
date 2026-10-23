import { createClient } from '@/lib/supabase/server'

export type ContaCtx = {
  supabase: Awaited<ReturnType<typeof createClient>>
  contaId: string
  userId: string
}

// Retorna o contexto da conta do usuário autenticado (sempre o dono da conta).
export async function getConta(): Promise<ContaCtx> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')

  const { data: conta, error } = await supabase
    .from('contas')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[getConta] leitura da conta falhou', { userId: user.id, error })
    throw new Error('Não foi possível carregar a conta.')
  }
  if (!conta) throw new Error('Conta não encontrada.')
  return { supabase, contaId: conta.id as string, userId: user.id }
}
