'use server'

import { revalidatePath } from 'next/cache'
import { getConta } from '@/lib/conta'

type Result = { error: string | null }

export async function aceitarAtendimentoAction(atendimentoId: string): Promise<Result> {
  try {
    const { supabase, contaId, userId } = await getConta()

    const { error } = await supabase
      .from('atendimentos')
      .update({
        status:       'em_atendimento',
        atendente_id: userId,
        aceito_em:    new Date().toISOString(),
      })
      .eq('id', atendimentoId)
      .eq('conta_id', contaId)
      .eq('status', 'aguardando')

    if (error) return { error: error.message }

    revalidatePath('/atendimento')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function finalizarAtendimentoAction(atendimentoId: string): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    const { error } = await supabase
      .from('atendimentos')
      .update({
        status:        'finalizado',
        finalizado_em: new Date().toISOString(),
      })
      .eq('id', atendimentoId)
      .eq('conta_id', contaId)
      .neq('status', 'finalizado')

    if (error) return { error: error.message }

    revalidatePath('/atendimento')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function transferirAtendimentoAction(
  atendimentoId: string,
  departamentoId: string,
  atendenteId?: string,
): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    const { error } = await supabase
      .from('atendimentos')
      .update({
        departamento_id: departamentoId,
        status:          'aguardando' as const,
        atendente_id:    atendenteId ?? null,
        aceito_em:       null,
      })
      .eq('id', atendimentoId)
      .eq('conta_id', contaId)

    if (error) return { error: error.message }

    revalidatePath('/atendimento')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function buscarDepartamentosEMembrosAction(): Promise<{
  error: string | null
  departamentos?: { id: string; nome: string; cor: string }[]
  membros?: { id: string; user_id: string; nome: string }[]
}> {
  try {
    const { supabase, contaId } = await getConta()

    const [{ data: deps, error: depErr }, { data: mems, error: memErr }] = await Promise.all([
      supabase
        .from('departamentos')
        .select('id, nome, cor')
        .eq('conta_id', contaId)
        .order('nome'),
      supabase
        .from('membros_conta')
        .select('id, user_id, nome')
        .eq('conta_id', contaId)
        .eq('ativo', true)
        .order('nome'),
    ])

    if (depErr) return { error: depErr.message }
    if (memErr) return { error: memErr.message }

    return {
      error: null,
      departamentos: deps ?? [],
      membros: mems ?? [],
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
