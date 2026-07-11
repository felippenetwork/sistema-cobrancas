'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getConta } from '@/lib/conta'

type Result = { error: string | null }

// Apenas owners ou admins podem gerenciar a equipe
async function getContaAdmin() {
  const ctx = await getConta()
  if (!ctx.isOwner) {
    // Verifica se é membro com role admin
    const { data: membro } = await ctx.supabase
      .from('membros_conta')
      .select('role')
      .eq('conta_id', ctx.contaId)
      .eq('user_id', ctx.userId)
      .maybeSingle()
    if (membro?.role !== 'admin') throw new Error('Sem permissão. Apenas administradores podem gerenciar a equipe.')
  }
  return ctx
}

export async function convidarMembroAction(
  _prev: Result,
  formData: FormData,
): Promise<Result> {
  try {
    const ctx   = await getContaAdmin()
    const admin = createAdminClient()

    const email = (formData.get('email') as string)?.trim().toLowerCase()
    const nome  = (formData.get('nome')  as string)?.trim()
    const role  = (formData.get('role')  as string) ?? 'atendente'

    if (!email) return { error: 'Informe o e-mail do atendente.' }
    if (!nome)  return { error: 'Informe o nome do atendente.' }
    if (!['admin', 'atendente'].includes(role)) return { error: 'Cargo inválido.' }

    const roleValido = role as 'admin' | 'atendente'

    // Verificar se já é membro
    const { data: existing } = await ctx.supabase
      .from('membros_conta')
      .select('id, ativo')
      .eq('conta_id', ctx.contaId)
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      if (existing.ativo) return { error: 'Este e-mail já é membro ativo da equipe.' }
      // Reativar membro desativado
      const { error } = await admin.from('membros_conta')
        .update({ ativo: true, nome, role: roleValido })
        .eq('id', existing.id)
      if (error) return { error: error.message }
      revalidatePath('/equipe')
      return { error: null }
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? ''

    // Convidar via Supabase Auth (envia e-mail)
    const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data:       { nome },
      redirectTo: `${siteUrl}/auth/callback?redirect_to=/atendimento`,
    })

    if (invErr) {
      // Usuário já existe no Auth → busca e vincula
      if (invErr.message?.includes('already been registered')) {
        const { data: users } = await admin.auth.admin.listUsers()
        const user = users?.users?.find(u => u.email === email)
        if (!user) return { error: 'Usuário já cadastrado mas não encontrado. Tente novamente.' }

        const { error: memErr } = await admin.from('membros_conta').insert({
          conta_id: ctx.contaId,
          user_id:  user.id,
          nome,
          email,
          role: roleValido,
        })
        if (memErr) return { error: memErr.message }
        revalidatePath('/equipe')
        return { error: null }
      }
      return { error: `Erro ao convidar: ${invErr.message}` }
    }

    const { error: memErr } = await admin.from('membros_conta').insert({
      conta_id: ctx.contaId,
      user_id:  invited.user.id,
      nome,
      email,
      role: roleValido,
    })

    if (memErr) return { error: `Convite enviado, mas erro ao registrar membro: ${memErr.message}` }

    revalidatePath('/equipe')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function atualizarMembroAction(
  membroId: string,
  campos: { nome?: string; role?: 'admin' | 'atendente'; ativo?: boolean },
): Promise<Result> {
  try {
    const ctx = await getContaAdmin()

    const { error } = await ctx.supabase
      .from('membros_conta')
      .update(campos)
      .eq('id', membroId)
      .eq('conta_id', ctx.contaId)

    if (error) return { error: error.message }

    revalidatePath('/equipe')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function removerMembroAction(membroId: string): Promise<Result> {
  try {
    const ctx = await getContaAdmin()

    const { error } = await ctx.supabase
      .from('membros_conta')
      .update({ ativo: false })
      .eq('id', membroId)
      .eq('conta_id', ctx.contaId)

    if (error) return { error: error.message }

    revalidatePath('/equipe')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function criarDepartamentoAction(
  _prev: Result,
  formData: FormData,
): Promise<Result> {
  try {
    const ctx  = await getContaAdmin()
    const nome = (formData.get('nome') as string)?.trim()
    const cor  = (formData.get('cor')  as string) ?? '#6366f1'

    if (!nome) return { error: 'Informe o nome do departamento.' }

    const { error } = await ctx.supabase
      .from('departamentos')
      .insert({ conta_id: ctx.contaId, nome, cor })

    if (error) return { error: error.message }

    revalidatePath('/equipe')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function removerDepartamentoAction(depId: string): Promise<Result> {
  try {
    const ctx = await getContaAdmin()

    const { error } = await ctx.supabase
      .from('departamentos')
      .delete()
      .eq('id', depId)
      .eq('conta_id', ctx.contaId)
      .neq('nome', 'Geral') // proteger o departamento padrão

    if (error) return { error: error.message }

    revalidatePath('/equipe')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
