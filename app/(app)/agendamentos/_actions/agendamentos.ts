'use server'

// Agendamentos: envio para UMA pessoa numa data e hora (envios_agendados, lib/disparo/agendados.ts).
// Cliente cadastrado ou número digitado; a mensagem é a mesma sequência de caixinhas dos modelos.
// Os agendamentos antigos (notificacoes_enviadas tipo 'agendada') continuam saindo pelo cron e só
// podem ser cancelados aqui.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getConta } from '@/lib/conta'
import { createAdminClient } from '@/lib/supabase/admin'
import { ehMidia, pastaDaConta, schemaPassos, type Passo } from '@/lib/disparo/passos'
import { instanteSP, normalizarCelular } from '@/lib/disparo/progressivo'

type Result = { error: string | null; id?: string }

const MAX_ANTECEDENCIA_MS = 366 * 24 * 60 * 60_000

const schemaAgendamento = z.object({
  destino: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('cliente'), clienteId: z.string().uuid('Escolha um cliente.') }),
    z.object({
      tipo: z.literal('numero'),
      celular: z.string().max(40),
      nome: z.string().trim().max(80, 'Nome muito longo (máximo 80 caracteres).'),
    }),
  ]),
  passos: schemaPassos,
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.'),
})

export type AgendamentoEntrada = z.input<typeof schemaAgendamento>

type Supabase = Awaited<ReturnType<typeof getConta>>['supabase']
type Colunas = { cliente_id: string | null; celular: string; nome: string | null; passos: Passo[]; agendado_para: string }

/** Valida a entrada e monta as colunas do envio (mesma regra para agendar e para editar). */
async function colunasDoAgendamento(input: AgendamentoEntrada, supabase: Supabase, contaId: string): Promise<Colunas | { erro: string }> {
  const parsed = schemaAgendamento.safeParse(input)
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  const d = parsed.data

  const agendadoPara = instanteSP(d.data, d.hora)
  if (isNaN(agendadoPara.getTime())) return { erro: 'Data ou horário inválido.' }
  if (agendadoPara.getTime() <= Date.now()) return { erro: 'Escolha um horário que ainda não passou.' }
  if (agendadoPara.getTime() - Date.now() > MAX_ANTECEDENCIA_MS) return { erro: 'Agende para no máximo um ano à frente.' }

  // Mídia só da pasta desta conta: nunca aceitar caminho de arquivo de outra conta.
  const passos = d.passos.map(p => (p.tipo === 'texto' ? { ...p, variacoes: p.variacoes.filter(Boolean) } : p))
  if (passos.some(p => ehMidia(p) && !p.caminho.startsWith(pastaDaConta(contaId)))) {
    return { erro: 'Arquivo de mídia inválido. Envie o arquivo de novo.' }
  }

  if (d.destino.tipo === 'cliente') {
    const { data: cliente, error } = await supabase
      .from('clientes').select('id, nome, celular, deleted_at')
      .eq('id', d.destino.clienteId).eq('conta_id', contaId).maybeSingle()
    if (error) {
      console.error('[agendamentos] leitura do cliente falhou', { contaId, error })
      return { erro: 'Não foi possível ler o cliente. Tente de novo.' }
    }
    if (!cliente || cliente.deleted_at) return { erro: 'Cliente não encontrado.' }
    const celular = cliente.celular ? normalizarCelular(cliente.celular) : null
    if (!celular) return { erro: 'Este cliente não tem um celular válido cadastrado. Digite o número.' }
    return { cliente_id: cliente.id, celular, nome: cliente.nome?.trim() || null, passos, agendado_para: agendadoPara.toISOString() }
  }
  const celular = normalizarCelular(d.destino.celular)
  if (!celular) return { erro: 'Número de WhatsApp inválido. Use DDD + número, por exemplo 21 99999-0000.' }
  return { cliente_id: null, celular, nome: d.destino.nome || null, passos, agendado_para: agendadoPara.toISOString() }
}

export async function criarEnvioAgendadoAction(input: AgendamentoEntrada): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()
    const colunas = await colunasDoAgendamento(input, supabase, contaId)
    if ('erro' in colunas) return { error: colunas.erro }

    const { data, error } = await supabase
      .from('envios_agendados')
      .insert({ conta_id: contaId, ...colunas })
      .select('id')
      .single()
    if (error) {
      console.error('[agendamentos] criar falhou', { contaId, error })
      return { error: 'Não foi possível agendar. Tente de novo.' }
    }

    revalidatePath('/agendamentos')
    return { error: null, id: data.id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

/**
 * Edita pessoa, dia, hora e mensagem de um envio que ainda não saiu. Só grava se continuar
 * pendente: se o cron levou o envio nesse meio-tempo, responde que já saiu.
 */
export async function atualizarEnvioAgendadoAction(id: string, input: AgendamentoEntrada): Promise<Result> {
  if (!z.string().uuid().safeParse(id).success) return { error: 'Agendamento inválido.' }
  try {
    const { supabase, contaId } = await getConta()
    const colunas = await colunasDoAgendamento(input, supabase, contaId)
    if ('erro' in colunas) return { error: colunas.erro }

    const { data, error } = await supabase
      .from('envios_agendados')
      .update({ ...colunas, erro: null, aviso: null })
      .eq('id', id)
      .eq('conta_id', contaId)
      .eq('status', 'pendente')
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[agendamentos] editar falhou', { contaId, id, error })
      return { error: 'Não foi possível salvar. Tente de novo.' }
    }
    if (!data) return { error: 'Este envio já saiu ou foi cancelado, por isso não dá mais para editar.' }
    revalidatePath('/agendamentos')
    return { error: null, id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

/** Cancela um envio que ainda não saiu. De outra conta, ou já enviado: "não pode mais". */
export async function cancelarEnvioAgendadoAction(id: string): Promise<Result> {
  if (!z.string().uuid().safeParse(id).success) return { error: 'Agendamento inválido.' }
  try {
    const { supabase, contaId } = await getConta()
    const { data, error } = await supabase
      .from('envios_agendados')
      .update({ status: 'cancelado' })
      .eq('id', id)
      .eq('conta_id', contaId)
      .eq('status', 'pendente')
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[agendamentos] cancelar falhou', { contaId, id, error })
      return { error: 'Não foi possível cancelar. Tente de novo.' }
    }
    if (!data) return { error: 'Este envio já saiu ou foi cancelado.' }
    revalidatePath('/agendamentos')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

/** Agendamento antigo (mensagem avulsa em notificacoes_enviadas): só cancelar. */
export async function cancelarAgendamentoAntigoAction(id: string): Promise<Result> {
  if (!z.string().uuid().safeParse(id).success) return { error: 'Agendamento inválido.' }
  try {
    const { contaId } = await getConta()
    // notificacoes_enviadas não tem policy de UPDATE: service role, escopado por conta_id.
    const { data, error } = await createAdminClient()
      .from('notificacoes_enviadas')
      .update({ status: 'cancelado' })
      .eq('id', id)
      .eq('conta_id', contaId)
      .eq('tipo', 'agendada')
      .eq('status', 'fila')
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[agendamentos] cancelar antigo falhou', { contaId, id, error })
      return { error: 'Não foi possível cancelar. Tente de novo.' }
    }
    if (!data) return { error: 'Este envio já saiu ou foi cancelado.' }
    revalidatePath('/agendamentos')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
