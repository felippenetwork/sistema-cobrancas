// Cron: dispara lembretes WhatsApp (5d, 3d, 2d, 1d, dia, vencido, boasvindas,
// pagamento_confirmado, manual, agendada) para contas conectadas via uazapi
// (não Meta Cloud API — essas continuam em /api/cron/whatsapp).
//
// Substitui o antigo worker na Vortexus (worker/src/workers/whatsapp-worker.ts
// + uazapi-manager.ts), que parou de rodar e deixava a fila uazapi travada
// para sempre. Mesmo padrão do ERP-Rifas (src/app/api/cron/disparo): chamado
// a cada minuto por um cron externo (cron-job.org), fica "acordado" dentro de
// uma única execução dando sleep() de verdade entre envios — é isso que
// garante o ritmo 45-80s exigido pela skill baileys-conexao (não um "1
// envio por tick"). O que não couber no orçamento desta execução continua no
// próximo tick, 1 minuto depois.
//
// Também sincroniza o status de conexão (conexoes.status) de TODAS as contas
// com uma única chamada leve à uazapi — substitui o sincronizarConexoes() do
// worker antigo, essencial para o badge "WhatsApp desconectado" da Dashboard
// continuar refletindo a realidade sem ninguém rodando 24/7.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encontrarOuCriarAtendimento } from '@/lib/atendimento/encontrar-ou-criar'
import { resolverVariaveis, resolverVariaveisLeves } from '@/lib/whatsapp/resolver-variaveis'
import {
  instName,
  getAllInstances,
  sendText,
  sendPresence,
  UazapiRateLimitError,
  type UazapiInstanceListItem,
} from '@/lib/uazapi'

export const maxDuration = 300

const CRON_SECRET  = process.env.CRON_SECRET
const BUDGET_MS     = 270_000 // margem sob maxDuration=300 para a sincronização + resposta

// Simulação de digitação/abertura de chat antes de QUALQUER envio automático
// (lembrete ou campanha) — pedido do dono do projeto: comportamento humano
// mínimo, além do intervalo 45-80s já exigido entre mensagens.
function delayDigitacaoMs(): number {
  return 15_000 + Math.floor(Math.random() * 5_000) // 15-20s
}

async function simularDigitacao(token: string, celular: string): Promise<void> {
  const ms = delayDigitacaoMs()
  await sendPresence(token, celular, ms)
  await sleep(ms)
}

// Tipos que ignoram a janela horária (transacionais, não "cobrança fria")
const TIPOS_SEM_JANELA = new Set(['pagamento_confirmado', 'boasvindas', 'manual', 'agendada'])

type Supabase = ReturnType<typeof createAdminClient>

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function intervalAleatorioMs(minSegundos: number, maxSegundos: number): number {
  const min = minSegundos * 1000
  const max = Math.max(maxSegundos * 1000, min)
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// Compara em minutos reais de Brasília — comparar getHours() cru mandaria
// mensagem fora de hora sempre que o servidor rodar em outro fuso (UTC na Vercel).
function dentroDaJanela(horarioInicio = '09:00', horarioFim = '20:00'): boolean {
  const agora   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const minutos = agora.getHours() * 60 + agora.getMinutes()
  const [hI, mI] = horarioInicio.split(':').map(Number)
  const [hF, mF] = horarioFim.split(':').map(Number)
  return minutos >= hI * 60 + mI && minutos < hF * 60 + mF
}

// ── Sincronização de status de conexão — todas as contas, 1 chamada à uazapi ──

async function sincronizarConexoes(supabase: Supabase, instances: UazapiInstanceListItem[]) {
  const { data: conexoes } = await supabase
    .from('conexoes')
    .select('conta_id, status, uazapi_instance_token')

  if (!conexoes?.length) return

  const porNome = new Map(instances.map(i => [i.name, i]))

  for (const row of conexoes) {
    const inst = porNome.get(instName(row.conta_id as string))

    if (!inst) {
      if (row.status === 'conectado' || row.status === 'conectando') {
        await supabase.from('conexoes').update({
          status: 'desconectado', qr_code: null, numero_conectado: null, device_name: null,
          rate_limitado: false, desconectado_em: new Date().toISOString(),
        }).eq('conta_id', row.conta_id as string)
      }
      continue
    }

    if (inst.status === 'connected') {
      if (row.status !== 'conectado' || row.uazapi_instance_token !== inst.token) {
        const phone = inst.owner ? inst.owner.replace('@s.whatsapp.net', '').replace(/\D/g, '') : null
        await supabase.from('conexoes').update({
          status: 'conectado', qr_code: null, numero_conectado: phone,
          rate_limitado: false, ultima_conexao: new Date().toISOString(),
          uazapi_instance_token: inst.token,
        }).eq('conta_id', row.conta_id as string)
      }
    } else if (inst.status === 'connecting' && inst.qrcode) {
      if (row.status !== 'conectando') {
        await supabase.from('conexoes')
          .update({ status: 'conectando', qr_code: inst.qrcode, rate_limitado: false })
          .eq('conta_id', row.conta_id as string)
      }
    } else if (row.status === 'conectado') {
      // uazapi não reporta mais conectado, banco ainda acha que sim — a conexão caiu de verdade.
      await supabase.from('conexoes').update({
        status: 'desconectado', qr_code: null, numero_conectado: null, device_name: null,
        rate_limitado: false, desconectado_em: new Date().toISOString(),
      }).eq('conta_id', row.conta_id as string)
    }
  }
}

// ── Envio de uma notificação ──────────────────────────────────────────────────

type Notif = {
  id: string
  parcela_id: string | null
  cobranca_id: string | null
  cliente_id: string
  tipo: string
  mensagem_final: string | null
}

async function enviarNotificacao(
  supabase: Supabase,
  contaId: string,
  token: string,
  notif: Notif,
): Promise<'enviado' | 'falhou' | 'cancelado' | 'rate_limited'> {
  const { data: cliente } = await supabase
    .from('clientes').select('celular, deleted_at').eq('id', notif.cliente_id).maybeSingle()

  if (!cliente || cliente.deleted_at) {
    await supabase.from('notificacoes_enviadas').update({ status: 'cancelado' }).eq('id', notif.id)
    return 'cancelado'
  }
  const celular = cliente.celular as string | null
  if (!celular) {
    await supabase.from('notificacoes_enviadas').update({ status: 'falhou' }).eq('id', notif.id)
    return 'falhou'
  }

  let mensagem: string

  if (notif.tipo === 'agendada') {
    const template = (notif.mensagem_final ?? '').trim()
    if (!template) {
      await supabase.from('notificacoes_enviadas').update({ status: 'falhou' }).eq('id', notif.id)
      return 'falhou'
    }
    mensagem = await resolverVariaveisLeves(supabase, { contaId, clienteId: notif.cliente_id, template })
  } else {
    const { data: cfgNotif } = await supabase
      .from('notificacoes_config')
      .select('template_whatsapp')
      .eq('conta_id', contaId)
      .eq('tipo', notif.tipo as any)
      .maybeSingle()

    const template = cfgNotif?.template_whatsapp?.trim()
    if (!template) {
      await supabase.from('notificacoes_enviadas').update({ status: 'falhou' }).eq('id', notif.id)
      return 'falhou'
    }

    let parcelaId = notif.parcela_id
    if (!parcelaId && notif.cobranca_id) {
      const { data: p } = await supabase
        .from('parcelas').select('id')
        .eq('cobranca_id', notif.cobranca_id)
        .order('numero', { ascending: true }).limit(1).maybeSingle()
      parcelaId = p?.id ?? null
    }
    if (!parcelaId) {
      await supabase.from('notificacoes_enviadas').update({ status: 'falhou' }).eq('id', notif.id)
      return 'falhou'
    }

    mensagem = await resolverVariaveis(supabase, {
      contaId, parcelaId, clienteId: notif.cliente_id, template, cobrancaId: notif.cobranca_id,
    })
  }

  try {
    await simularDigitacao(token, celular)
    await sendText(token, celular, mensagem)
  } catch (err) {
    if (err instanceof UazapiRateLimitError) {
      // Devolve para a fila — não foi recusa de verdade, só limitação transitória.
      await supabase.from('notificacoes_enviadas').update({ status: 'fila' }).eq('id', notif.id)
      return 'rate_limited'
    }
    console.error('[cron/whatsapp-uazapi] envio falhou', notif.id, err)
    await supabase.from('notificacoes_enviadas').update({ status: 'falhou' }).eq('id', notif.id)
    return 'falhou'
  }

  const agora = new Date().toISOString()
  await supabase.from('notificacoes_enviadas').update({
    status: 'enviado', mensagem_final: mensagem, enviado_em: agora,
  }).eq('id', notif.id)

  // Mesmo tratamento do cron Meta (/api/cron/whatsapp): garante que a mensagem
  // enviada aparece no histórico de Atendimento, não só no Log.
  const atendimentoId = await encontrarOuCriarAtendimento(supabase, contaId, celular, notif.cliente_id, mensagem)
  const { error: mwaErr } = await supabase.from('mensagens_wa').insert({
    conta_id: contaId, cliente_id: notif.cliente_id, atendimento_id: atendimentoId,
    celular, direcao: 'out', texto: mensagem, lida: true,
  })
  if (mwaErr) console.error('[cron/whatsapp-uazapi] mensagens_wa.insert', mwaErr)

  return 'enviado'
}

// ── Processa a fila de 1 conta até: esvaziar, sair da janela, bater rate
// limit, ou o orçamento desta execução acabar (continua no próximo tick) ──────

type ContaCfg = {
  horario_inicio?: string | null
  horario_fim?: string | null
  intervalo_min_seg?: number | null
  intervalo_max_seg?: number | null
} | undefined

async function processarConta(
  supabase: Supabase,
  contaId: string,
  token: string,
  cfg: ContaCfg,
  inicioExecucao: number,
  budgetMs: number,
): Promise<number> {
  const hInicio = cfg?.horario_inicio ?? '09:00'
  const hFim    = cfg?.horario_fim    ?? '20:00'
  const intMin  = cfg?.intervalo_min_seg ?? 45
  const intMax  = cfg?.intervalo_max_seg ?? 80

  let enviados = 0

  while (Date.now() - inicioExecucao < budgetMs) {
    const agora = new Date().toISOString()

    const { data: pendentes } = await supabase
      .from('notificacoes_enviadas')
      .select('id, parcela_id, cobranca_id, cliente_id, tipo, mensagem_final')
      .eq('conta_id', contaId)
      .eq('canal', 'whatsapp')
      .eq('status', 'fila')
      .lte('agendado_para', agora)
      .order('agendado_para', { ascending: true })
      .limit(1)

    const notif = pendentes?.[0] as Notif | undefined
    if (!notif) break

    if (!TIPOS_SEM_JANELA.has(notif.tipo) && !dentroDaJanela(hInicio, hFim)) break

    // Claim atômico — protege contra 2 execuções do cron externo se sobrepondo
    // (mesmo padrão já usado por /api/cron/whatsapp e forcarEnvioAction).
    const { data: claimed } = await supabase
      .from('notificacoes_enviadas')
      .update({ status: 'processando' })
      .eq('id', notif.id)
      .eq('status', 'fila')
      .select('id')
      .maybeSingle()
    if (!claimed) continue // outra execução já levou esta notificação

    const resultado = await enviarNotificacao(supabase, contaId, token, notif)
    if (resultado === 'enviado') enviados++
    if (resultado === 'rate_limited') break // não insiste nesta conta neste tick

    // Ritmo anti-ban: pausa real entre envios, mesmo depois de falha/cancelamento
    // (um "não enviou" ainda conta como 1 tentativa de contato pra quem observa de fora).
    await sleep(intervalAleatorioMs(intMin, intMax))
  }

  // Campanha de disparo em massa (/disparos), se houver uma ativa — mesmo
  // orçamento de tempo restante desta execução, não um adicional.
  enviados += await processarCampanha(supabase, contaId, token, cfg, inicioExecucao, budgetMs)

  return enviados
}

// ── Drena a campanha de disparo em massa (/disparos) ativa da conta, se houver.
// Mesmo ritmo (intervalo + digitação) e mesma lógica de orçamento/janela dos
// lembretes — substitui o loop síncrono que existia em enviarCampanhaAction,
// que estourava o tempo de execução da Vercel com o ritmo anti-ban correto. ──

async function processarCampanha(
  supabase: Supabase,
  contaId: string,
  token: string,
  cfg: ContaCfg,
  inicioExecucao: number,
  budgetMs: number,
): Promise<number> {
  const hInicio = cfg?.horario_inicio ?? '09:00'
  const hFim    = cfg?.horario_fim    ?? '20:00'
  const intMin  = cfg?.intervalo_min_seg ?? 45
  const intMax  = cfg?.intervalo_max_seg ?? 80

  const { data: campanha } = await supabase
    .from('campanhas_wa')
    .select('id, modelos_wa(corpo)')
    .eq('conta_id', contaId)
    .eq('status', 'enviando')
    .order('iniciado_em', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!campanha) return 0

  const corpo = (campanha as any).modelos_wa?.corpo as string | undefined
  if (!corpo) return 0

  let enviados = 0

  while (Date.now() - inicioExecucao < budgetMs) {
    if (!dentroDaJanela(hInicio, hFim)) break

    const { data: pendentes } = await supabase
      .from('campanha_destinatarios')
      .select('id, celular, variaveis')
      .eq('campanha_id', campanha.id)
      .eq('status', 'pendente')
      .limit(1)

    const dest = pendentes?.[0]

    if (!dest) {
      // Fila esgotada — fecha a campanha e consolida os totais.
      const [{ count: totalEnviados }, { count: totalFalhas }] = await Promise.all([
        supabase.from('campanha_destinatarios').select('id', { count: 'exact', head: true })
          .eq('campanha_id', campanha.id).eq('status', 'enviado'),
        supabase.from('campanha_destinatarios').select('id', { count: 'exact', head: true })
          .eq('campanha_id', campanha.id).eq('status', 'falhou'),
      ])
      await supabase.from('campanhas_wa').update({
        status: 'concluida', concluido_em: new Date().toISOString(),
        total_enviados: totalEnviados ?? 0, total_falhas: totalFalhas ?? 0,
      }).eq('id', campanha.id).eq('status', 'enviando')
      break
    }

    // Claim atômico: marca 'enviado' ANTES de mandar, reverte se der erro —
    // status da tabela não tem um estado "processando" intermediário.
    const { data: claimed } = await supabase
      .from('campanha_destinatarios')
      .update({ status: 'enviado', enviado_em: new Date().toISOString() })
      .eq('id', dest.id)
      .eq('status', 'pendente')
      .select('id')
      .maybeSingle()
    if (!claimed) continue // outra execução já levou este destinatário

    const celular = dest.celular as string
    let texto = corpo
    const vars = (dest.variaveis as string[] | null) ?? []
    vars.forEach((v, i) => { texto = texto.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), v) })

    try {
      await simularDigitacao(token, celular)
      await sendText(token, celular, texto)
      enviados++
    } catch (err) {
      if (err instanceof UazapiRateLimitError) {
        // Não foi recusa — devolve pra pendente e para nesta conta neste tick.
        await supabase.from('campanha_destinatarios')
          .update({ status: 'pendente', enviado_em: null }).eq('id', dest.id)
        break
      }
      await supabase.from('campanha_destinatarios')
        .update({ status: 'falhou', erro: String(err).slice(0, 500) })
        .eq('id', dest.id)
    }

    await sleep(intervalAleatorioMs(intMin, intMax))
  }

  return enviados
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!CRON_SECRET || req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase        = createAdminClient()
  const inicioExecucao   = Date.now()

  // 1. Sincroniza status de conexão de todas as contas (1 chamada leve à uazapi).
  try {
    const instances = await getAllInstances()
    await sincronizarConexoes(supabase, instances)
  } catch (err) {
    if (!(err instanceof UazapiRateLimitError)) console.error('[cron/whatsapp-uazapi] sincronização falhou', err)
    // Rate limit ou erro de rede na sincronização não impede tentar enviar
    // com o que já está gravado no banco desta última vez que funcionou.
  }

  // 2. Contas conectadas via uazapi, sem Meta Cloud API ativa (essas vão por /api/cron/whatsapp).
  const { data: conectadas } = await supabase
    .from('conexoes')
    .select('conta_id, uazapi_instance_token')
    .eq('status', 'conectado')
    .not('uazapi_instance_token', 'is', null)

  if (!conectadas?.length) return NextResponse.json({ ok: true, enviadas: 0 })

  const contaIds = conectadas.map(c => c.conta_id as string)
  const { data: configs } = await supabase
    .from('configuracoes')
    .select('conta_id, horario_inicio, horario_fim, intervalo_min_seg, intervalo_max_seg, meta_api_ativo, meta_access_token, meta_phone_number_id')
    .in('conta_id', contaIds)

  const cfgMap = new Map((configs ?? []).map(c => [c.conta_id as string, c]))

  const elegiveis = conectadas.filter(c => {
    const cfg     = cfgMap.get(c.conta_id as string)
    const hasMeta = !!(cfg?.meta_api_ativo && cfg.meta_access_token && cfg.meta_phone_number_id)
    return !hasMeta
  })

  const resultados = await Promise.allSettled(
    elegiveis.map(c => processarConta(
      supabase,
      c.conta_id as string,
      c.uazapi_instance_token as string,
      cfgMap.get(c.conta_id as string),
      inicioExecucao,
      BUDGET_MS,
    )),
  )

  const enviadas = resultados.reduce((soma, r) => soma + (r.status === 'fulfilled' ? r.value : 0), 0)

  return NextResponse.json({ ok: true, enviadas, contasProcessadas: elegiveis.length })
}
