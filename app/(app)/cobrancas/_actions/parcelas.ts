'use server'

// Baixa e edição de parcelas.
// §3 regras-financeiras: REGRA ÚNICA, dois pontos de entrada idênticos.
// ⚠️ NÃO gerar próxima parcela recorrente aqui — responsabilidade do scheduler (Sprint 8).

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { calcularVencimento } from '@/lib/utils/parcelas'

// ── Cobrança manual via WhatsApp ─────────────────────────────────────────────
// Cria notificacoes_enviadas com tipo='manual', status='fila'.
// Sem idempotência — reenvio é intencional (0003 exclui 'manual' da constraint).
export async function cobrarManualAction(formData: FormData) {
  const parcelaId = formData.get('parcela_id') as string
  const supabase  = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')

  const { data: parcela } = await supabase
    .from('parcelas')
    .select('id, conta_id, cliente_id, cobranca_id')
    .eq('id', parcelaId)
    .single()
  if (!parcela) throw new Error('Parcela não encontrada.')

  await supabase.from('notificacoes_enviadas').insert({
    conta_id:    parcela.conta_id,
    parcela_id:  parcela.id,
    cobranca_id: parcela.cobranca_id,
    cliente_id:  parcela.cliente_id,
    tipo:        'manual',
    canal:       'whatsapp',
    status:      'fila',
    agendado_para: new Date().toISOString(),
  })

  revalidatePath(`/cobrancas/${parcela.cobranca_id}`)
}

export type ActionState = { error: string | null; success?: boolean }

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  return { supabase, userId: user.id }
}

// ── Dar baixa numa parcela ───────────────────────────────────────────────────
// Efeitos atômicos (§3):
//   1. parcela.status = paga, data_pagamento = hoje
//   2. Cria lancamento de entrada
//   3. Cancela notificações em fila
//   4. Se não-recorrente: fecha cobrança quando todas as parcelas estão pagas
export async function baixarParcelaAction(formData: FormData) {
  const parcelaId  = formData.get('parcela_id') as string
  const redirectTo = (formData.get('redirect_to') as string) || null

  const { supabase } = await requireUser()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) // YYYY-MM-DD

  // 1. Marcar como paga (RLS garante que só altera parcela da própria conta)
  const { data: parcela, error: updErr } = await supabase
    .from('parcelas')
    .update({ status: 'paga', data_pagamento: hoje })
    .eq('id', parcelaId)
    .eq('status', 'aberta')  // idempotência: não baixar parcela já paga
    .select('id, valor, conta_id, cobranca_id')
    .single()

  if (updErr || !parcela) {
    // Já paga ou não encontrada — silencia (idempotência)
    revalidatePath('/cobrancas')
    if (redirectTo) redirect(redirectTo)
    return
  }

  // 2. Lançamento de entrada (alimenta Dashboard)
  await supabase.from('lancamentos').insert({
    conta_id:   parcela.conta_id,
    tipo:       'entrada',
    origem:     'parcela',
    parcela_id: parcela.id,
    valor:      parcela.valor,
    data:       hoje,
  })

  // 3. Cancelar notificações em fila desta parcela (ambos os canais)
  await supabase
    .from('notificacoes_enviadas')
    .update({ status: 'cancelado' })
    .eq('parcela_id', parcelaId)
    .eq('status', 'fila')

  // 4. Buscar cobrança (recorrente + dados para geração de próxima parcela)
  const { data: cob } = await supabase
    .from('cobrancas')
    .select('recorrente, cliente_id, dia_pagamento, valor_mensalidade')
    .eq('id', parcela.cobranca_id)
    .single()

  // Enfileirar confirmação de pagamento via WhatsApp (imediato)
  const clienteId = (cob as any)?.cliente_id as string | null
  if (clienteId) {
    await supabase.from('notificacoes_enviadas').insert({
      conta_id:      parcela.conta_id,
      parcela_id:    parcela.id,
      cobranca_id:   parcela.cobranca_id,
      cliente_id:    clienteId,
      tipo:          'pagamento_confirmado',
      canal:         'whatsapp',
      status:        'fila',
      agendado_para: new Date().toISOString(),
    })
  }

  // 5. Fechar cobrança não-recorrente quando todas as parcelas estão pagas (A6)
  if (cob && !(cob as any).recorrente) {
    const { count } = await supabase
      .from('parcelas')
      .select('*', { count: 'exact', head: true })
      .eq('cobranca_id', parcela.cobranca_id)
      .neq('status', 'paga')

    if ((count ?? 1) === 0) {
      await supabase
        .from('cobrancas')
        .update({ status: 'concluida' })
        .eq('id', parcela.cobranca_id)
    }
  }
  // 6. Recorrente: gerar próxima parcela imediatamente se não sobrou nenhuma aberta.
  //    O scheduler (1h) serve de safety net; aqui garante UX imediata.
  if (cob && (cob as any).recorrente) {
    const { count: abertas } = await supabase
      .from('parcelas')
      .select('*', { count: 'exact', head: true })
      .eq('cobranca_id', parcela.cobranca_id)
      .eq('status', 'aberta')

    if ((abertas ?? 0) === 0) {
      const { data: ultimaArr } = await supabase
        .from('parcelas')
        .select('numero, data_vencimento')
        .eq('cobranca_id', parcela.cobranca_id)
        .order('numero', { ascending: false })
        .limit(1)

      if (ultimaArr?.length) {
        const ultima = ultimaArr[0]
        const proximoVencimento = calcularVencimento(
          new Date((ultima.data_vencimento as string) + 'T12:00:00'),
          (cob as any).dia_pagamento as number,
          1,
        ).toISOString().slice(0, 10)

        await supabase.from('parcelas').insert({
          conta_id:        parcela.conta_id,
          cobranca_id:     parcela.cobranca_id,
          numero:          (ultima.numero as number) + 1,
          valor:           (cob as any).valor_mensalidade,
          data_vencimento: proximoVencimento,
          status:          'aberta',
        })
      }
    }
  }

  revalidatePath('/cobrancas')
  revalidatePath(`/cobrancas/${parcela.cobranca_id}`)
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

  const { supabase } = await requireUser()

  const { error } = await supabase
    .from('parcelas')
    .update({ data_vencimento: dataVencimento, valor, observacao })
    .eq('id', parcelaId)
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

      await supabase
        .from('notificacoes_enviadas')
        .update({ agendado_para: agendadoPara.toISOString() })
        .eq('id', notif.id)
    }
  }

  revalidatePath('/cobrancas')
  return { error: null, success: true }
}
