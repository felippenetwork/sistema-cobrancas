'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type ActionState = { error: string | null; success?: boolean }

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data } = await supabase.from('plataforma_admins').select('user_id').maybeSingle()
  if (!data) throw new Error('Acesso negado.')
  return { adminUserId: user.id }
}

export async function salvarPlataformaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireAdmin()

    const dominio = (formData.get('dominio_email_operador') as string).trim().toLowerCase()

    if (!dominio) return { error: 'Informe o domínio de e-mail.' }
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(dominio)) {
      return { error: 'Domínio inválido. Ex.: cobranca.suaempresa.com.br' }
    }

    const admin = createAdminClient()
    const { error } = await admin
      .from('plataforma_config')
      .upsert({ id: 1, dominio_email_operador: dominio }, { onConflict: 'id' })

    if (error) return { error: error.message }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/admin/plataforma')
  return { error: null, success: true }
}
