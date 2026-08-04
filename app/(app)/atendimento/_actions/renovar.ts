'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcularVencimento } from '@/lib/utils/parcelas'
import { enviarWhatsAppImediato } from '@/lib/whatsapp/enviar-imediato'
import { renovarLookDefenseImediato } from '@/lib/lookdefense/renovar-imediato'
import { criarCobrancaPix, type PixGerado } from '@/lib/efibank/pix'

export type ActionState = { error: string | null; success?: boolean }

export type DadosPainel = {
  cliente: {
    nome: string; sobrenome: string; celular: string
    email: string | null; loginExterno: string | null; tipoIntegracao: string | null
  } | null
  cobranca: { id: string; valorMensalidade: number; diaPagamento: number | null } | null
  parcela:  { id: string; valor: number; dataVencimento: string } | null
}

// Busca todos os dados necessários para o painel numa única chamada
export async function buscarDadosPainelAction(clienteId: string): Promise<DadosPainel | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const contaId = await resolverContaId(supabase, user.id)
  if (!contaId) return null

  const [{ data: cliente }, { data: cobrancas }] = await Promise.all([
    supabase.from('clientes')
      .select('nome, sobrenome, celular, email, login_externo, tipo_integracao')
      .eq('id', clienteId).eq('conta_id', contaId).maybeSingle(),
    supabase.from('cobrancas')
      .select('id, valor_mensalidade, dia_pagamento')
      .eq('conta_id', contaId).eq('cliente_id', clienteId).neq('status', 'cancelada')
      .order('created_at', { ascending: false }).limit(1),
  ])

  const cob = (cobrancas?.[0] as any) ?? null

  let parcela = null
  if (cob?.id) {
    const { data: p } = await supabase.from('parcelas')
      .select('id, valor, data_vencimento')
      .eq('conta_id', contaId).eq('cobranca_id', cob.id).eq('status', 'aberta')
      .order('data_vencimento', { ascending: true }).limit(1).maybeSingle()
    if (p) parcela = { id: (p as any).id, valor: Number((p as any).valor), dataVencimento: (p as any).data_vencimento as string }
  }

  return {
    cliente: cliente ? {
      nome:            (cliente as any).nome          ?? '',
      sobrenome:       (cliente as any).sobrenome     ?? '',
      celular:         (cliente as any).celular       ?? '',
      email:           (cliente as any).email         ?? null,
      loginExterno:    (cliente as any).login_externo ?? null,
      tipoIntegracao:  (cliente as any).tipo_integracao ?? null,
    } : null,
    cobranca: cob ? { id: cob.id, valorMensalidade: Number(cob.valor_mensalidade ?? 0), diaPagamento: cob.dia_pagamento ?? null } : null,
    parcela,
  }
}

// Atualiza todos os dados editáveis do cliente
export async function atualizarClienteCompletoAction(
  clienteId: string,
  dados: { nome: string; sobrenome: string; celular: string; email: string; loginExterno: string; tipoIntegracao: string },
): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const contaId = await resolverContaId(supabase, user.id)
  if (!contaId) return { error: 'Conta não encontrada.' }

  const { error } = await supabase.from('clientes').update({
    nome:            dados.nome.trim(),
    sobrenome:       dados.sobrenome.trim() || null,
    celular:         dados.celular.trim(),
    email:           dados.email.trim() || null,
    login_externo:   dados.loginExterno.trim() || null,
    tipo_integracao: dados.tipoIntegracao || null,
  }).eq('id', clienteId).eq('conta_id', contaId)

  if (error) return { error: error.message }
  return { error: null, success: true }
}

// Atualiza o valor da mensalidade na cobrança (e cascateia para parcelas abertas)
export async function atualizarCobrancaValorAction(
  cobrancaId: string,
  valorMensalidade: number,
): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const contaId = await resolverContaId(supabase, user.id)
  if (!contaId) return { error: 'Conta não encontrada.' }

  if (isNaN(valorMensalidade) || valorMensalidade <= 0) return { error: 'Valor inválido.' }

  const { error: e1 } = await supabase.from('cobrancas')
    .update({ valor_mensalidade: valorMensalidade })
    .eq('id', cobrancaId).eq('conta_id', contaId)
  if (e1) return { error: e1.message }

  // Cascateia para parcelas abertas
  await supabase.from('parcelas')
    .update({ valor: valorMensalidade })
    .eq('cobranca_id', cobrancaId).eq('conta_id', contaId).eq('status', 'aberta')

  return { error: null, success: true }
}

async function resolverContaId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string | null> {
  const { data: conta } = await supabase.from('contas').select('id').eq('owner_user_id', userId).maybeSingle()
  if (conta?.id) return conta.id as string
  const { data: membro } = await supabase.from('membros_conta').select('conta_id').eq('user_id', userId).eq('ativo', true).maybeSingle()
  return (membro as any)?.conta_id ?? null
}

// Gera uma cobrança PIX via EfiBanK para a parcela aberta do cliente
export async function gerarPixParcelaAction(
  parcelaId: string,
  valor: number,
  descricao?: string,
): Promise<(PixGerado & { error?: undefined }) | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const contaId = await resolverContaId(supabase, user.id)
  if (!contaId) return { error: 'Conta não encontrada.' }

  const result = await criarCobrancaPix(contaId, parcelaId, valor, descricao)
  if ('erro' in result) return { error: result.erro }
  return result
}

// Retorna a próxima parcela aberta do cliente e o cobrancaId para links
export async function buscarParcelaClienteAction(clienteId: string): Promise<{
  cobrancaId: string
  parcela: { id: string; valor: number; dataVencimento: string } | null
} | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const contaId = await resolverContaId(supabase, user.id)
  if (!contaId) return null

  // Pega a cobrança ativa mais recente do cliente
  const { data: cobrancas } = await supabase
    .from('cobrancas')
    .select('id')
    .eq('conta_id', contaId)
    .eq('cliente_id', clienteId)
    .neq('status', 'cancelada')
    .order('created_at', { ascending: false })
    .limit(1)

  const cobrancaId = (cobrancas?.[0] as any)?.id as string | undefined
  if (!cobrancaId) return null

  // Próxima parcela aberta
  const { data: parcela } = await supabase
    .from('parcelas')
    .select('id, valor, data_vencimento')
    .eq('conta_id', contaId)
    .eq('cobranca_id', cobrancaId)
    .eq('status', 'aberta')
    .order('data_vencimento', { ascending: true })
    .limit(1)
    .maybeSingle()

  return {
    cobrancaId,
    parcela: parcela
      ? { id: (parcela as any).id, valor: Number((parcela as any).valor), dataVencimento: (parcela as any).data_vencimento }
      : null,
  }
}

// Confirma o pagamento de uma parcela (mesmo fluxo do baixar com confirmação)
export async function renovarParcelaAction(parcelaId: string, cobrancaId: string): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const contaId = await resolverContaId(supabase, user.id)
  if (!contaId) return { error: 'Conta não encontrada.' }

  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const admin = createAdminClient()

  const { data: rpcData, error: rpcErr } = await admin.rpc('baixar_parcela', {
    p_parcela_id: parcelaId,
    p_conta_id:   contaId,
    p_hoje:       hoje,
  })

  if (rpcErr) {
    console.error('[renovarParcela] rpc', rpcErr)
    return { error: 'Não foi possível registrar o pagamento. Tente novamente.' }
  }

  const result = rpcData as { ok: boolean; cobranca_id?: string; conta_id?: string; recorrente?: boolean; cliente_id?: string }
  if (!result?.ok) return { error: 'Parcela não encontrada ou já paga.' }

  const contaIdFinal = result.conta_id as string
  const clienteId    = result.cliente_id as string | null

  // Notificação WhatsApp + LookDefense
  if (clienteId) {
    const { data: cfgPag } = await admin
      .from('notificacoes_config')
      .select('ativo_whatsapp, ativo_email')
      .eq('conta_id', contaIdFinal)
      .eq('tipo', 'pagamento_confirmado')
      .maybeSingle()

    const agora     = new Date().toISOString()
    const baseNotif = {
      conta_id:      contaIdFinal,
      parcela_id:    parcelaId,
      cobranca_id:   cobrancaId,
      cliente_id:    clienteId,
      tipo:          'pagamento_confirmado' as const,
      status:        'fila'                as const,
      agendado_para: agora,
    }

    if (cfgPag?.ativo_whatsapp) {
      const { data: notifWa, error: e } = await admin
        .from('notificacoes_enviadas')
        .insert({ ...baseNotif, canal: 'whatsapp' as const })
        .select('id').single()
      if (e) console.error('[renovarParcela] notif.whatsapp', e)
      else if (notifWa?.id) {
        await enviarWhatsAppImediato(contaIdFinal, notifWa.id, parcelaId, cobrancaId, clienteId, 'pagamento_confirmado')
      }
    }
    if (cfgPag?.ativo_email) {
      await admin.from('notificacoes_enviadas').insert({ ...baseNotif, canal: 'email' as const })
    }

    // LookDefense
    const { data: integ } = await admin
      .from('clientes')
      .select('login_externo, tipo_integracao')
      .eq('id', clienteId)
      .maybeSingle()

    if ((integ as any)?.login_externo && (integ as any)?.tipo_integracao) {
      const { data: baixaExt, error: baixaErr } = await admin.from('baixas_externas').insert({
        conta_id:        contaIdFinal,
        cliente_id:      clienteId,
        parcela_id:      parcelaId,
        login_externo:   (integ as any).login_externo,
        tipo_integracao: (integ as any).tipo_integracao,
      }).select('id').single()
      if (baixaErr) console.error('[renovarParcela] baixas_externas', baixaErr)
      else if ((baixaExt as any)?.id) {
        await renovarLookDefenseImediato(contaIdFinal, (baixaExt as any).id, (integ as any).login_externo, 0)
      }
    } else {
      console.info('[renovarParcela] cliente sem login_externo/tipo_integracao — LookDefense ignorado', clienteId)
    }
  }

  // Gerar próxima parcela se recorrente
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
        const ultima            = ultimaArr[0]
        const proximoVencimento = calcularVencimento(
          new Date((ultima.data_vencimento as string) + 'T12:00:00'),
          cob.dia_pagamento as number,
          1,
        ).toISOString().slice(0, 10)

        await supabase.from('parcelas').insert({
          conta_id:        contaIdFinal,
          cobranca_id:     cobrancaId,
          numero:          (ultima.numero as number) + 1,
          valor:           cob.valor_mensalidade,
          data_vencimento: proximoVencimento,
          status:          'aberta',
        })
      }
    }
  }

  return { error: null, success: true }
}
