'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NOTIF_DEFAULTS, SAUDACOES_PADRAO } from '@/lib/notificacao/tipos'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export type ActionState = { error: string | null; success?: boolean }

// ── Verifica que o caller é admin (usa RLS + SECURITY DEFINER is_admin()) ──
async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')

  const { data } = await supabase
    .from('plataforma_admins')
    .select('user_id')
    .maybeSingle()
  if (!data) throw new Error('Acesso negado.')

  return { adminUserId: user.id }
}

// ── Criar conta + convidar usuário ──────────────────────────────────────────
export async function criarContaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { adminUserId } = await requireAdmin()

    const email       = (formData.get('email') as string).trim().toLowerCase()
    const nomeEmpresa = (formData.get('nome_empresa') as string).trim()
    const validade    = (formData.get('validade_plano') as string).trim()
    const limite      = Math.max(1, parseInt(formData.get('limite_clientes') as string) || 100)

    if (!email || !nomeEmpresa || !validade) {
      return { error: 'Preencha todos os campos obrigatórios.' }
    }

    const admin   = createAdminClient()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

    // Verificar se o e-mail já tem usuário no Supabase Auth
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const existente = users.find(u => u.email === email)

    let novoUserId: string

    if (existente) {
      // Usuário já existe — verificar se já tem conta
      const { data: contaExistente } = await admin
        .from('contas')
        .select('id')
        .eq('owner_user_id', existente.id)
        .maybeSingle()

      if (contaExistente) {
        return { error: 'Este e-mail já tem uma conta cadastrada no sistema.' }
      }

      // Usuário existe mas sem conta — usa o ID existente (sem reenviar convite)
      novoUserId = existente.id
    } else {
      // Novo usuário — enviar convite
      const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
        email,
        { redirectTo: `${siteUrl}/auth/callback?next=/dashboard` },
      )
      if (inviteErr) return { error: `Erro ao convidar: ${inviteErr.message}` }
      novoUserId = invite.user.id
    }

    // Criar conta
    const { data: conta, error: contaErr } = await admin
      .from('contas')
      .insert({
        owner_user_id:   novoUserId,
        nome_empresa:    nomeEmpresa,
        status:          'ativa',
        validade_plano:  validade,
        limite_clientes: limite,
      })
      .select('id')
      .single()
    if (contaErr) return { error: `Erro ao criar conta: ${contaErr.message}` }

    // Seed configuracoes com defaults
    const { error: cfgSeedErr } = await admin.from('configuracoes').insert({ conta_id: conta.id })
    if (cfgSeedErr) throw new Error(`Erro ao criar configurações: ${cfgSeedErr.message}`)

    // Seed 8 tipos de notificação com templates padrão (ativados = false)
    const { error: notifSeedErr } = await admin.from('notificacoes_config').upsert(
      NOTIF_DEFAULTS.map(n => ({
        conta_id:          conta.id,
        tipo:              n.tipo,
        horario:           n.horario,
        ativo_whatsapp:    false,
        ativo_email:       false,
        template_whatsapp: n.template_whatsapp,
        assunto_email:     n.assunto_email,
        template_email:    n.template_email,
      })),
      { onConflict: 'conta_id,tipo', ignoreDuplicates: true },
    )
    if (notifSeedErr) throw new Error(`Erro ao criar notificações padrão: ${notifSeedErr.message}`)

    // Seed 10 saudações padrão (#SAUDACAO# em rodízio aleatório)
    const { error: saudSeedErr } = await admin.from('saudacoes').insert(
      SAUDACOES_PADRAO.map(texto => ({ conta_id: conta.id, texto })),
    )
    if (saudSeedErr) console.error('[criarConta] saudacoes.seed', saudSeedErr, { contaId: conta.id })

    // Audit log — toda ação admin é registrada
    const { error: auditErr } = await admin.from('audit_log').insert({
      actor:         'admin',
      actor_id:      adminUserId,
      acao:          'criar_conta',
      conta_id_alvo: conta.id,
      detalhe:       { email, nome_empresa: nomeEmpresa },
    })
    if (auditErr) console.error('[criarConta] audit_log', auditErr, { contaId: conta.id })
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/admin/contas')
  redirect('/admin/contas')
}

// ── Editar dados da conta ───────────────────────────────────────────────────
export async function editarContaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const contaId = formData.get('conta_id') as string

  try {
    const { adminUserId } = await requireAdmin()

    const nomeEmpresa = (formData.get('nome_empresa') as string).trim()
    const validade    = (formData.get('validade_plano') as string).trim()
    const limite      = Math.max(1, parseInt(formData.get('limite_clientes') as string) || 100)

    if (!nomeEmpresa) return { error: 'Nome da empresa é obrigatório.' }

    const admin = createAdminClient()

    const { error } = await admin
      .from('contas')
      .update({
        nome_empresa:    nomeEmpresa,
        validade_plano:  validade || null,
        limite_clientes: limite,
      })
      .eq('id', contaId)
    if (error) return { error: error.message }

    const { error: auditErr } = await admin.from('audit_log').insert({
      actor:         'admin',
      actor_id:      adminUserId,
      acao:          'editar_conta',
      conta_id_alvo: contaId,
      detalhe:       { nome_empresa: nomeEmpresa, validade_plano: validade, limite_clientes: limite },
    })
    if (auditErr) console.error('[editarConta] audit_log', auditErr, { contaId })
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/admin/contas')
  revalidatePath(`/admin/contas/${contaId}`)
  return { error: null, success: true }
}

// ── Alterar status da conta ─────────────────────────────────────────────────
export async function alterarStatusAction(
  contaId: string,
  status: 'ativa' | 'suspensa' | 'expirada',
) {
  const { adminUserId } = await requireAdmin()
  const admin = createAdminClient()

  const { error } = await admin.from('contas').update({ status }).eq('id', contaId)
  if (error) throw new Error(error.message)

  const { error: auditErr } = await admin.from('audit_log').insert({
    actor:         'admin',
    actor_id:      adminUserId,
    acao:          `conta_${status}`,
    conta_id_alvo: contaId,
  })
  if (auditErr) console.error('[alterarStatus] audit_log', auditErr, { contaId, status })

  revalidatePath('/admin/contas')
  revalidatePath(`/admin/contas/${contaId}`)
}

// ── Renovar validade manualmente ────────────────────────────────────────────
export async function renovarValidadeAction(contaId: string, novaValidade: string) {
  const { adminUserId } = await requireAdmin()
  const admin = createAdminClient()

  const { error } = await admin
    .from('contas')
    .update({ validade_plano: novaValidade, status: 'ativa' })
    .eq('id', contaId)
  if (error) throw new Error(error.message)

  const { error: auditErr } = await admin.from('audit_log').insert({
    actor:         'admin',
    actor_id:      adminUserId,
    acao:          'renovar_validade',
    conta_id_alvo: contaId,
    detalhe:       { nova_validade: novaValidade },
  })
  if (auditErr) console.error('[renovarValidade] audit_log', auditErr, { contaId })

  revalidatePath(`/admin/contas/${contaId}`)
}

// ── Registrar impersonação e redirecionar ───────────────────────────────────
export async function impersonarAction(contaId: string) {
  const { adminUserId } = await requireAdmin()
  const admin = createAdminClient()

  // Registro obrigatório antes de qualquer visualização de dados do tenant
  const { error: auditErr } = await admin.from('audit_log').insert({
    actor:         'admin',
    actor_id:      adminUserId,
    acao:          'impersonar',
    conta_id_alvo: contaId,
    detalhe:       { iniciado_em: new Date().toISOString() },
  })
  if (auditErr) console.error('[impersonar] audit_log', auditErr, { contaId })

  redirect(`/admin/impersonar/${contaId}`)
}
