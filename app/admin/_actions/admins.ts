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

// ── Adicionar admin (por e-mail — convida se não existir) ───────────────────
export async function adicionarAdminAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { adminUserId } = await requireAdmin()
    const email = (formData.get('email') as string).trim().toLowerCase()
    if (!email) return { error: 'E-mail obrigatório.' }

    const admin   = createAdminClient()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

    // Verifica se o usuário já existe
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const existente = users.find(u => u.email === email)

    let userId: string
    if (existente) {
      userId = existente.id
    } else {
      // Convida: receberá link de acesso apontando para o login admin
      const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
        email,
        { redirectTo: `${siteUrl}/admin/login` },
      )
      if (inviteErr) return { error: `Erro ao convidar: ${inviteErr.message}` }
      userId = invite.user.id
    }

    // Checa se já é admin
    const { data: jaAdmin } = await admin
      .from('plataforma_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (jaAdmin) return { error: 'Este e-mail já é administrador.' }

    const { error: insErr } = await admin.from('plataforma_admins').insert({ user_id: userId })
    if (insErr) return { error: insErr.message }

    await admin.from('audit_log').insert({
      actor: 'admin', actor_id: adminUserId,
      acao: 'adicionar_admin', detalhe: { email },
    })
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/admin/admins')
  return { error: null, success: true }
}

// ── Remover admin ────────────────────────────────────────────────────────────
export async function removerAdminAction(formData: FormData) {
  const { adminUserId } = await requireAdmin()
  const userId = formData.get('user_id') as string

  if (userId === adminUserId) throw new Error('Você não pode remover a si mesmo.')

  const admin = createAdminClient()
  const { count } = await admin
    .from('plataforma_admins')
    .select('*', { count: 'exact', head: true })
  if ((count ?? 0) <= 1) throw new Error('Deve existir pelo menos 1 administrador.')

  const { error } = await admin.from('plataforma_admins').delete().eq('user_id', userId)
  if (error) throw new Error(error.message)

  await admin.from('audit_log').insert({
    actor: 'admin', actor_id: adminUserId,
    acao: 'remover_admin', detalhe: { removido: userId },
  })

  revalidatePath('/admin/admins')
}
