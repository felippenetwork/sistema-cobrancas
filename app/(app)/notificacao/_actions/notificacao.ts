'use server'

import { createClient } from '@/lib/supabase/server'
import { NOTIF_DEFAULTS, SAUDACOES_PADRAO } from '@/lib/notificacao/tipos'
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

// Garante que os 8 tipos existem para esta conta (idempotente)
export async function seedNotificacoesAction() {
  const { supabase, contaId } = await getConta()
  await supabase.from('notificacoes_config').upsert(
    NOTIF_DEFAULTS.map(n => ({
      conta_id: contaId, tipo: n.tipo, horario: n.horario,
      ativo_whatsapp: false, ativo_email: false,
      template_whatsapp: n.template_whatsapp,
      assunto_email: n.assunto_email, template_email: n.template_email,
    })),
    { onConflict: 'conta_id,tipo', ignoreDuplicates: true },
  )
  // Seed saudações se ainda não existirem
  const { count } = await supabase.from('saudacoes').select('*', { count: 'exact', head: true }).eq('conta_id', contaId)
  if (!count) {
    await supabase.from('saudacoes').insert(SAUDACOES_PADRAO.map(texto => ({ conta_id: contaId, texto })))
  }
  revalidatePath('/notificacao')
}

// ── Toggle canal por tipo ────────────────────────────────────────────────────
export async function toggleCanalAction(
  tipo: string,
  canal: 'whatsapp' | 'email',
  ativo: boolean,
) {
  const { supabase, contaId } = await getConta()
  const campo = canal === 'whatsapp' ? 'ativo_whatsapp' : 'ativo_email'

  await supabase.from('notificacoes_config')
    .update({ [campo]: ativo })
    .eq('conta_id', contaId)
    .eq('tipo', tipo)

  revalidatePath('/notificacao')
}

// ── Salvar conteúdo de um tipo ───────────────────────────────────────────────
export async function salvarTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const tipo = formData.get('tipo') as string

  try {
    const { supabase, contaId } = await getConta()

    const horario          = (formData.get('horario')           as string).trim()
    const templateWhatsapp = (formData.get('template_whatsapp') as string).trim()
    const assuntoEmail     = (formData.get('assunto_email')     as string).trim()
    const templateEmail    = (formData.get('template_email')    as string).trim()

    const { error } = await supabase.from('notificacoes_config').update({
      horario, template_whatsapp: templateWhatsapp,
      assunto_email: assuntoEmail, template_email: templateEmail,
    }).eq('conta_id', contaId).eq('tipo', tipo)

    if (error) return { error: error.message }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/notificacao')
  return { error: null, success: true }
}
