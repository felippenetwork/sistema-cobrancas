'use server'

import { revalidatePath } from 'next/cache'
import { getConta } from '@/lib/conta'

type Result = { error: string | null }

export async function criarModeloAction(
  _prev: Result,
  formData: FormData,
): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    const nome      = (formData.get('nome')      as string)?.trim()
    const categoria = (formData.get('categoria') as string) ?? 'UTILITY'
    const idioma    = (formData.get('idioma')    as string) ?? 'pt_BR'
    const corpo     = (formData.get('corpo')     as string)?.trim()
    const cabecalho = (formData.get('cabecalho') as string)?.trim() || null
    const rodape    = (formData.get('rodape')    as string)?.trim() || null

    if (!nome)  return { error: 'Informe o nome do template.' }
    if (!corpo) return { error: 'O corpo da mensagem é obrigatório.' }
    if (!['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(categoria)) {
      return { error: 'Categoria inválida.' }
    }

    // Extrair variáveis {{1}}, {{2}}, ... do corpo
    const vars = [...corpo.matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1])
    const variaveisUnicas = [...new Set(vars)].sort()

    const { error } = await supabase.from('modelos_wa').insert({
      conta_id:   contaId,
      nome,
      categoria: categoria as 'UTILITY' | 'MARKETING' | 'AUTHENTICATION',
      idioma,
      corpo,
      cabecalho,
      rodape,
      variaveis: variaveisUnicas.length ? variaveisUnicas : null,
      status:    'rascunho',
    })

    if (error) return { error: error.message }

    revalidatePath('/wa-templates')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function atualizarModeloAction(
  modeloId: string,
  campos: { nome?: string; corpo?: string; cabecalho?: string | null; rodape?: string | null; categoria?: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION' },
): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    const { error } = await supabase
      .from('modelos_wa')
      .update({ ...campos, atualizado_em: new Date().toISOString() })
      .eq('id', modeloId)
      .eq('conta_id', contaId)
      .eq('status', 'rascunho') // apenas rascunho pode ser editado

    if (error) return { error: error.message }

    revalidatePath('/wa-templates')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function submeterAprovacaoAction(modeloId: string): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    // Verifica configuração da API Meta
    const { data: config } = await supabase
      .from('configuracoes')
      .select('id')
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!config) return { error: 'Configurações não encontradas.' }

    // Por enquanto marca como "em_analise" — integração Meta API é configurada via env
    const { error } = await supabase
      .from('modelos_wa')
      .update({ status: 'em_analise', atualizado_em: new Date().toISOString() })
      .eq('id', modeloId)
      .eq('conta_id', contaId)
      .eq('status', 'rascunho')

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
      .eq('status', 'rascunho') // apenas rascunhos podem ser excluídos

    if (error) return { error: error.message }

    revalidatePath('/wa-templates')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
