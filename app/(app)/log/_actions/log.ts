'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

async function getContaId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) throw new Error('Conta não encontrada.')
  return { contaId: conta.id as string }
}

// UPDATE não tem policy RLS — usa service role escopado por conta_id
export async function cancelarNotificacaoAction(id: string) {
  const { contaId } = await getContaId()

  const admin = createAdminClient()
  await admin
    .from('notificacoes_enviadas')
    .update({ status: 'cancelado' })
    .eq('id', id)
    .eq('conta_id', contaId)
    .eq('status', 'fila')

  revalidatePath('/log')
}

// UPDATE não tem policy RLS — usa service role escopado por conta_id
export async function reenviarNotificacaoAction(id: string) {
  const { contaId } = await getContaId()

  const admin = createAdminClient()
  await admin
    .from('notificacoes_enviadas')
    .update({
      status:        'fila',
      agendado_para: new Date().toISOString(),
      enviado_em:    null,
    })
    .eq('id', id)
    .eq('conta_id', contaId)
    .eq('status', 'falhou')

  revalidatePath('/log')
}
