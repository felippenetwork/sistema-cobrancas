// Webhook EfiBanK — recebe notificação de PIX pago e confirma a parcela.
//
// Ordem (PAG-N1, auditoria 2026-09-19): a baixa (RPC baixar_parcela, idempotente e
// atômica) roda ANTES de a cobrança PIX ser marcada como concluída. Antes era o
// contrário: se a RPC falhasse, a cobrança ficava "concluida" com a parcela em aberto,
// o webhook respondia 200 e a EfiBank nunca reenviava — cliente pagou, parcela aberta
// e lembretes seguindo. Falha transitória agora responde 500 para a EfiBank reenviar.
import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcularVencimento } from '@/lib/utils/parcelas'
import { enviarWhatsAppImediato } from '@/lib/whatsapp/enviar-imediato'
import { renovarLookDefenseImediato } from '@/lib/lookdefense/renovar-imediato'

type Supabase = ReturnType<typeof createAdminClient>

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

type ResultadoPix = 'processado' | 'ignorado' | 'tentar_de_novo'

// EFIBANK_WEBHOOK_SECRET é o segredo próprio deste webhook. Sem ele cai no CRON_SECRET
// (legado) — o token vai na URL cadastrada na EfiBank e aparece em logs de acesso, então
// um segredo dedicado evita que esse vazamento comprometa também os crons internos.
function tokenValido(recebido: string | null): boolean {
  const esperado = process.env.EFIBANK_WEBHOOK_SECRET || process.env.CRON_SECRET
  if (!esperado || !recebido) return false
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!tokenValido(req.nextUrl.searchParams.get('token'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: { pix?: { txid?: string }[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const pixList = body?.pix ?? []
  if (!pixList.length) return NextResponse.json({ ok: true })

  const supabase = createAdminClient()
  let tentarDeNovo = false

  for (const pix of pixList) {
    if (!pix.txid) continue
    try {
      if (await processarPix(supabase, pix.txid) === 'tentar_de_novo') tentarDeNovo = true
    } catch (err) {
      console.error('[webhook/efibank] erro inesperado', { txid: pix.txid, err })
      tentarDeNovo = true
    }
  }

  // 5xx faz a EfiBank reenviar a notificação; a baixa é idempotente, reenviar é seguro.
  return tentarDeNovo
    ? NextResponse.json({ ok: false }, { status: 500 })
    : NextResponse.json({ ok: true })
}

async function processarPix(supabase: Supabase, txid: string): Promise<ResultadoPix> {
  // Localiza a cobrança PIX pelo txid
  const { data: cobPix, error: cobPixErr } = await supabase
    .from('cobrancas_pix')
    .select('id, conta_id, parcela_id, status')
    .eq('txid', txid)
    .maybeSingle()

  if (cobPixErr) {
    console.error('[webhook/efibank] leitura de cobrancas_pix falhou', { txid, cobPixErr })
    return 'tentar_de_novo'
  }
  if (!cobPix) { console.warn('[webhook/efibank] txid não encontrado:', txid); return 'ignorado' }
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
    console.error('[webhook/efibank] baixar_parcela falhou — a EfiBank vai reenviar', { txid, contaId, parcelaId, rpcErr })
    return 'tentar_de_novo'
  }

  const result = rpcData as ResultadoBaixaParcela | null

  if (!result?.ok) {
    // Não foi esta chamada que pagou a parcela: já estava paga (baixa manual ou entrega
    // repetida) ou não existe mais. Distinguir — só "já paga" encerra a cobrança PIX.
    const { data: parcela, error: parcelaErr } = await supabase
      .from('parcelas').select('status').eq('id', parcelaId).eq('conta_id', contaId).maybeSingle()

    if (parcelaErr) {
      console.error('[webhook/efibank] leitura da parcela falhou', { txid, parcelaId, parcelaErr })
      return 'tentar_de_novo'
    }
    if (parcela?.status === 'paga') {
      await marcarConcluida(supabase, cobPix.id, txid)
      return 'ignorado'
    }
    // Parcela inexistente (ou em estado que a RPC recusa): reenviar não resolve, precisa de
    // olhar humano — o dinheiro entrou na EfiBank mas não há parcela para baixar.
    console.error('[webhook/efibank] PIX pago sem parcela para baixar — revisar manualmente', { txid, contaId, parcelaId, result })
    return 'ignorado'
  }

  // Baixa feita. A partir daqui a cobrança PIX está encerrada; os efeitos abaixo são
  // duráveis por conta própria (notificação em `fila` e `baixas_externas` pendente são
  // reprocessadas pelos crons), então um erro neles não pede reenvio do webhook.
  await marcarConcluida(supabase, cobPix.id, txid)

  const contaIdFinal = result.conta_id    as string
  const cobrancaId   = result.cobranca_id as string
  const clienteId    = result.cliente_id ?? null

  const efeito = async (nome: string, fn: () => Promise<void>) => {
    try { await fn() } catch (err) { console.error(`[webhook/efibank] ${nome} falhou`, { txid, contaId: contaIdFinal, err }) }
  }

  if (clienteId) {
    await efeito('confirmação por WhatsApp', () => confirmarPorWhatsApp(supabase, { contaId: contaIdFinal, parcelaId, cobrancaId, clienteId }))
    await efeito('renovação LookDefense', () => renovarLookDefense(supabase, { contaId: contaIdFinal, parcelaId, clienteId }))
  }

  if (result.recorrente) {
    await efeito('próxima parcela', () => gerarProximaParcela(supabase, { contaId: contaIdFinal, cobrancaId }))
  }

  return 'processado'
}

async function marcarConcluida(supabase: Supabase, cobrancaPixId: string, txid: string) {
  const { error } = await supabase
    .from('cobrancas_pix')
    .update({ status: 'concluida', pago_em: new Date().toISOString() })
    .eq('id', cobrancaPixId)
  if (error) console.error('[webhook/efibank] não conseguiu marcar cobrancas_pix como concluida', { txid, cobrancaPixId, error })
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

async function renovarLookDefense(
  supabase: Supabase,
  { contaId, parcelaId, clienteId }: { contaId: string; parcelaId: string; clienteId: string },
) {
  const { data: cli } = await supabase
    .from('clientes')
    .select('login_externo, tipo_integracao')
    .eq('id', clienteId)
    .eq('conta_id', contaId)
    .maybeSingle()

  if (!cli?.login_externo || !cli.tipo_integracao) return

  const { data: baixaExt } = await supabase.from('baixas_externas').insert({
    conta_id:        contaId,
    cliente_id:      clienteId,
    parcela_id:      parcelaId,
    login_externo:   cli.login_externo,
    tipo_integracao: cli.tipo_integracao,
  }).select('id').single()

  if (baixaExt?.id) {
    await renovarLookDefenseImediato(contaId, baixaExt.id, cli.login_externo, 0)
  }
}

// Gera a próxima parcela de cobrança recorrente quando não sobrou nenhuma aberta.
// (Comportamento preservado — a decisão sobre gerar na baixa ou por data está pendente,
// ver RN-C1 em docs/auditoria-2026-09-19.md.)
async function gerarProximaParcela(
  supabase: Supabase,
  { contaId, cobrancaId }: { contaId: string; cobrancaId: string },
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
  if (error) console.error('[webhook/efibank] inserir próxima parcela falhou', { contaId, cobrancaId, error })
}
