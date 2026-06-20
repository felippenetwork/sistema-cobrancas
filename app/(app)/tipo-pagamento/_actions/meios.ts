'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type ActionState = { error: string | null; success?: boolean }

async function getConta() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: conta } = await supabase.from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) throw new Error('Conta não encontrada.')
  return { supabase, contaId: conta.id as string }
}

export async function criarMeioAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()
    const nome     = (formData.get('nome')     as string).trim()
    const mensagem = (formData.get('mensagem') as string).trim()
    const padrao   = formData.get('is_padrao') === 'true'

    if (!nome || !mensagem) return { error: 'Preencha nome e mensagem/chave Pix.' }

    // Se vai ser padrão, remove padrão dos outros
    if (padrao) {
      await supabase.from('meios_pagamento').update({ is_padrao: false })
        .eq('conta_id', contaId).eq('is_padrao', true)
    }

    const { error } = await supabase.from('meios_pagamento').insert({
      conta_id: contaId, tipo: 'pix', nome, mensagem, is_padrao: padrao,
    })
    if (error) return { error: error.message }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
  revalidatePath('/tipo-pagamento')
  return { error: null, success: true }
}

export async function definirPadraoAction(formData: FormData) {
  const meioId = formData.get('meio_id') as string
  const { supabase, contaId } = await getConta()
  // Remove padrão de todos e define no selecionado
  await supabase.from('meios_pagamento').update({ is_padrao: false }).eq('conta_id', contaId)
  await supabase.from('meios_pagamento').update({ is_padrao: true }).eq('id', meioId)
  revalidatePath('/tipo-pagamento')
}

export async function excluirMeioAction(formData: FormData) {
  const meioId = formData.get('meio_id') as string
  const { supabase } = await getConta()
  await supabase.from('meios_pagamento').delete().eq('id', meioId)
  revalidatePath('/tipo-pagamento')
}
