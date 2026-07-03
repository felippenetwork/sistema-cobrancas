// Worker WhatsApp — anti-ban + resiliência integrados.
//
// Regras obrigatórias (notificacoes-fila §5):
//   • Janela 09:00–20:00 SP. Fora disso: overflow → dia seguinte às 09h.
//   • Intervalo 45–80s aleatório ENTRE contas (nunca em paralelo no mesmo número).
//   • Warmup 60s após conectar (hasSocket retorna false durante esse período).
//   • Simulação de digitação 7–9s dentro do enviarMensagem.
//   • Retry: até 2 tentativas com pausa de 5s antes de desistir.
//   • Socket caiu durante retry → reagenda (não descarta).
//   • Cliente deletado → cancela.
//   • Template vazio → falhou (config ausente, não deve silenciar).

import pino from 'pino'
import {
  dentroDaJanela,
  horaStr,
  TIPOS_SEM_JANELA,
  sleep,
  intervalAleatorio,
  hojeEmSP,
  addDias,
} from '../format.js'
import { resolverVariaveis } from '../variaveis.js'
import type { SupabaseAdmin } from '../supabase.js'
import type { UazapiManager } from '../uazapi-manager.js'
import { resolverVariaveisLeves } from '../variaveis.js'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' })

const MAX_RETRIES    = 2        // tentativas de envio por mensagem
const RETRY_DELAY_MS = 5_000   // pausa entre tentativas (ms)

type Notif = {
  id: string; conta_id: string
  parcela_id: string | null; cobranca_id: string | null; cliente_id: string; tipo: string
  mensagem_final: string | null
}

// ── Ponto de entrada — chamado a cada ciclo de 15s ───────────────────────────

export async function processarFilaWhatsApp(
  supabase: SupabaseAdmin,
  manager: UazapiManager,
) {
  const agora = new Date().toISOString()

  // Carrega candidatos: fila pendente, excluindo tipos imediatos (têm loop próprio)
  const { data: pendentes } = await supabase
    .from('notificacoes_enviadas')
    .select('id, conta_id, parcela_id, cobranca_id, cliente_id, tipo, mensagem_final')
    .eq('canal', 'whatsapp')
    .eq('status', 'fila')
    .not('tipo', 'in', '("pagamento_confirmado","boasvindas")')
    .lte('agendado_para', agora)
    .order('agendado_para', { ascending: true })
    .limit(30)

  if (!pendentes?.length) return

  // Uma mensagem por conta — nunca paralelo no mesmo número
  const porConta = new Map<string, Notif>()
  for (const n of pendentes) {
    const contaId = n.conta_id as string
    if (!porConta.has(contaId) && manager.hasSocket(contaId)) {
      porConta.set(contaId, n as Notif)
    }
  }

  if (!porConta.size) return

  // Carregar configurações de janela/intervalo por conta (1 query)
  const contaIds = [...porConta.keys()]
  const { data: configs } = await supabase
    .from('configuracoes')
    .select('conta_id, horario_inicio, horario_fim, intervalo_min_seg, intervalo_max_seg')
    .in('conta_id', contaIds)

  const cfgMap = new Map(
    (configs ?? []).map((c: any) => [c.conta_id as string, c]),
  )

  for (const [contaId, notif] of porConta) {
    const cfg        = cfgMap.get(contaId)
    const hInicio    = horaStr(cfg?.horario_inicio ?? '09:00')
    const hFim       = horaStr(cfg?.horario_fim    ?? '20:00')
    const intMin     = ((cfg?.intervalo_min_seg ?? 45) * 1_000)
    const intMax     = ((cfg?.intervalo_max_seg ?? 80) * 1_000)

    // Verificar janela por conta (tipos transacionais/manuais são isentos)
    if (!TIPOS_SEM_JANELA.has(notif.tipo) && !dentroDaJanela(hInicio, hFim)) {
      continue  // fora da janela desta conta — notif fica na fila para o próximo ciclo
    }

    await processarUmaNotificacao(supabase, manager, contaId, notif)

    // Anti-ban: intervalo configurável entre contas
    await sleep(intervalAleatorio(intMin, intMax))
  }
}

// ── Processar uma notificação com retry e fallback ───────────────────────────

async function processarUmaNotificacao(
  supabase: SupabaseAdmin,
  manager: UazapiManager,
  contaId: string,
  notif: Notif,
  semDigitacao = false,
) {
  // ── Desvio isolado: mensagem agendada avulsa (sem parcela/template) ──────
  if (notif.tipo === 'agendada') {
    await processarAgendada(supabase, manager, contaId, notif, semDigitacao)
    return
  }

  // ── 1. Buscar template ────────────────────────────────────────────────────
  const { data: cfg } = await supabase
    .from('notificacoes_config')
    .select('template_whatsapp')
    .eq('conta_id', contaId)
    .eq('tipo', notif.tipo)
    .maybeSingle()

  const template = (cfg as any)?.template_whatsapp?.trim()
  if (!template) {
    logger.warn({ notifId: notif.id, tipo: notif.tipo }, 'Template WhatsApp vazio — marcando como falhou')
    await marcarFalhou(supabase, notif.id)
    return
  }

  // ── 2. Buscar dados do cliente ────────────────────────────────────────────
  const { data: cliente } = await supabase
    .from('clientes')
    .select('celular, deleted_at')
    .eq('id', notif.cliente_id)
    .maybeSingle()

  if (!cliente) {
    logger.warn({ notifId: notif.id }, 'Cliente não encontrado — cancelando')
    await cancelarNotif(supabase, notif.id)
    return
  }

  if ((cliente as any).deleted_at) {
    logger.info({ notifId: notif.id }, 'Cliente deletado — cancelando notificação')
    await cancelarNotif(supabase, notif.id)
    return
  }

  const celular = (cliente as any).celular as string | null
  if (!celular) {
    logger.warn({ notifId: notif.id }, 'Celular ausente — marcando como falhou')
    await marcarFalhou(supabase, notif.id)
    return
  }

  // ── 3. Resolver ID da parcela para variáveis ──────────────────────────────
  // Para boasvindas, parcela_id é NULL — buscar 1ª parcela da cobrança
  let parcelaId = notif.parcela_id
  if (!parcelaId && notif.cobranca_id) {
    const { data: primeiraParc } = await supabase
      .from('parcelas')
      .select('id')
      .eq('cobranca_id', notif.cobranca_id)
      .order('numero', { ascending: true })
      .limit(1)
      .maybeSingle()
    parcelaId = (primeiraParc as any)?.id ?? null
  }

  if (!parcelaId) {
    logger.warn({ notifId: notif.id, tipo: notif.tipo }, 'Sem parcela para resolver variáveis — falhou')
    await marcarFalhou(supabase, notif.id)
    return
  }

  // ── 4. Resolver variáveis (#NOME#, #VALOR#, etc.) ────────────────────────
  let mensagem: string
  try {
    mensagem = await resolverVariaveis(supabase, {
      contaId,
      parcelaId,
      clienteId:   notif.cliente_id,
      template,
      cobrancaId:  notif.cobranca_id,
    })
  } catch (err) {
    logger.error({ notifId: notif.id, err }, 'Erro ao resolver variáveis — reagendando')
    await reagendar(supabase, notif.id)
    return
  }

  // ── 5. Enviar com retry ───────────────────────────────────────────────────
  let ultimoErro: unknown

  for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
    // Re-verificar socket a cada tentativa (pode ter caído entre uma e outra)
    if (!manager.hasSocket(contaId, semDigitacao)) {
      logger.warn({ notifId: notif.id, tentativa }, 'Socket indisponível — reagendando')
      await reagendar(supabase, notif.id)
      return
    }

    try {
      await manager.enviarMensagem(contaId, celular, mensagem, semDigitacao)

      const { error: updErr } = await supabase.from('notificacoes_enviadas').update({
        status:         'enviado',
        mensagem_final: mensagem,
        enviado_em:     new Date().toISOString(),
      }).eq('id', notif.id).eq('status', 'fila')
      if (updErr) logger.error({ contaId, notifId: notif.id, updErr }, 'WhatsApp: falha ao marcar enviado')

      logger.info({ contaId, notifId: notif.id, tentativa }, 'WhatsApp: enviado com sucesso')
      return  // ← sucesso, saída do loop

    } catch (err) {
      ultimoErro = err
      logger.warn({ contaId, notifId: notif.id, tentativa, err }, `Tentativa ${tentativa}/${MAX_RETRIES} falhou`)

      if (tentativa < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS)  // aguarda 5s antes de tentar de novo
      }
    }
  }

  // ── 6. Todas as tentativas falharam ──────────────────────────────────────
  logger.error({ contaId, notifId: notif.id, ultimoErro }, 'WhatsApp: todas as tentativas falharam')

  if (!dentroDaJanela()) {
    // Já saímos da janela — reagenda para amanhã às 09h (não descarta)
    await reagendar(supabase, notif.id)
  } else {
    // Falha dentro da janela (número inválido, bloqueado, etc.) → marca como falhou
    await marcarFalhou(supabase, notif.id)
  }
}

// ── Loop imediato: pagamento_confirmado e boasvindas — sem typing, poll a cada 3s ──
// Chamado em paralelo com processarFilaWhatsApp. Não aplica intervalo anti-ban
// entre contas pois são confirmações transacionais (não marketing).

export async function processarFilaImediata(
  supabase: SupabaseAdmin,
  manager: UazapiManager,
) {
  // Mensagens transacionais (confirmação de pagamento, boas-vindas) enviam a qualquer hora.
  // Não aplica janela 09-20h — o socket precisa estar disponível mas não há restrição de horário.

  const agora = new Date().toISOString()

  const { data: pendentes } = await supabase
    .from('notificacoes_enviadas')
    .select('id, conta_id, parcela_id, cobranca_id, cliente_id, tipo, mensagem_final')
    .eq('canal', 'whatsapp')
    .eq('status', 'fila')
    .in('tipo', ['pagamento_confirmado', 'boasvindas'])
    .lte('agendado_para', agora)
    .order('agendado_para', { ascending: true })
    .limit(10)

  if (!pendentes?.length) return

  const porConta = new Map<string, Notif>()
  for (const n of pendentes) {
    const contaId = n.conta_id as string
    if (!porConta.has(contaId) && manager.hasSocket(contaId, true)) {
      porConta.set(contaId, n as Notif)
    }
  }

  if (!porConta.size) return

  let i = 0
  for (const [contaId, notif] of porConta) {
    if (i++ > 0) await sleep(5_000)  // anti-ban: 5s entre contas (sem janela horária)
    await processarUmaNotificacao(supabase, manager, contaId, notif, true)
  }
}

// ── Mensagem agendada avulsa (sem parcela — caminho isolado) ─────────────────

async function processarAgendada(
  supabase: SupabaseAdmin,
  manager: UazapiManager,
  contaId: string,
  notif: Notif,
  semDigitacao: boolean,
) {
  const template = notif.mensagem_final?.trim()
  if (!template) {
    await marcarFalhou(supabase, notif.id)
    return
  }

  const { data: cliente } = await supabase
    .from('clientes')
    .select('celular, deleted_at')
    .eq('id', notif.cliente_id)
    .maybeSingle()

  if (!cliente) { await cancelarNotif(supabase, notif.id); return }
  if ((cliente as any).deleted_at) { await cancelarNotif(supabase, notif.id); return }

  const celular = (cliente as any).celular as string | null
  if (!celular) { await marcarFalhou(supabase, notif.id); return }

  const mensagem = await resolverVariaveisLeves(supabase, {
    contaId, clienteId: notif.cliente_id, template,
  })

  let ultimoErro: unknown
  for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
    if (!manager.hasSocket(contaId, semDigitacao)) {
      await reagendar(supabase, notif.id)
      return
    }
    try {
      await manager.enviarMensagem(contaId, celular, mensagem, semDigitacao)
      const { error: updErr } = await supabase.from('notificacoes_enviadas').update({
        status:         'enviado',
        mensagem_final: mensagem,
        enviado_em:     new Date().toISOString(),
      }).eq('id', notif.id).eq('status', 'fila')
      if (updErr) logger.error({ contaId, notifId: notif.id, updErr }, 'Agendada WA: falha ao marcar enviado')
      return
    } catch (err) {
      ultimoErro = err
      if (tentativa < MAX_RETRIES) await sleep(RETRY_DELAY_MS)
    }
  }

  logger.error({ contaId, notifId: notif.id, ultimoErro }, 'Agendada WA: todas as tentativas falharam')
  await marcarFalhou(supabase, notif.id)
}

// ── Helpers de estado ────────────────────────────────────────────────────────

async function reagendar(supabase: SupabaseAdmin, notifId: string) {
  const amanha = addDias(hojeEmSP(), 1)
  const { error } = await supabase
    .from('notificacoes_enviadas')
    .update({ agendado_para: new Date(`${amanha}T09:00:00-03:00`).toISOString() })
    .eq('id', notifId)
  if (error) logger.error({ notifId, error }, 'WA: falha ao reagendar')
  else logger.info({ notifId }, 'Reagendado para amanhã às 09h')
}

async function marcarFalhou(supabase: SupabaseAdmin, notifId: string) {
  const { error } = await supabase
    .from('notificacoes_enviadas')
    .update({ status: 'falhou' })
    .eq('id', notifId)
  if (error) logger.error({ notifId, error }, 'WA: falha ao marcar como falhou')
}

async function cancelarNotif(supabase: SupabaseAdmin, notifId: string) {
  const { error } = await supabase
    .from('notificacoes_enviadas')
    .update({ status: 'cancelado' })
    .eq('id', notifId)
  if (error) logger.error({ notifId, error }, 'WA: falha ao cancelar notif')
}
