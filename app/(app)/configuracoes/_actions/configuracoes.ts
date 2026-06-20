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

    const { error: cfgErr } = await supabase.from('configuracoes').upsert(
      { conta_id: contaId, nome_comercial: nomeComercial || null, cpf_cnpj: cpfCnpj || null,
        endereco: endereco || null, contato: contato || null },
      { onConflict: 'conta_id' },
    )
    if (cfgErr) return { error: cfgErr.message }

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
        return { error: 'Este nome de remetente já está em uso por outra conta. Escolha outro.' }
      }
      if (remErr) return { error: remErr.message }
    }

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/configuracoes')
  return { error: null, success: true }
}
