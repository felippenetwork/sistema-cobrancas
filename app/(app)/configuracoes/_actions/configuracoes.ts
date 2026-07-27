'use server'

import { createClient } from '@/lib/supabase/server'
import { sanitizarLocalPart } from '@/lib/email/template'
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

// ── Toggles de provedor ──────────────────────────────────────────────────────
export async function toggleMetaApiAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()
    const ativo = formData.get('ativo') === 'true'
    const { error } = await supabase
      .from('configuracoes')
      .upsert({ conta_id: contaId, meta_api_ativo: ativo }, { onConflict: 'conta_id' })
    if (error) return { error: error.message }
    revalidatePath('/configuracoes')
    return { error: null, success: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function toggleTwilioAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()
    const ativo = formData.get('ativo') === 'true'
    const { error } = await supabase
      .from('configuracoes')
      .upsert({ conta_id: contaId, twilio_ativo: ativo }, { onConflict: 'conta_id' })
    if (error) return { error: error.message }
    revalidatePath('/configuracoes')
    return { error: null, success: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// ── Salvar credenciais Twilio WhatsApp ───────────────────────────────────────
export async function salvarTwilioAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    const accountSid  = (formData.get('twilio_account_sid')  as string)?.trim() || null
    const authToken   = (formData.get('twilio_auth_token')   as string)?.trim() || null
    const fromNumber  = (formData.get('twilio_from_number')  as string)?.trim() || null

    const { error } = await supabase
      .from('configuracoes')
      .upsert(
        { conta_id: contaId, twilio_account_sid: accountSid, twilio_auth_token: authToken, twilio_from_number: fromNumber },
        { onConflict: 'conta_id' },
      )

    if (error) return { error: error.message }

    revalidatePath('/configuracoes')
    return { error: null, success: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// ── Salvar credenciais Meta Cloud API ────────────────────────────────────────
export async function salvarMetaApiAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    const accessToken   = (formData.get('meta_access_token')    as string)?.trim() || null
    const phoneNumberId = (formData.get('meta_phone_number_id') as string)?.trim() || null
    const wabaId        = (formData.get('meta_waba_id')         as string)?.trim() || null

    const { error } = await supabase
      .from('configuracoes')
      .upsert(
        { conta_id: contaId, meta_access_token: accessToken, meta_phone_number_id: phoneNumberId, meta_waba_id: wabaId },
        { onConflict: 'conta_id' },
      )

    if (error) return { error: error.message }

    revalidatePath('/configuracoes')
    return { error: null, success: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// ── Salvar dados da empresa + remetente de e-mail ────────────────────────────
export async function salvarConfiguracoesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    // Dados da empresa
    const nomeComercial = (formData.get('nome_comercial') as string).trim()
    const cpfCnpj       = (formData.get('cpf_cnpj')       as string).trim()
    const endereco      = (formData.get('endereco')        as string).trim()
    const contato       = (formData.get('contato')         as string).trim()

    const { error: cfgErr, count: cfgCount } = await supabase.from('configuracoes').upsert(
      { conta_id: contaId, nome_comercial: nomeComercial || null, cpf_cnpj: cpfCnpj || null,
        endereco: endereco || null, contato: contato || null },
      { onConflict: 'conta_id', count: 'exact' },
    )
    if (cfgErr) return { error: `Erro ao salvar empresa: ${cfgErr.message}` }
    if (cfgCount === 0) return { error: 'Sem permissão para salvar dados da empresa. Verifique sua conta.' }

    // Remetente de e-mail (opcional — só salva se local_part informado)
    const localPartRaw = (formData.get('local_part') as string).trim()
    const fromName     = (formData.get('from_name')  as string).trim()

    if (localPartRaw) {
      const localPart = sanitizarLocalPart(localPartRaw)

      if (!localPart) {
        return { error: 'Nome do remetente inválido após sanitização. Use letras, números, ponto e hífen.' }
      }

      const { error: remErr } = await supabase.from('email_remetente').upsert(
        { conta_id: contaId, local_part: localPart, from_name: fromName || null, modo: 'compartilhado' },
        { onConflict: 'conta_id' },
      )

      if (remErr?.code === '23505') {
        return { error: 'Este nome de remetente não está disponível. Tente outro.' }
      }
      if (remErr) return { error: remErr.message }
    }

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/configuracoes')
  return { error: null, success: true }
}
