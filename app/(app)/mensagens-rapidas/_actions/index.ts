'use server'

import { revalidatePath } from 'next/cache'
import { getConta } from '@/lib/conta'
import type { TablesUpdate } from '@/types/database'

type Result = { error: string | null }

export type MensagemRapida = {
  id: string
  titulo: string
  texto: string
  ordem: number
}

// Detalhe do banco vai para o log do servidor; a tela recebe só uma mensagem acionável (SEG-M4).
function falhaDeBanco(acao: string, error: { message: string }, contexto: Record<string, unknown>): string {
  console.error(`[mensagens-rapidas] ${acao}`, error.message, contexto)
  return 'Não foi possível concluir a operação. Tente novamente.'
}

export async function listarMensagensRapidasAction(): Promise<{ data: MensagemRapida[]; error: string | null }> {
  try {
    const ctx = await getConta()
    const { data, error } = await ctx.supabase
      .from('mensagens_rapidas')
      .select('id, titulo, texto, ordem')
      .eq('conta_id', ctx.contaId)
      .order('ordem', { ascending: true })
      .order('criado_em', { ascending: true })

    if (error) return { data: [], error: falhaDeBanco('listar', error, { contaId: ctx.contaId }) }
    return { data: data ?? [], error: null }
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function criarMensagemRapidaAction(
  _prev: Result,
  formData: FormData,
): Promise<Result> {
  try {
    const ctx    = await getConta()
    const titulo = (formData.get('titulo') as string)?.trim()
    const texto  = (formData.get('texto')  as string)?.trim()

    if (!titulo) return { error: 'Informe o título da mensagem.' }
    if (!texto)  return { error: 'Informe o texto da mensagem.' }
    if (titulo.length > 100) return { error: 'Título deve ter no máximo 100 caracteres.' }

    const { data: ultimo } = await ctx.supabase
      .from('mensagens_rapidas')
      .select('ordem')
      .eq('conta_id', ctx.contaId)
      .order('ordem', { ascending: false })
      .limit(1)
      .maybeSingle()

    const proximaOrdem = (ultimo?.ordem ?? -1) + 1

    const { error } = await ctx.supabase
      .from('mensagens_rapidas')
      .insert({ conta_id: ctx.contaId, titulo, texto, ordem: proximaOrdem })

    if (error) return { error: falhaDeBanco('criar', error, { contaId: ctx.contaId }) }

    revalidatePath('/mensagens-rapidas')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function atualizarMensagemRapidaAction(
  id: string,
  campos: { titulo?: string; texto?: string; ordem?: number },
): Promise<Result> {
  try {
    const ctx = await getConta()

    const update: TablesUpdate<'mensagens_rapidas'> = {}
    if (campos.titulo !== undefined) update.titulo = campos.titulo.trim()
    if (campos.texto  !== undefined) update.texto  = campos.texto.trim()
    if (campos.ordem  !== undefined) update.ordem  = campos.ordem

    if (update.titulo === '') return { error: 'Título não pode estar vazio.' }
    if (update.texto  === '') return { error: 'Texto não pode estar vazio.' }

    const { error } = await ctx.supabase
      .from('mensagens_rapidas')
      .update(update)
      .eq('id', id)
      .eq('conta_id', ctx.contaId)

    if (error) return { error: falhaDeBanco('atualizar', error, { contaId: ctx.contaId, id }) }

    revalidatePath('/mensagens-rapidas')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function excluirMensagemRapidaAction(id: string): Promise<Result> {
  try {
    const ctx = await getConta()

    const { error } = await ctx.supabase
      .from('mensagens_rapidas')
      .delete()
      .eq('id', id)
      .eq('conta_id', ctx.contaId)

    if (error) return { error: falhaDeBanco('excluir', error, { contaId: ctx.contaId, id }) }

    revalidatePath('/mensagens-rapidas')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
