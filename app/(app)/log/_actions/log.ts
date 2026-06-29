'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getContaId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) throw new Error('Conta não encontrada.')
  return { supabase, contaId: conta.id as string }
}

export async function cancelarNotificacaoAction(id: string) {
  const { supabase, contaId } = await getContaId()

  await supabase
    .from('notificacoes_enviadas')
    .update({ status: 'cancelado' })
    .eq('id', id)
    .eq('conta_id', contaId) // garante isolamento multi-tenant
    .eq('status', 'fila')    // só cancela se ainda estiver na fila

  revalidatePath('/log')
}

export async function reenviarNotificacaoAction(id: string) {
  const { supabase, contaId } = await getContaId()

  await supabase
    .from('notificacoes_enviadas')
    .update({
      status:        'fila',
      agendado_para: new Date().toISOString(),
      enviado_em:    null,
    })
    .eq('id', id)
    .eq('conta_id', contaId) // garante isolamento multi-tenant
    .eq('status', 'falhou')  // só reenvia se tiver falhado

  revalidatePath('/log')
}
