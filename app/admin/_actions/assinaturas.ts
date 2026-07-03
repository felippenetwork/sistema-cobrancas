'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type ActionState = { error: string | null; initPoint?: string; success?: boolean }

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data } = await supabase.from('plataforma_admins').select('user_id').maybeSingle()
  if (!data) throw new Error('Acesso negado.')
  return { adminUserId: user.id }
}

// ── Criar assinatura Preapproval no Mercado Pago ─────────────────────────────
export async function criarAssinaturaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const contaId = formData.get('conta_id') as string

  try {
    await requireAdmin()

    const valorStr  = (formData.get('valor') as string).replace(',', '.')
    const valor     = parseFloat(valorStr)
    const descricao = (formData.get('descricao') as string).trim()

    if (isNaN(valor) || valor <= 0) return { error: 'Valor inválido.' }
    if (!contaId)                   return { error: 'Selecione uma conta.' }

    const token   = process.env.MP_ACCESS_TOKEN
    if (!token)   return { error: 'MP_ACCESS_TOKEN não configurado no servidor.' }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
    const admin   = createAdminClient()

    // Buscar e-mail do dono da conta
    const { data: conta } = await admin
      .from('contas')
      .select('nome_empresa, owner_user_id')
      .eq('id', contaId)
      .single()
    if (!conta) return { error: 'Conta não encontrada.' }

    const { data: { user: owner } } = await admin.auth.admin.getUserById(
      conta.owner_user_id,
    )
    const email = owner?.email
    if (!email) return { error: 'E-mail do dono não encontrado.' }

    // Chamar API do Mercado Pago — Preapproval
    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason:        descricao || `Assinatura Cobranx — ${conta.nome_empresa}`,
        auto_recurring: {
          frequency:          1,
          frequency_type:     'months',
          transaction_amount: valor,
          currency_id:        'BRL',
        },
        back_url:    `${siteUrl}/admin/assinaturas`,
        payer_email: email,
      }),
    })

    if (!mpRes.ok) {
      const err = await mpRes.json().catch(() => ({})) as { message?: string }
      return { error: `MP: ${err.message ?? mpRes.statusText}` }
    }

    const mpData = await mpRes.json()
    const preapprovalId = mpData.id as string
    const initPoint     = mpData.init_point as string

    // Salvar assinatura no banco
    const { error: dbErr } = await admin.from('assinaturas').insert({
      conta_id:          contaId,
      mp_preapproval_id: preapprovalId,
      status:            'pendente',
      valor,
    })
    if (dbErr) return { error: dbErr.message }

    await admin.from('audit_log').insert({
      actor: 'admin', actor_id: (await requireAdmin()).adminUserId,
      acao: 'criar_assinatura',
      conta_id_alvo: contaId,
      detalhe: { mp_preapproval_id: preapprovalId, valor },
    })

    revalidatePath('/admin/assinaturas')
    return { error: null, initPoint, success: true }

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
