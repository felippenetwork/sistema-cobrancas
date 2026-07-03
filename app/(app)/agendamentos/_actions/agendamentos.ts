'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

export type ActionState = { error: string | null; success?: boolean }

async function getConta() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) throw new Error('Conta não encontrada.')
  return { supabase, contaId: conta.id as string, userId: user.id }
}

export async function criarAgendamentoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    const clienteId = (formData.get('cliente_id') as string)?.trim()
    const mensagem  = (formData.get('mensagem')   as string)?.trim()
    const data      = (formData.get('data')        as string)?.trim()
    const hora      = (formData.get('hora')        as string)?.trim()
    const assunto   = (formData.get('assunto')     as string)?.trim() || null
    const canais    = formData.getAll('canais') as string[]

    if (!clienteId)              return { error: 'Selecione um cliente.' }
    if (!mensagem)               return { error: 'A mensagem não pode estar vazia.' }
    if (mensagem.length > 4000)  return { error: 'Mensagem muito longa (máximo 4000 caracteres).' }
    if (!data || !hora)          return { error: 'Data e hora são obrigatórias.' }
    if (!canais.length)          return { error: 'Selecione pelo menos um canal.' }

    const agendadoPara = new Date(`${data}T${hora}:00-03:00`)
    if (isNaN(agendadoPara.getTime())) return { error: 'Data ou hora inválida.' }
    if (agendadoPara <= new Date())    return { error: 'O agendamento deve ser para um horário futuro.' }

    const querWhatsApp = canais.includes('whatsapp')
    const querEmail    = canais.includes('email')

    if (querEmail && !assunto) return { error: 'O assunto é obrigatório para envio por e-mail.' }

    // Validar cliente e canais
    const { data: cliente } = await supabase
      .from('clientes')
      .select('id, celular, email, deleted_at')
      .eq('id', clienteId)
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!cliente || (cliente as any).deleted_at) return { error: 'Cliente não encontrado.' }
    if (querWhatsApp && !(cliente as any).celular)
      return { error: 'Este cliente não tem celular cadastrado para envio por WhatsApp.' }
    if (querEmail && !(cliente as any).email)
      return { error: 'Este cliente não tem e-mail cadastrado para envio por e-mail.' }

    const base = {
      conta_id:       contaId,
      cliente_id:     clienteId,
      parcela_id:     null,
      cobranca_id:    null,
      tipo:           'agendada' as const,
      status:         'fila' as const,
      mensagem_final: mensagem,
      agendado_para:  agendadoPara.toISOString(),
    }

    const inserts = []
    if (querWhatsApp) inserts.push({ ...base, canal: 'whatsapp' as const })
    if (querEmail)    inserts.push({ ...base, canal: 'email' as const, assunto })

    const { error } = await supabase.from('notificacoes_enviadas').insert(inserts)
    if (error) return { error: error.message }

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/agendamentos')
  return { error: null, success: true }
}

export async function cancelarAgendamentoAction(formData: FormData) {
  // UPDATE não tem policy RLS — usa service role escopado por conta_id
  const supabaseUser = await createClient()
  const { data: { user } } = await supabaseUser.auth.getUser()
  if (!user) return

  const { data: conta } = await supabaseUser
    .from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) return

  const id      = formData.get('id') as string
  const contaId = (conta as any).id as string

  const admin = createAdminClient()
  await admin
    .from('notificacoes_enviadas')
    .update({ status: 'cancelado' })
    .eq('id', id)
    .eq('conta_id', contaId)   // isolamento multi-tenant
    .eq('tipo', 'agendada')
    .eq('status', 'fila')

  revalidatePath('/agendamentos')
}
