// Worker WhatsApp — anti-ban + resiliência integrados.
//
// Regras obrigatórias (notificacoes-fila §5):
//   • Janela 09:00–20:00 SP. Fora disso: overflow → dia seguinte às 09h.
//   • Intervalo 45–80s aleatório ENTRE contas (Baileys apenas — Meta Cloud API é oficial).
//   • Warmup 60s após conectar (hasSocket retorna false durante esse período) — Baileys apenas.
//   • Simulação de digitação 7–9s dentro do enviarMensagem — Baileys apenas.
//   • Meta Cloud API: usa templates pré-aprovados para mensagens proativas.
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

// Mapeamento: tipo de notificação → template Meta aprovado
const META_TEMPLATE_MAP: Record<string, { nome: string; idioma: string; params: 2 | 3 }> = {
  '5d':                   { nome: 'cobranca_5d',          idioma: 'pt_BR', params: 3 },
  '3d':                   { nome: 'cobranca_3d',          idioma: 'en',    params: 3 },
  '2d':                   { nome: 'cobranca_2d',          idioma: 'pt_BR', params: 3 },
  '1d':                   { nome: 'cobranca_1d',          idioma: 'pt_BR', params: 3 },
  'dia':                  { nome: 'cobranca_dia',         idioma: 'pt_BR', params: 3 },
  'vencido1d':            { nome: 'cobranca_vencido',     idioma: 'pt_BR', params: 3 },
  'pagamento_confirmado': { nome: 'pagamento_confirmado', idioma: 'pt_BR', params: 2 },
  'boasvindas':           { nome: 'boasvindas',           idioma: 'pt_BR', params: 3 },
}

type Notif = {
  id: string; conta_id: string
  parcela_id: string | null; cobranca_id: string | null; cliente_id: string; tipo: string
  mensagem_final: string | null
}

type ContaCfg = {
  conta_id: string
  horario_inicio?: string | null
  horario_fim?: string | null
  intervalo_min_seg?: number | null
  intervalo_max_seg?: number | null
  meta_api_ativo?: boolean | null
  meta_access_token?: string | null
  meta_phone_number_id?: string | null
}

type MetaCfg = { token: string; phoneNumberId: string }

// ── Parâmetros para templates Meta (nome, valor formatado, data formatada) ────

async function resolverParamsTemplate(
  supabase: SupabaseAdmin,
  clienteId: string,
  parcelaId: string | null,
): Promise<{ nome: string; valor: string; data: string } | null> {
  const { data: cliente } = await supabase
    .from('clientes')
    .select('nome')
    .eq('id', clienteId)
    .maybeSingle()

  if (!cliente) return null
  const nome = ((cliente as any).nome as string) || 'Cliente'

  if (!parcelaId) return { nome, valor: '', data: '' }

  const { data: parcela } = await supabase
    .from('parcelas')
    .select('valor, data_vencimento')
    .eq('id', parcelaId)
    .maybeSingle()

  if (!parcela) return { nome, valor: '', data: '' }

  const valor = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(Number((parcela as any).valor ?? 0))

  const dataVenc  = ((parcela as any).data_vencimento as string) ?? ''
  const [ano, mes, dia] = dataVenc.split('-')
  const data = dia && mes && ano ? `${dia}/${mes}/${ano}` : dataVenc

  return { nome, valor, data }
}

// ── Envio via Meta Cloud API — template pré-aprovado ─────────────────────────

async function enviarViaMetaTemplate(
  meta: MetaCfg,
  celular: string,
  templateNome: string,
  templateIdioma: string,
  parametros: string[],
): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${meta.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${meta.token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:                celular,
        type:              'template',
        template: {
          name:     templateNome,
          language: { code: templateIdioma },
          components: [{
            type:       'body',
            parameters: parametros.map(text => ({ type: 'text', text })),
          }],
        },
      }),
    },
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any)?.error?.message ?? `Meta template erro ${res.status}`)
  }
}

// ── Envio via Meta Cloud API — texto livre (só funciona dentro da janela 24h) ─

async function enviarViaMetaTexto(meta: MetaCfg, celular: string, mensagem: string): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${meta.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${meta.token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to:                celular,
        type:              'text',
        text:              { preview_url: false, body: mensagem },
      }),
    },
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any)?.error?.message ?? `Meta API erro ${res.status}`)
  }
}

function extrairMetaCfg(cfg?: ContaCfg): MetaCfg | null {
  if (!cfg?.meta_api_ativo || !cfg.meta_access_token || !cfg.meta_phone_number_id) return null
  return { token: cfg.meta_access_token, phoneNumberId: cfg.meta_phone_number_id }
}

// ── Ponto de entrada — chamado a cada ciclo de 15s ───────────────────────────

export async function processarFilaWhatsApp(
  supabase: SupabaseAdmin,
  manager: UazapiManager,
) {
  const agora = new Date().toISOString()

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

  const todosContaIds = [...new Set(pendentes.map(n => n.conta_id as string))]
  const { data: configs } = await supabase
    .from('configuracoes')
    .select('conta_id, horario_inicio, horario_fim, intervalo_min_seg, intervalo_max_seg, meta_api_ativo, meta_access_token, meta_phone_number_id')
    .in('conta_id', todosContaIds)

  const cfgMap = new Map<string, ContaCfg>(
    (configs ?? []).map((c: any) => [c.conta_id as string, c as ContaCfg]),
  )

  const porConta = new Map<string, Notif>()
  for (const n of pendentes) {
    const contaId = n.conta_id as string
    if (porConta.has(contaId)) continue

    const cfg     = cfgMap.get(contaId)
    const hasMeta = !!(cfg?.meta_api_ativo && cfg.meta_access_token && cfg.meta_phone_number_id)

    if (hasMeta || manager.hasSocket(contaId)) {
      porConta.set(contaId, n as Notif)
    }
  }

  if (!porConta.size) return

  for (const [contaId, notif] of porConta) {
    const cfg     = cfgMap.get(contaId)
    const hasMeta = !!(cfg?.meta_api_ativo && cfg?.meta_access_token && cfg?.meta_phone_number_id)
    const hInicio = horaStr(cfg?.horario_inicio ?? '09:00')
    const hFim    = horaStr(cfg?.horario_fim    ?? '20:00')
    const intMin  = ((cfg?.intervalo_min_seg ?? 45) * 1_000)
    const intMax  = ((cfg?.intervalo_max_seg ?? 80) * 1_000)

    if (!TIPOS_SEM_JANELA.has(notif.tipo) && !dentroDaJanela(hInicio, hFim)) {
      continue
    }

    await processarUmaNotificacao(supabase, manager, contaId, notif, false, cfg)

    if (!hasMeta) {
      await sleep(intervalAleatorio(intMin, intMax))
    }
  }
}

// ── Processar uma notificação com retry e fallback ───────────────────────────

async function processarUmaNotificacao(
  supabase: SupabaseAdmin,
  manager: UazapiManager,
  contaId: string,
  notif: Notif,
  semDigitacao = false,
  contaCfg?: ContaCfg,
) {
  if (notif.tipo === 'agendada') {
    await processarAgendada(supabase, manager, contaId, notif, semDigitacao, contaCfg)
    return
  }

  const metaCfg = extrairMetaCfg(contaCfg)

  // ── Caminho Meta Cloud API ────────────────────────────────────────────────
  if (metaCfg) {
    await processarUmaNotificacaoMeta(supabase, metaCfg, contaId, notif)
    return
  }

  // ── Caminho Baileys (uazapi) ──────────────────────────────────────────────

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

  const { data: cliente } = await supabase
    .from('clientes')
    .select('celular, deleted_at')
    .eq('id', notif.cliente_id)
    .maybeSingle()

  if (!cliente) { await cancelarNotif(supabase, notif.id); return }
  if ((cliente as any).deleted_at) { await cancelarNotif(supabase, notif.id); return }

  const celular = (cliente as any).celular as string | null
  if (!celular) { await marcarFalhou(supabase, notif.id); return }

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

  if (!parcelaId) { await marcarFalhou(supabase, notif.id); return }

  let mensagem: string
  try {
    mensagem = await resolverVariaveis(supabase, {
      contaId, parcelaId, clienteId: notif.cliente_id, template, cobrancaId: notif.cobranca_id,
    })
  } catch (err) {
    logger.error({ notifId: notif.id, err }, 'Erro ao resolver variáveis — reagendando')
    await reagendar(supabase, notif.id)
    return
  }

  let ultimoErro: unknown
  for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
    if (!manager.hasSocket(contaId, semDigitacao)) {
      logger.warn({ notifId: notif.id, tentativa }, 'Socket indisponível — reagendando')
      await reagendar(supabase, notif.id)
      return
    }
    try {
      await manager.enviarMensagem(contaId, celular, mensagem, semDigitacao)
      await marcarEnviado(supabase, notif.id, mensagem)
      logger.info({ contaId, notifId: notif.id, tentativa, via: 'baileys' }, 'WhatsApp: enviado')
      return
    } catch (err) {
      ultimoErro = err
      logger.warn({ contaId, notifId: notif.id, tentativa, err }, `Tentativa ${tentativa}/${MAX_RETRIES} falhou`)
      if (tentativa < MAX_RETRIES) await sleep(RETRY_DELAY_MS)
    }
  }

  logger.error({ contaId, notifId: notif.id, ultimoErro }, 'WhatsApp: todas as tentativas falharam')
  if (!dentroDaJanela()) {
    await reagendar(supabase, notif.id)
  } else {
    await marcarFalhou(supabase, notif.id)
  }
}

// ── Envio via Meta com template pré-aprovado ─────────────────────────────────

async function processarUmaNotificacaoMeta(
  supabase: SupabaseAdmin,
  metaCfg: MetaCfg,
  contaId: string,
  notif: Notif,
) {
  const tmpl = META_TEMPLATE_MAP[notif.tipo]
  if (!tmpl) {
    logger.warn({ notifId: notif.id, tipo: notif.tipo }, 'Meta: sem template para este tipo — falhou')
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

  // Resolve ID da parcela (boasvindas/pagamento_confirmado usam 1ª parcela da cobrança)
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

  const vars = await resolverParamsTemplate(supabase, notif.cliente_id, parcelaId)
  if (!vars) {
    logger.warn({ notifId: notif.id }, 'Meta: dados do cliente/parcela não encontrados — cancelando')
    await cancelarNotif(supabase, notif.id)
    return
  }

  // Monta parâmetros conforme quantidade esperada pelo template
  const parametros = tmpl.params === 2
    ? [vars.nome, vars.valor]
    : [vars.nome, vars.valor, vars.data]

  // Mensagem final para salvar no histórico
  const mensagemFinal = parametros.join(' | ')

  let ultimoErro: unknown
  for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
    try {
      await enviarViaMetaTemplate(metaCfg, celular, tmpl.nome, tmpl.idioma, parametros)
      await marcarEnviado(supabase, notif.id, mensagemFinal)
      logger.info({ contaId, notifId: notif.id, tentativa, via: 'meta', template: tmpl.nome }, 'WhatsApp: enviado')
      return
    } catch (err) {
      ultimoErro = err
      logger.warn({ contaId: notif.conta_id, notifId: notif.id, tentativa, err }, `Meta tentativa ${tentativa}/${MAX_RETRIES} falhou`)
      if (tentativa < MAX_RETRIES) await sleep(RETRY_DELAY_MS)
    }
  }

  logger.error({ contaId: notif.conta_id, notifId: notif.id, ultimoErro }, 'Meta: todas as tentativas falharam')
  if (!dentroDaJanela()) {
    await reagendar(supabase, notif.id)
  } else {
    await marcarFalhou(supabase, notif.id)
  }
}

// ── Loop imediato: pagamento_confirmado e boasvindas ─────────────────────────

export async function processarFilaImediata(
  supabase: SupabaseAdmin,
  manager: UazapiManager,
) {
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

  const todosContaIds = [...new Set(pendentes.map(n => n.conta_id as string))]
  const { data: configs } = await supabase
    .from('configuracoes')
    .select('conta_id, meta_api_ativo, meta_access_token, meta_phone_number_id')
    .in('conta_id', todosContaIds)

  const cfgMap = new Map<string, ContaCfg>(
    (configs ?? []).map((c: any) => [c.conta_id as string, c as ContaCfg]),
  )

  const porConta = new Map<string, Notif>()
  for (const n of pendentes) {
    const contaId = n.conta_id as string
    if (porConta.has(contaId)) continue

    const cfg     = cfgMap.get(contaId)
    const hasMeta = !!(cfg?.meta_api_ativo && cfg.meta_access_token && cfg.meta_phone_number_id)

    if (hasMeta || manager.hasSocket(contaId, true)) {
      porConta.set(contaId, n as Notif)
    }
  }

  if (!porConta.size) return

  let i = 0
  for (const [contaId, notif] of porConta) {
    const cfg     = cfgMap.get(contaId)
    const hasMeta = !!(cfg?.meta_api_ativo && cfg?.meta_access_token && cfg?.meta_phone_number_id)

    if (i++ > 0 && !hasMeta) await sleep(5_000)
    await processarUmaNotificacao(supabase, manager, contaId, notif, true, cfg)
  }
}

// ── Mensagem agendada avulsa (sem parcela — texto livre) ─────────────────────

async function processarAgendada(
  supabase: SupabaseAdmin,
  manager: UazapiManager,
  contaId: string,
  notif: Notif,
  semDigitacao: boolean,
  contaCfg?: ContaCfg,
) {
  const template = notif.mensagem_final?.trim()
  if (!template) { await marcarFalhou(supabase, notif.id); return }

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

  const metaCfg = extrairMetaCfg(contaCfg)

  let ultimoErro: unknown
  for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
    if (!metaCfg && !manager.hasSocket(contaId, semDigitacao)) {
      await reagendar(supabase, notif.id)
      return
    }
    try {
      if (metaCfg) {
        await enviarViaMetaTexto(metaCfg, celular, mensagem)
      } else {
        await manager.enviarMensagem(contaId, celular, mensagem, semDigitacao)
      }
      await marcarEnviado(supabase, notif.id, mensagem)
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

async function marcarEnviado(supabase: SupabaseAdmin, notifId: string, mensagemFinal: string) {
  const { error } = await supabase.from('notificacoes_enviadas').update({
    status:         'enviado',
    mensagem_final: mensagemFinal,
    enviado_em:     new Date().toISOString(),
  }).eq('id', notifId).eq('status', 'fila')
  if (error) logger.error({ notifId, error }, 'WA: falha ao marcar enviado')
}

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
