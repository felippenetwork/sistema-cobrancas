'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { gerarParcelasFixas, gerarParcelasRecorrentes } from '@/lib/utils/parcelas'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const schemaId = z.string().uuid()

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
    const meioPagamentoId    = (formData.get('meio_pagamento_id') as string)?.trim() || null

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
        meio_pagamento_id:     meioPagamentoId,
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

    // Boas-vindas: enfileira apenas os canais habilitados na config da conta
    if (enviarBoasVindas) {
      const { data: cfgBv } = await supabase
        .from('notificacoes_config')
        .select('ativo_whatsapp, ativo_email')
        .eq('conta_id', contaId)
        .eq('tipo', 'boasvindas')
        .maybeSingle()

      const agora      = new Date().toISOString()
      const baseNotif  = { conta_id: contaId, cobranca_id: cob.id, cliente_id: clienteId,
                           tipo: 'boasvindas' as const, status: 'fila' as const, agendado_para: agora }
      const inserts    = []
      if (cfgBv?.ativo_whatsapp) inserts.push({ ...baseNotif, canal: 'whatsapp' as const })
      if (cfgBv?.ativo_email)    inserts.push({ ...baseNotif, canal: 'email' as const })
      if (inserts.length) {
        await supabase.from('notificacoes_enviadas').insert(inserts).throwOnError()
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
    const renovarExterno   = formData.get('renovar_externo')   === 'true'

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

    // Integração LookDefense: renovar apenas se o checkbox estiver marcado
    if (renovarExterno) {
      const { data: clienteInteg } = await supabase
        .from('clientes')
        .select('login_externo, tipo_integracao')
        .eq('id', clienteId)
        .maybeSingle()

      if (clienteInteg?.login_externo && clienteInteg?.tipo_integracao) {
        const { data: primeiraParc } = await supabase
          .from('parcelas')
          .select('id')
          .eq('cobranca_id', cob.id)
          .order('numero', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (primeiraParc?.id) {
          const { error: integErr } = await supabase.from('baixas_externas').insert({
            conta_id:        contaId,
            cliente_id:      clienteId,
            parcela_id:      primeiraParc.id,
            login_externo:   clienteInteg.login_externo,
            tipo_integracao: clienteInteg.tipo_integracao,
          })
          if (integErr) console.error('[criarCobrancaRapida] baixa_externa', integErr)
        }
      }
    }

    if (enviarBoasVindas) {
      const { data: cfgBv } = await supabase
        .from('notificacoes_config')
        .select('ativo_whatsapp, ativo_email')
        .eq('conta_id', contaId)
        .eq('tipo', 'boasvindas')
        .maybeSingle()

      const agora     = new Date().toISOString()
      const baseNotif = { conta_id: contaId, cobranca_id: cob.id, cliente_id: clienteId,
                          tipo: 'boasvindas' as const, status: 'fila' as const, agendado_para: agora }
      const inserts   = []
      if (cfgBv?.ativo_whatsapp) inserts.push({ ...baseNotif, canal: 'whatsapp' as const })
      if (cfgBv?.ativo_email)    inserts.push({ ...baseNotif, canal: 'email' as const })
      if (inserts.length) {
        await supabase.from('notificacoes_enviadas').insert(inserts).throwOnError()
      }
    }

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/cobrancas')
  revalidatePath('/clientes')
  redirect('/cobrancas')
}

// ── Cancelar cobrança ────────────────────────────────────────────────────────
export async function cancelarCobrancaAction(formData: FormData) {
  const parsed = schemaId.safeParse(formData.get('cobranca_id'))
  if (!parsed.success) return
  const cobrancaId = parsed.data
  const { supabase, contaId } = await getConta()

  const { error: cobErr } = await supabase
    .from('cobrancas')
    .update({ status: 'cancelada' })
    .eq('id', cobrancaId)
    .eq('conta_id', contaId)
  if (cobErr) console.error('[cancelarCobranca] cobrancas.update', cobErr, { cobrancaId, contaId })

  // Cancelar notificações em fila das parcelas dessa cobrança
  const { data: parcelas } = await supabase
    .from('parcelas').select('id').eq('cobranca_id', cobrancaId).eq('conta_id', contaId)
  const ids = (parcelas ?? []).map(p => p.id)
  if (ids.length > 0) {
    const { error: nErr } = await supabase
      .from('notificacoes_enviadas')
      .update({ status: 'cancelado' })
      .eq('status', 'fila')
      .eq('conta_id', contaId)
      .in('parcela_id', ids)
    if (nErr) console.error('[cancelarCobranca] notifs.update', nErr, { cobrancaId, contaId })
  }
  // Cancelar boasvindas em fila (têm cobranca_id mas não parcela_id)
  const { error: bvErr } = await supabase
    .from('notificacoes_enviadas')
    .update({ status: 'cancelado' })
    .eq('cobranca_id', cobrancaId)
    .eq('conta_id', contaId)
    .eq('status', 'fila')
  if (bvErr) console.error('[cancelarCobranca] boasvindas.update', bvErr, { cobrancaId, contaId })

  revalidatePath('/cobrancas')
  redirect('/cobrancas')
}
