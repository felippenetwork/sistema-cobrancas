// Baixa de parcela por PIX pago — comum a todos os provedores (EfiBank e Mercado Pago).
// Cada webhook localiza a cobrança PIX pelo seu jeito e chama baixarPixPago; a regra de dinheiro
// (RPC atômica, ordem, idempotência, próxima parcela recorrente) fica num lugar só.
//
// Ordem (PAG-N1, auditoria 2026-09-19): a baixa (RPC baixar_parcela, idempotente e atômica) roda
// ANTES de a cobrança PIX ser marcada como concluída. Antes era o contrário: se a RPC falhasse, a
// cobrança ficava "concluida" com a parcela em aberto, o webhook respondia 200 e o provedor nunca
// reenviava — cliente pagou, parcela aberta e lembretes seguindo. Falha transitória agora vira
// 'tentar_de_novo' (o webhook responde 5xx para o provedor reenviar).
import { createAdminClient } from '@/lib/supabase/admin'
import { calcularVencimento } from '@/lib/utils/parcelas'
import { enviarWhatsAppImediato } from '@/lib/whatsapp/enviar-imediato'
import type { PixProvedor } from './tipos'

type Supabase = ReturnType<typeof createAdminClient>

export type ResultadoPix = 'processado' | 'ignorado' | 'tentar_de_novo'

export type CobrancaPixParaBaixa = { id: string; conta_id: string; parcela_id: string; status: string }

// Retorno da RPC baixar_parcela (migration 0013).
type ResultadoBaixaParcela = {
  ok: boolean
  erro?: string
  parcela_id?: string
  cobranca_id?: string
  conta_id?: string
  recorrente?: boolean
  cliente_id?: string | null
}

export async function baixarPixPago(
  supabase: Supabase,
  cobPix: CobrancaPixParaBaixa,
  ctx: { origem: PixProvedor; txid: string },
): Promise<ResultadoPix> {
  const { txid } = ctx
  const log = `[webhook/${ctx.origem}]`

  if (cobPix.status === 'concluida') return 'ignorado'

  const contaId   = cobPix.conta_id
  const parcelaId = cobPix.parcela_id

  // Baixa a parcela via RPC — idempotente: se já estiver paga devolve ok:false.
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const { data: rpcData, error: rpcErr } = await supabase.rpc('baixar_parcela', {
    p_parcela_id: parcelaId,
    p_conta_id:   contaId,
    p_hoje:       hoje,
  })

  if (rpcErr) {
    console.error(`${log} baixar_parcela falhou — o provedor vai reenviar`, { txid, contaId, parcelaId, rpcErr })
    return 'tentar_de_novo'
  }

  const result = rpcData as ResultadoBaixaParcela | null

  if (!result?.ok) {
    // Não foi esta chamada que pagou a parcela: já estava paga (baixa manual ou entrega
    // repetida) ou não existe mais. Distinguir — só "já paga" encerra a cobrança PIX.
    const { data: parcela, error: parcelaErr } = await supabase
      .from('parcelas').select('status').eq('id', parcelaId).eq('conta_id', contaId).maybeSingle()

    if (parcelaErr) {
      console.error(`${log} leitura da parcela falhou`, { txid, parcelaId, parcelaErr })
      return 'tentar_de_novo'
    }
    if (parcela?.status === 'paga') {
      await marcarConcluida(supabase, cobPix.id, txid, log)
      return 'ignorado'
    }
    // Parcela inexistente (ou em estado que a RPC recusa): reenviar não resolve, precisa de
    // olhar humano — o dinheiro entrou no provedor mas não há parcela para baixar.
    console.error(`${log} PIX pago sem parcela para baixar — revisar manualmente`, { txid, contaId, parcelaId, result })
    return 'ignorado'
  }

  // Baixa feita. A partir daqui a cobrança PIX está encerrada; o efeito abaixo é durável por
  // conta própria (notificação em `fila` é reprocessada pelo cron), então um erro nele não pede
  // reenvio do webhook.
  await marcarConcluida(supabase, cobPix.id, txid, log)

  const contaIdFinal = result.conta_id    as string
  const cobrancaId   = result.cobranca_id as string
  const clienteId    = result.cliente_id ?? null

  const efeito = async (nome: string, fn: () => Promise<void>) => {
    try { await fn() } catch (err) { console.error(`${log} ${nome} falhou`, { txid, contaId: contaIdFinal, err }) }
  }

  // Próxima parcela recorrente ANTES da confirmação por WhatsApp: #VENCIMENTO# na mensagem usa a
  // próxima parcela em aberto da cobrança (ver resolverVariaveis), que precisa já existir quando a
  // mensagem é montada.
  if (result.recorrente) {
    await efeito('próxima parcela', () => gerarProximaParcela(supabase, { contaId: contaIdFinal, cobrancaId }, log))
  }

  if (clienteId) {
    await efeito('confirmação por WhatsApp', () => confirmarPorWhatsApp(supabase, { contaId: contaIdFinal, parcelaId, cobrancaId, clienteId }))
  }

  return 'processado'
}

async function marcarConcluida(supabase: Supabase, cobrancaPixId: string, txid: string, log: string) {
  const { error } = await supabase
    .from('cobrancas_pix')
    .update({ status: 'concluida', pago_em: new Date().toISOString() })
    .eq('id', cobrancaPixId)
  if (error) console.error(`${log} não conseguiu marcar cobrancas_pix como concluida`, { txid, cobrancaPixId, error })
}

async function confirmarPorWhatsApp(
  supabase: Supabase,
  { contaId, parcelaId, cobrancaId, clienteId }: { contaId: string; parcelaId: string; cobrancaId: string; clienteId: string },
) {
  const { data: cfgNotif } = await supabase
    .from('notificacoes_config')
    .select('ativo_whatsapp')
    .eq('conta_id', contaId)
    .eq('tipo', 'pagamento_confirmado')
    .maybeSingle()

  if (!cfgNotif?.ativo_whatsapp) return

  const { data: notif } = await supabase.from('notificacoes_enviadas').insert({
    conta_id:      contaId,
    parcela_id:    parcelaId,
    cobranca_id:   cobrancaId,
    cliente_id:    clienteId,
    tipo:          'pagamento_confirmado' as const,
    canal:         'whatsapp'             as const,
    status:        'fila'                 as const,
    agendado_para: new Date().toISOString(),
  }).select('id').single()

  if (notif?.id) {
    await enviarWhatsAppImediato(contaId, notif.id, parcelaId, cobrancaId, clienteId, 'pagamento_confirmado')
  }
}

// Gera a próxima parcela de cobrança recorrente quando não sobrou nenhuma aberta (RN-C1: uma
// recorrente nunca tem mais de 1 parcela aberta — ver skill regras-financeiras §2.2).
async function gerarProximaParcela(
  supabase: Supabase,
  { contaId, cobrancaId }: { contaId: string; cobrancaId: string },
  log: string,
) {
  const { data: cob } = await supabase
    .from('cobrancas')
    .select('dia_pagamento, valor_mensalidade')
    .eq('id', cobrancaId)
    .eq('conta_id', contaId)
    .maybeSingle()
  if (!cob) return

  const { count: abertas } = await supabase
    .from('parcelas')
    .select('*', { count: 'exact', head: true })
    .eq('cobranca_id', cobrancaId)
    .eq('conta_id', contaId)
    .eq('status', 'aberta')
  if ((abertas ?? 0) > 0) return

  const { data: ultimas } = await supabase
    .from('parcelas')
    .select('numero, data_vencimento')
    .eq('cobranca_id', cobrancaId)
    .eq('conta_id', contaId)
    .order('numero', { ascending: false })
    .limit(1)
  const ultima = ultimas?.[0]
  if (!ultima) return

  const proximoVencimento = calcularVencimento(
    new Date(ultima.data_vencimento + 'T12:00:00'),
    cob.dia_pagamento,
    1,
  ).toISOString().slice(0, 10)

  const { error } = await supabase.from('parcelas').insert({
    conta_id:        contaId,
    cobranca_id:     cobrancaId,
    numero:          ultima.numero + 1,
    valor:           cob.valor_mensalidade,
    data_vencimento: proximoVencimento,
    status:          'aberta',
  })
  if (error) console.error(`${log} inserir próxima parcela falhou`, { contaId, cobrancaId, error })
}
