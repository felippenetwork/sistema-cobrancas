'use server'

// Modelos de mensagem para campanhas de disparo em massa (/disparos), enviados
// via uazapi — texto livre, sem processo de aprovação (isso só existia
// enquanto o produto também suportava a Meta Cloud API, removida do projeto).

import { revalidatePath } from 'next/cache'
import { getConta } from '@/lib/conta'

type Result = { error: string | null; success?: boolean }

export async function criarModeloAction(
  _prev: Result,
  formData: FormData,
): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    const nome  = (formData.get('nome')  as string)?.trim()
    const corpo = (formData.get('corpo') as string)?.trim()

    if (!nome)  return { error: 'Informe o nome do modelo.' }
    if (!corpo) return { error: 'O texto da mensagem é obrigatório.' }

    const { error } = await supabase.from('modelos_wa').insert({
      conta_id: contaId,
      nome,
      corpo,
      status: 'aprovado', // uazapi manda texto livre — não existe processo de aprovação
    })

    if (error) return { error: error.message }

    revalidatePath('/wa-templates')
    return { error: null, success: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function atualizarModeloAction(
  modeloId: string,
  campos: { nome?: string; corpo?: string },
): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    const { error } = await supabase
      .from('modelos_wa')
      .update({ ...campos, atualizado_em: new Date().toISOString() })
      .eq('id', modeloId)
      .eq('conta_id', contaId)

    if (error) return { error: error.message }

    revalidatePath('/wa-templates')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function excluirModeloAction(modeloId: string): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    const { error } = await supabase
      .from('modelos_wa')
      .delete()
      .eq('id', modeloId)
      .eq('conta_id', contaId)

    if (error) return { error: error.message }

    revalidatePath('/wa-templates')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
