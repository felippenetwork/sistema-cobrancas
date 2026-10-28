'use server'

// Modelos de disparo (/disparos), enviados via uazapi: uma sequência de mensagens ("caixinhas"
// de texto/mídia, cada uma com o próprio "digitando…") — lib/disparo/passos.ts. O disparo copia a
// sequência do modelo quando é criado, então editar aqui não muda um disparo em andamento.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getConta } from '@/lib/conta'
import { ehMidia, pastaDaConta, resumoDosPassos, schemaPassos } from '@/lib/disparo/passos'
import { schemaAcoes } from '@/lib/disparo/acoes'

type Result = { error: string | null; id?: string }

const schemaModelo = z.object({
  nome:   z.string().trim().min(1, 'Informe o nome do modelo.').max(80, 'Nome muito longo (máximo 80 caracteres).'),
  passos: schemaPassos,
  acoes:  schemaAcoes.default([]),
})

export type ModeloEntrada = z.input<typeof schemaModelo>

/** Valida e monta as colunas do modelo; mídia só da pasta desta conta. */
function colunasDoModelo(input: ModeloEntrada, contaId: string) {
  const parsed = schemaModelo.safeParse(input)
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  const passos = parsed.data.passos.map(p => (p.tipo === 'texto' ? { ...p, variacoes: p.variacoes.filter(Boolean) } : p))
  if (passos.some(p => ehMidia(p) && !p.caminho.startsWith(pastaDaConta(contaId)))) {
    return { erro: 'Arquivo de mídia inválido. Envie o arquivo de novo.' }
  }
  return { colunas: { nome: parsed.data.nome, passos, corpo: resumoDosPassos(passos), acoes: parsed.data.acoes } }
}

export async function criarModeloAction(input: ModeloEntrada): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()
    const r = colunasDoModelo(input, contaId)
    if ('erro' in r) return { error: r.erro ?? 'Dados inválidos.' }

    const { data, error } = await supabase
      .from('modelos_wa')
      .insert({ conta_id: contaId, ...r.colunas, status: 'aprovado' }) // uazapi: sem processo de aprovação
      .select('id')
      .single()
    if (error) {
      console.error('[modelos] criar falhou', { contaId, error })
      return { error: 'Não foi possível criar o modelo. Tente de novo.' }
    }

    revalidatePath('/wa-templates')
    revalidatePath('/disparos')
    return { error: null, id: data.id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function atualizarModeloAction(modeloId: string, input: ModeloEntrada): Promise<Result> {
  if (!z.string().uuid().safeParse(modeloId).success) return { error: 'Modelo inválido.' }
  try {
    const { supabase, contaId } = await getConta()
    const r = colunasDoModelo(input, contaId)
    if ('erro' in r) return { error: r.erro ?? 'Dados inválidos.' }

    const { data, error } = await supabase
      .from('modelos_wa')
      .update({ ...r.colunas, atualizado_em: new Date().toISOString() })
      .eq('id', modeloId)
      .eq('conta_id', contaId)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[modelos] atualizar falhou', { contaId, modeloId, error })
      return { error: 'Não foi possível salvar o modelo. Tente de novo.' }
    }
    if (!data) return { error: 'Modelo não encontrado.' }

    revalidatePath('/wa-templates')
    revalidatePath('/disparos')
    return { error: null, id: modeloId }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function excluirModeloAction(modeloId: string): Promise<Result> {
  if (!z.string().uuid().safeParse(modeloId).success) return { error: 'Modelo inválido.' }
  try {
    const { supabase, contaId } = await getConta()

    // Disparo antigo (de antes da cópia da sequência) ainda em aberto lê o texto do modelo.
    const { data: emUso, error: usoErr } = await supabase
      .from('campanhas_wa')
      .select('id')
      .eq('conta_id', contaId)
      .eq('modelo_id', modeloId)
      .is('passos', null)
      .in('status', ['rascunho', 'agendada', 'enviando', 'pausada'])
      .limit(1)
    if (usoErr) {
      console.error('[modelos] checagem de uso falhou', { contaId, modeloId, usoErr })
      return { error: 'Não foi possível excluir o modelo. Tente de novo.' }
    }
    if (emUso?.length) return { error: 'Este modelo está num disparo em andamento. Conclua ou cancele o disparo antes de excluir.' }

    const { error } = await supabase
      .from('modelos_wa')
      .delete()
      .eq('id', modeloId)
      .eq('conta_id', contaId)
    if (error) {
      console.error('[modelos] excluir falhou', { contaId, modeloId, error })
      return { error: 'Não foi possível excluir o modelo. Tente de novo.' }
    }

    revalidatePath('/wa-templates')
    revalidatePath('/disparos')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
