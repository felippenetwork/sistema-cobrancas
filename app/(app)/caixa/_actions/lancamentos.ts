'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type ActionState = { error: string | null; success?: boolean }

async function getConta() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) throw new Error('Conta não encontrada.')
  return { supabase, contaId: conta.id as string }
}

// ── Criar lançamento manual ──────────────────────────────────────────────────
export async function criarLancamentoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    const tipo     = formData.get('tipo') as string
    const valorStr = (formData.get('valor') as string).replace(',', '.')
    const data     = (formData.get('data') as string).trim()
    const descricao = (formData.get('descricao') as string)?.trim() || null

    if (!['entrada', 'saida'].includes(tipo)) return { error: 'Tipo inválido.' }
    const valor = parseFloat(valorStr)
    if (isNaN(valor) || valor <= 0)           return { error: 'Valor inválido.' }
    if (!data)                                return { error: 'Data obrigatória.' }

    const { error } = await supabase.from('lancamentos').insert({
      conta_id: contaId,
      tipo,
      origem:   'manual',
      valor,
      data,
      descricao,
    })
    if (error) return { error: error.message }

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/caixa')
  revalidatePath('/dashboard')
  return { error: null, success: true }
}

// ── Excluir lançamento manual ────────────────────────────────────────────────
// Parcelas (origem='parcela') não podem ser excluídas por aqui — são geradas pela baixa.
export async function excluirLancamentoAction(formData: FormData) {
  const lancamentoId = formData.get('lancamento_id') as string
  const { supabase } = await getConta()

  await supabase
    .from('lancamentos')
    .delete()
    .eq('id', lancamentoId)
    .eq('origem', 'manual')  // dupla proteção: RLS + só manual

  revalidatePath('/caixa')
  revalidatePath('/dashboard')
}
