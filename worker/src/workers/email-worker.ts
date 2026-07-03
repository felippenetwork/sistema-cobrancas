// Worker de E-mail via Resend.
// Regras (notificacoes-fila §5):
//   • Janela 09:00–20:00 (SP). Overflow → dia seguinte às 09h.
//   • Sem o intervalo longo do WhatsApp (sem risco de ban), apenas rate limit do Resend.
//   • Todo e-mail DEVE ter link de unsubscribe no rodapé (§2, §8).
//   • Não enviar para clientes com optout_email = true.

import { createHmac } from 'crypto'
import pino from 'pino'
import { Resend } from 'resend'
import { dentroDaJanela, horaStr, TIPOS_SEM_JANELA, sleep, hojeEmSP, addDias } from '../format.js'
import { resolverVariaveis, resolverVariaveisLeves } from '../variaveis.js'
import type { SupabaseAdmin } from '../supabase.js'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' })
const resend  = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

const SITE_URL     = process.env.SITE_URL ?? 'http://localhost:3000'
const UNSUB_SECRET = process.env.UNSUB_SECRET ?? ''

function gerarTokenDescadastro(clienteId: string): string {
  if (!UNSUB_SECRET) return ''
  return createHmac('sha256', UNSUB_SECRET).update(clienteId).digest('hex')
}

export async function processarFilaEmail(supabase: SupabaseAdmin) {
  if (!resend) {
    logger.warn('RESEND_API_KEY não configurada — worker de e-mail desativado')
    return
  }

  const agora = new Date().toISOString()

  const { data: pendentes } = await supabase
    .from('notificacoes_enviadas')
    .select('id, conta_id, parcela_id, cobranca_id, cliente_id, tipo')
    .eq('canal', 'email')
    .eq('status', 'fila')
    .lte('agendado_para', agora)
    .order('agendado_para', { ascending: true })
    .limit(10)

  if (!pendentes?.length) return

  // Carregar janela por conta (1 query para todas as contas do lote)
  const contaIds = [...new Set(pendentes.map((n: any) => n.conta_id as string))]
  const { data: configs } = await supabase
    .from('configuracoes')
    .select('conta_id, horario_inicio, horario_fim')
    .in('conta_id', contaIds)

  const cfgMap = new Map(
    (configs ?? []).map((c: any) => [c.conta_id as string, c]),
  )

  for (const notif of pendentes) {
    const cfg     = cfgMap.get(notif.conta_id as string)
    const hInicio = horaStr(cfg?.horario_inicio ?? '09:00')
    const hFim    = horaStr(cfg?.horario_fim    ?? '20:00')

    // Tipos transacionais/manuais não têm restrição de janela
    if (!TIPOS_SEM_JANELA.has(notif.tipo as string) && !dentroDaJanela(hInicio, hFim)) {
      continue  // fora da janela desta conta
    }

    await processarUmEmail(supabase, notif)
    await sleep(2_000)  // rate limit do Resend
  }
}

async function processarUmEmail(
  supabase: SupabaseAdmin,
  notif: { id: string; conta_id: string; parcela_id: string | null; cobranca_id: string | null; cliente_id: string; tipo: string; assunto?: string | null; mensagem_final?: string | null },
) {
  const contaId = notif.conta_id

  // ── Desvio isolado: e-mail agendado avulso (sem template/parcela) ───────
  if (notif.tipo === 'agendada') {
    await processarEmailAgendado(supabase, contaId, notif)
    return
  }

  // Verificar optout_email
  const { data: cliente } = await supabase
    .from('clientes')
    .select('nome, sobrenome, email, optout_email')
    .eq('id', notif.cliente_id)
    .single()

  if (!cliente || (cliente as any).optout_email) {
    await emailCancelar(supabase, notif.id)
    return
  }

  // Buscar config de notificação
  const { data: cfg } = await supabase
    .from('notificacoes_config')
    .select('template_email, assunto_email')
    .eq('conta_id', contaId)
    .eq('tipo', notif.tipo)
    .single()

  const template = (cfg as any)?.template_email
  const assunto  = (cfg as any)?.assunto_email
  if (!template || !assunto) {
    await emailFalhou(supabase, notif.id)
    return
  }

  // Buscar remetente
  const [{ data: remConfig }, { data: platConfig }] = await Promise.all([
    supabase.from('email_remetente').select('local_part, from_name').eq('conta_id', contaId).maybeSingle(),
    supabase.from('plataforma_config').select('dominio_email_operador').single(),
  ])

  const localPart = (remConfig as any)?.local_part
  const dominio   = (platConfig as any)?.dominio_email_operador
  if (!localPart || !dominio) {
    await emailFalhou(supabase, notif.id)
    return
  }

  // Resolver ID da parcela — para boasvindas, parcela_id é null; buscar 1ª parcela da cobrança
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
    logger.warn({ notifId: notif.id, tipo: notif.tipo }, 'Email: sem parcela para variáveis — falhou')
    await emailFalhou(supabase, notif.id)
    return
  }

  const fromName    = (remConfig as any)?.from_name ?? localPart
  const fromAddress = `${fromName} <${localPart}@${dominio}>`
  const toAddress   = (cliente as any).email
  const unsubUrl    = `${SITE_URL}/descadastrar/${notif.cliente_id}`

  // Resolver variáveis
  let conteudoFinal: string
  try {
    conteudoFinal = await resolverVariaveis(supabase, {
      contaId,
      parcelaId,
      clienteId:  notif.cliente_id,
      template,
      cobrancaId: notif.cobranca_id,
    })
  } catch (err) {
    logger.error({ notifId: notif.id, err }, 'Email: erro ao resolver variáveis')
    await emailFalhou(supabase, notif.id)
    return
  }

  // Montar HTML com unsubscribe obrigatório (notificacoes-fila §2, §8)
  const html = gerarHTMLEmail({ assunto, conteudo: conteudoFinal, fromName, unsubscribeUrl: unsubUrl })

  try {
    const { data: resendData, error: resendErr } = await resend!.emails.send({
      from:    fromAddress,
      to:      toAddress,
      subject: assunto,
      html,
      headers: { 'List-Unsubscribe': `<${unsubUrl}>` },
    })

    if (resendErr) throw resendErr

    const { error: updErr } = await supabase.from('notificacoes_enviadas').update({
      status:            'enviado',
      mensagem_final:    conteudoFinal,
      enviado_em:        new Date().toISOString(),
      resend_message_id: resendData?.id ?? null,
    }).eq('id', notif.id)
    if (updErr) logger.error({ notifId: notif.id, updErr }, 'Email: falha ao marcar enviado')

    logger.info({ notifId: notif.id, resendId: resendData?.id }, 'Email: enviado')
  } catch (err) {
    logger.error({ notifId: notif.id, err }, 'Email: erro ao enviar')
    if (!dentroDaJanela()) {
      await emailReagendar(supabase, notif.id)
    } else {
      await emailFalhou(supabase, notif.id)
    }
  }
}

// ── E-mail agendado avulso (sem parcela — caminho isolado) ───────────────────

async function processarEmailAgendado(
  supabase: SupabaseAdmin,
  contaId: string,
  notif: { id: string; cliente_id: string; assunto?: string | null; mensagem_final?: string | null },
) {
  const { data: cliente } = await supabase
    .from('clientes')
    .select('nome, sobrenome, email, optout_email, deleted_at')
    .eq('id', notif.cliente_id)
    .maybeSingle()

  if (!cliente || (cliente as any).deleted_at) {
    await emailCancelar(supabase, notif.id)
    return
  }
  if ((cliente as any).optout_email) {
    await emailCancelar(supabase, notif.id)
    return
  }

  const toAddress = (cliente as any).email as string | null
  if (!toAddress) {
    await emailFalhou(supabase, notif.id)
    return
  }

  const assunto = notif.assunto?.trim()
  const corpo   = notif.mensagem_final?.trim()
  if (!assunto || !corpo) {
    await emailFalhou(supabase, notif.id)
    return
  }

  // Buscar remetente (igual ao fluxo principal)
  const [{ data: remConfig }, { data: platConfig }] = await Promise.all([
    supabase.from('email_remetente').select('local_part, from_name').eq('conta_id', contaId).maybeSingle(),
    supabase.from('plataforma_config').select('dominio_email_operador').single(),
  ])

  const localPart = (remConfig as any)?.local_part
  const dominio   = (platConfig as any)?.dominio_email_operador
  if (!localPart || !dominio) {
    await emailFalhou(supabase, notif.id)
    return
  }

  const fromName    = (remConfig as any)?.from_name ?? localPart
  const fromAddress = `${fromName} <${localPart}@${dominio}>`
  const unsubToken  = gerarTokenDescadastro(notif.cliente_id)
  const unsubUrl    = unsubToken
    ? `${SITE_URL}/descadastrar/${notif.cliente_id}?token=${unsubToken}`
    : `${SITE_URL}/descadastrar/${notif.cliente_id}`

  // Resolver variáveis no assunto e no corpo
  const [assuntoFinal, conteudoFinal] = await Promise.all([
    resolverVariaveisLeves(supabase, { contaId, clienteId: notif.cliente_id, template: assunto }),
    resolverVariaveisLeves(supabase, { contaId, clienteId: notif.cliente_id, template: corpo }),
  ])

  const html = gerarHTMLEmail({ assunto: assuntoFinal, conteudo: conteudoFinal, fromName, unsubscribeUrl: unsubUrl })

  try {
    const { data: resendData, error: resendErr } = await resend!.emails.send({
      from:    fromAddress,
      to:      toAddress,
      subject: assuntoFinal,
      html,
      headers: { 'List-Unsubscribe': `<${unsubUrl}>` },
    })

    if (resendErr) throw resendErr

    const { error: updErr } = await supabase.from('notificacoes_enviadas').update({
      status:            'enviado',
      mensagem_final:    conteudoFinal,
      enviado_em:        new Date().toISOString(),
      resend_message_id: resendData?.id ?? null,
    }).eq('id', notif.id)
    if (updErr) logger.error({ notifId: notif.id, updErr }, 'Email agendado: falha ao marcar enviado')

    logger.info({ notifId: notif.id, resendId: resendData?.id }, 'Email agendado: enviado')
  } catch (err) {
    logger.error({ notifId: notif.id, err }, 'Email agendado: erro ao enviar')
    if (!dentroDaJanela()) {
      await emailReagendar(supabase, notif.id)
    } else {
      await emailFalhou(supabase, notif.id)
    }
  }
}

// ── Helpers de estado ────────────────────────────────────────────────────────

async function emailReagendar(supabase: SupabaseAdmin, notifId: string) {
  const amanha = addDias(hojeEmSP(), 1)
  const { error } = await supabase.from('notificacoes_enviadas')
    .update({ agendado_para: new Date(`${amanha}T09:00:00-03:00`).toISOString() })
    .eq('id', notifId)
  if (error) logger.error({ notifId, error }, 'Email: falha ao reagendar')
  else logger.info({ notifId }, 'Email: reagendado para amanhã às 09h')
}

async function emailFalhou(supabase: SupabaseAdmin, notifId: string) {
  const { error } = await supabase.from('notificacoes_enviadas')
    .update({ status: 'falhou' }).eq('id', notifId)
  if (error) logger.error({ notifId, error }, 'Email: falha ao marcar como falhou')
}

async function emailCancelar(supabase: SupabaseAdmin, notifId: string) {
  const { error } = await supabase.from('notificacoes_enviadas')
    .update({ status: 'cancelado' }).eq('id', notifId)
  if (error) logger.error({ notifId, error }, 'Email: falha ao cancelar notif')
}

// Template HTML mínimo com unsubscribe (deve estar no rodapé de todo e-mail — §8)
function gerarHTMLEmail({ assunto, conteudo, fromName, unsubscribeUrl }: {
  assunto: string; conteudo: string; fromName: string; unsubscribeUrl: string
}): string {
  const corpo = conteudo.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${assunto}</title></head><body style="font-family:Arial,sans-serif;background:#f4f5f7;margin:0;padding:0">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden">
<div style="background:#0B0F17;padding:20px 28px"><span style="color:#E6EAF2;font-size:16px;font-weight:600">${fromName}</span></div>
<div style="padding:28px;color:#1a202c;font-size:15px;line-height:1.65">${corpo}</div>
<div style="padding:16px 28px;background:#f7fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#718096">
<p>Enviado por <strong>${fromName}</strong>.</p>
<p style="margin-top:8px">Para não receber mais e-mails, <a href="${unsubscribeUrl}" style="color:#718096">clique aqui para se descadastrar</a>.</p>
</div></div></body></html>`
}
