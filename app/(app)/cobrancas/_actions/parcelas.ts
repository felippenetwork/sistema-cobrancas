'use server'

// Baixa e edição de parcelas.
// §3 regras-financeiras: REGRA ÚNICA, dois pontos de entrada idênticos.
// ⚠️ NÃO gerar próxima parcela recorrente aqui — responsabilidade do scheduler (Sprint 8).

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { calcularVencimento } from '@/lib/utils/parcelas'

const schemaId = z.string().uuid()

// ── Cobrança manual via WhatsApp ─────────────────────────────────────────────
// Cria notificacoes_enviadas com tipo='manual', status='fila'.
// Sem idempotência — reenvio é intencional (0003 exclui 'manual' da constraint).
export async function cobrarManualAction(formData: FormData) {
  const parcelaId = formData.get('parcela_id') as string
  const supabase  = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')

  // parcelas não tem cliente_id direto — buscar via cobranca
  const { data: parcela } = await supabase
    .from('parcelas')
    .select('id, conta_id, cobranca_id, cobrancas!inner(cliente_id)')
    .eq('id', parcelaId)
    .single()
  if (!parcela) throw new Error('Parcela não encontrada.')

  const clienteId = (parcela.cobrancas as any).cliente_id as string

  await supabase.from('notificacoes_enviadas').insert({
    conta_id:      parcela.conta_id,
    parcela_id:    parcela.id,
    cobranca_id:   parcela.cobranca_id,
    cliente_id:    clienteId,
    tipo:          'manual',
    canal:         'whatsapp',
    status:        'fila',
    agendado_para: new Date().toISOString(),
  })

  revalidatePath(`/cobrancas/${parcela.cobranca_id}`)
}

export type ActionState = { error: string | null; success?: boolean }

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) throw new Error('Conta não encontrada.')
  return { supabase, contaId: conta.id as string }
}

// ── Dar baixa numa parcela ───────────────────────────────────────────────────
// Passos 1-4 rodam via RPC Postgres (transação real — migration 0013).
// Passos 5-6 (confirmação de pagamento + próxima parcela recorrente) são
// efeitos colaterais sem risco de corrupção caso falhem isoladamente.
export async function baixarParcelaAction(formData: FormData) {
  const parsed = schemaId.safeParse(formData.get('parcela_id'))
  if (!parsed.success) return
  const parcelaId  = parsed.data
  const redirectTo = (formData.get('redirect_to') as string) || null

  const { supabase, contaId } = await requireUser()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) // YYYY-MM-DD

  // Passos 1-4: parcela paga + lancamento + cancelar notifs + fechar cobrança — ATÔMICO
  const admin = createAdminClient()
  const { data: rpcData, error: rpcErr } = await admin.rpc('baixar_parcela', {
    p_parcela_id: parcelaId,
    p_conta_id:   contaId,
    p_hoje:       hoje,
  })

  if (rpcErr) {
    console.error('[baixarParcela] rpc.error', rpcErr, { parcelaId, contaId })
    revalidatePath('/cobrancas')
    if (redirectTo) redirect(redirectTo)
    return
  }

  const result = rpcData as { ok: boolean; erro?: string; cobranca_id?: string; conta_id?: string; recorrente?: boolean; cliente_id?: string }

  if (!result?.ok) {
    // Já paga ou não encontrada — silencia (idempotência)
    revalidatePath('/cobrancas')
    if (redirectTo) redirect(redirectTo)
    return
  }

  const cobrancaId = result.cobranca_id as string
  const contaIdDaParcela = result.conta_id as string

  // Passo 5: enfileirar confirmação de pagamento
  const clienteId = result.cliente_id as string | null
  if (clienteId) {
    const { data: cfgPag } = await supabase
      .from('notificacoes_config')
      .select('ativo_whatsapp, ativo_email')
      .eq('conta_id', contaIdDaParcela)
      .eq('tipo', 'pagamento_confirmado')
      .maybeSingle()

    const agora     = new Date().toISOString()
    const baseNotif = {
      conta_id:      contaIdDaParcela,
      parcela_id:    parcelaId,
      cobranca_id:   cobrancaId,
      cliente_id:    clienteId,
      tipo:          'pagamento_confirmado' as const,
      status:        'fila' as const,
      agendado_para: agora,
    }

    if ((cfgPag as any)?.ativo_whatsapp) {
      const { error: confWaErr } = await supabase
        .from('notificacoes_enviadas').insert({ ...baseNotif, canal: 'whatsapp' as const })
      if (confWaErr) console.error('[baixarParcela] pagamento_confirmado.whatsapp', confWaErr)
    }
    if ((cfgPag as any)?.ativo_email) {
      const { error: confEmErr } = await supabase
        .from('notificacoes_enviadas').insert({ ...baseNotif, canal: 'email' as const })
      if (confEmErr) console.error('[baixarParcela] pagamento_confirmado.email', confEmErr)
    }
  }

  // Passo 6: recorrente → gerar próxima parcela imediatamente se não sobrou nenhuma aberta.
  //          O scheduler (1h) serve de safety net; aqui garante UX imediata.
  if (result.recorrente) {
    const { data: cob } = await supabase
      .from('cobrancas')
      .select('dia_pagamento, valor_mensalidade')
      .eq('id', cobrancaId)
      .eq('conta_id', contaId)
      .single()

    const { count: abertas } = await supabase
      .from('parcelas')
      .select('*', { count: 'exact', head: true })
      .eq('cobranca_id', cobrancaId)
      .eq('conta_id', contaId)
      .eq('status', 'aberta')

    if ((abertas ?? 0) === 0 && cob) {
      const { data: ultimaArr } = await supabase
        .from('parcelas')
        .select('numero, data_vencimento')
        .eq('cobranca_id', cobrancaId)
        .eq('conta_id', contaId)
        .order('numero', { ascending: false })
        .limit(1)

      if (ultimaArr?.length) {
        const ultima = ultimaArr[0]
        const proximoVencimento = calcularVencimento(
          new Date((ultima.data_vencimento as string) + 'T12:00:00'),
          (cob as any).dia_pagamento as number,
          1,
        ).toISOString().slice(0, 10)

        const { error: nextErr } = await supabase.from('parcelas').insert({
          conta_id:        contaIdDaParcela,
          cobranca_id:     cobrancaId,
          numero:          (ultima.numero as number) + 1,
          valor:           (cob as any).valor_mensalidade,
          data_vencimento: proximoVencimento,
          status:          'aberta',
        })
        if (nextErr) console.error('[baixarParcela] proxima_parcela.insert', nextErr, { cobrancaId })
      }
    }
  }

  revalidatePath('/cobrancas')
  revalidatePath(`/cobrancas/${cobrancaId}`)
  if (redirectTo) redirect(redirectTo)
}

// ── Editar parcela (vencimento, valor, observação) ───────────────────────────
export async function editarParcelaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parcelaId      = formData.get('parcela_id') as string
  const dataVencimento = formData.get('data_vencimento') as string
  const valorStr       = (formData.get('valor') as string).replace(',', '.')
  const observacao     = (formData.get('observacao') as string)?.trim() || null

  const valor = parseFloat(valorStr)
  if (isNaN(valor) || valor <= 0) return { error: 'Valor inválido.' }
  if (!dataVencimento)             return { error: 'Data de vencimento obrigatória.' }

  // Valida que a data não está mais de 10 anos no futuro
  const limite = new Date()
  limite.setFullYear(limite.getFullYear() + 10)
  if (new Date(dataVencimento) > limite) return { error: 'Data de vencimento muito distante.' }

  const { supabase, contaId } = await requireUser()

  const { error } = await supabase
    .from('parcelas')
    .update({ data_vencimento: dataVencimento, valor, observacao })
    .eq('id', parcelaId)
    .eq('conta_id', contaId)
    .eq('status', 'aberta')  // não editar parcela já paga

  if (error) return { error: error.message }

  // Reagendar notificações em fila com base no novo vencimento
  const TYPE_OFFSET: Record<string, number> = {
    '5d': -5, '3d': -3, '2d': -2, '1d': -1, 'dia': 0, 'vencido1d': 1,
  }
  const { data: notifsEmFila } = await supabase
    .from('notificacoes_enviadas')
    .select('id, tipo')
    .eq('parcela_id', parcelaId)
    .eq('conta_id', contaId)
    .eq('status', 'fila')

  if (notifsEmFila?.length) {
    const hojeStr  = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const hojeRef  = new Date(`${hojeStr}T09:00:00-03:00`)

    for (const notif of notifsEmFila) {
      const offset = TYPE_OFFSET[notif.tipo]
      if (offset === undefined) continue  // manual/boasvindas: não reagendar

      const novaData = new Date(`${dataVencimento}T09:00:00-03:00`)
      novaData.setDate(novaData.getDate() + offset)

      // Se a nova data já passou, mantém para ser enviado no próximo ciclo
      const agendadoPara = novaData < hojeRef ? hojeRef : novaData

      const { error: reagErr } = await supabase
        .from('notificacoes_enviadas')
        .update({ agendado_para: agendadoPara.toISOString() })
        .eq('id', notif.id)
        .eq('conta_id', contaId)
      if (reagErr) console.error('[editarParcela] notif.reagendar', reagErr, { notifId: notif.id })
    }
  }

  revalidatePath('/cobrancas')
  return { error: null, success: true }
}
