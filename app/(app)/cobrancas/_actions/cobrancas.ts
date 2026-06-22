'use server'

import { createClient } from '@/lib/supabase/server'
import { gerarParcelasFixas, gerarParcelasRecorrentes } from '@/lib/utils/parcelas'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

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

// ── Criar cobrança + gerar parcelas ─────────────────────────────────────────
export async function criarCobrancaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    const clienteId          = formData.get('cliente_id') as string
    const valorStr           = (formData.get('valor_mensalidade') as string).replace(',', '.')
    const qtdStr             = formData.get('qtd_parcelas') as string
    const diaPagamento       = parseInt(formData.get('dia_pagamento') as string)
    const mesAnoStr          = formData.get('mes_ano_inicio') as string   // "YYYY-MM"
    const recorrente         = formData.get('recorrente') === 'true'
    const observacao         = (formData.get('observacao') as string)?.trim() || null
    const enviarBoasVindas   = formData.get('enviar_boas_vindas') === 'true'

    // Validações
    if (!clienteId)                       return { error: 'Selecione um cliente.' }
    if (!mesAnoStr || !/^\d{4}-\d{2}$/.test(mesAnoStr))
                                          return { error: 'Informe mês/ano de início.' }
    const valor = parseFloat(valorStr)
    if (isNaN(valor) || valor <= 0)       return { error: 'Valor da mensalidade inválido.' }
    if (diaPagamento < 1 || diaPagamento > 31 || isNaN(diaPagamento))
                                          return { error: 'Dia de pagamento inválido (1–31).' }

    const qtdParcelas = recorrente ? null : parseInt(qtdStr)
    if (!recorrente && (isNaN(qtdParcelas!) || qtdParcelas! < 1))
                                          return { error: 'Informe a quantidade de parcelas.' }

    // mes_ano_inicio: armazena o 1º dia do mês informado
    const mesAnoInicio = new Date(`${mesAnoStr}-01T12:00:00`)

    // Inserir cobrança
    const { data: cob, error: cobErr } = await supabase
      .from('cobrancas')
      .insert({
        conta_id:              contaId,
        cliente_id:            clienteId,
        valor_mensalidade:     valor,
        qtd_parcelas:          qtdParcelas,
        recorrente,
        dia_pagamento:         diaPagamento,
        mes_ano_inicio:        `${mesAnoStr}-01`,
        observacao,
        enviar_boas_vindas:    enviarBoasVindas,
        status:                'ativa',
      })
      .select('id')
      .single()
    if (cobErr) return { error: cobErr.message }

    // Gerar parcelas
    const parcelas = recorrente
      ? gerarParcelasRecorrentes(cob.id, contaId, mesAnoInicio, diaPagamento, valor)
      : gerarParcelasFixas(cob.id, contaId, mesAnoInicio, diaPagamento, valor, qtdParcelas!)

    const { error: parcErr } = await supabase.from('parcelas').insert(parcelas)
    if (parcErr) return { error: parcErr.message }

    // Boas-vindas: enfileira notificação (worker Sprint 8 vai processar)
    if (enviarBoasVindas) {
      const { data: cli } = await supabase
        .from('clientes').select('id').eq('id', clienteId).single()
      if (cli) {
        // Inserções por canal (só se o canal estiver ativo — verificado pelo worker)
        await supabase.from('notificacoes_enviadas').insert([
          { conta_id: contaId, cobranca_id: cob.id, cliente_id: clienteId,
            tipo: 'boasvindas', canal: 'whatsapp', status: 'fila' },
          { conta_id: contaId, cobranca_id: cob.id, cliente_id: clienteId,
            tipo: 'boasvindas', canal: 'email',    status: 'fila' },
        ]).throwOnError()
      }
    }

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/cobrancas')
  redirect('/cobrancas')
}

// ── Criar cobrança rápida (sem redirect — usada no sheet pós-cadastro de cliente) ──
export async function criarCobrancaRapidaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    const clienteId        = formData.get('cliente_id') as string
    const valorStr         = (formData.get('valor') as string).replace(',', '.')
    const recorrente       = formData.get('recorrente') === 'true'
    const qtdStr           = formData.get('qtd_meses') as string
    const primeiroVenc     = formData.get('primeiro_vencimento') as string  // "YYYY-MM-DD"
    const observacao       = (formData.get('observacao') as string | null)?.trim() || null
    const enviarBoasVindas = formData.get('enviar_boas_vindas') === 'true'

    if (!clienteId)                         return { error: 'Cliente inválido.' }
    if (!primeiroVenc || !/^\d{4}-\d{2}-\d{2}$/.test(primeiroVenc))
                                            return { error: 'Informe a data do primeiro vencimento.' }
    const valor = parseFloat(valorStr)
    if (isNaN(valor) || valor <= 0)         return { error: 'Valor inválido.' }

    const dt           = new Date(`${primeiroVenc}T12:00:00`)
    const diaPagamento = dt.getDate()
    const mesAnoStr    = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    const mesAnoInicio = new Date(`${mesAnoStr}-01T12:00:00`)

    const qtdParcelas = recorrente ? null : parseInt(qtdStr)
    if (!recorrente && (isNaN(qtdParcelas!) || qtdParcelas! < 1))
                                            return { error: 'Informe a quantidade de meses.' }

    const { data: cob, error: cobErr } = await supabase
      .from('cobrancas')
      .insert({
        conta_id:           contaId,
        cliente_id:         clienteId,
        valor_mensalidade:  valor,
        qtd_parcelas:       qtdParcelas,
        recorrente,
        dia_pagamento:      diaPagamento,
        mes_ano_inicio:     `${mesAnoStr}-01`,
        observacao,
        enviar_boas_vindas: enviarBoasVindas,
        status:             'ativa',
      })
      .select('id')
      .single()
    if (cobErr) return { error: cobErr.message }

    const parcelas = recorrente
      ? gerarParcelasRecorrentes(cob.id, contaId, mesAnoInicio, diaPagamento, valor)
      : gerarParcelasFixas(cob.id, contaId, mesAnoInicio, diaPagamento, valor, qtdParcelas!)

    const { error: parcErr } = await supabase.from('parcelas').insert(parcelas)
    if (parcErr) return { error: parcErr.message }

    if (enviarBoasVindas) {
      await supabase.from('notificacoes_enviadas').insert([
        { conta_id: contaId, cobranca_id: cob.id, cliente_id: clienteId,
          tipo: 'boasvindas', canal: 'whatsapp', status: 'fila' },
        { conta_id: contaId, cobranca_id: cob.id, cliente_id: clienteId,
          tipo: 'boasvindas', canal: 'email',    status: 'fila' },
      ])
    }

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/cobrancas')
  revalidatePath('/clientes')
  return { error: null, success: true }
}

// ── Cancelar cobrança ────────────────────────────────────────────────────────
export async function cancelarCobrancaAction(formData: FormData) {
  const cobrancaId = formData.get('cobranca_id') as string
  const { supabase } = await getConta()

  await supabase.from('cobrancas').update({ status: 'cancelada' }).eq('id', cobrancaId)

  // Cancelar notificações em fila das parcelas dessa cobrança
  const { data: parcelas } = await supabase
    .from('parcelas').select('id').eq('cobranca_id', cobrancaId)
  const ids = (parcelas ?? []).map((p: any) => p.id)
  if (ids.length > 0) {
    await supabase
      .from('notificacoes_enviadas')
      .update({ status: 'cancelado' })
      .eq('status', 'fila')
      .in('parcela_id', ids)
  }

  revalidatePath('/cobrancas')
  redirect('/cobrancas')
}
