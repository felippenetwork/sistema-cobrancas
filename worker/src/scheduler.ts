// Scheduler de notificações.
// Varre parcelas abertas e enfileira notificacoes_enviadas (idempotente).
// Regras (notificacoes-fila §5):
//   • Janelas: D-5, D-3, D-2, D-1, D0, D+1 (vencido1d)
//   • Idempotência: INSERT ignora duplicata (unique parcela+tipo+canal, exceto 'manual')
//   • Parcela paga → não enfileira (scheduler filtra status='aberta')
//   • Boas-vindas: criada pelo criarCobrancaAction, não pelo scheduler

import pino from 'pino'
import { hojeEmSP, addDias } from './format.js'
import type { SupabaseAdmin } from './supabase.js'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' })

function calcularProximoVencimento(ultimoVencimento: string, diaPagamento: number): string {
  const [ano, mes] = ultimoVencimento.split('-').map(Number)
  let novoMes = mes + 1
  let novoAno = ano
  if (novoMes > 12) { novoMes = 1; novoAno++ }
  const ultimoDia = new Date(novoAno, novoMes, 0).getDate()
  const dia = Math.min(diaPagamento, ultimoDia)
  return `${novoAno}-${String(novoMes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

const JANELAS = [
  { tipo: '5d',        offset: 5 },
  { tipo: '3d',        offset: 3 },
  { tipo: '2d',        offset: 2 },
  { tipo: '1d',        offset: 1 },
  { tipo: 'dia',       offset: 0 },
  { tipo: 'vencido1d', offset: -1 },  // ontem — venceu e não pagou
] as const

export async function runScheduler(supabase: SupabaseAdmin) {
  logger.info('Scheduler: iniciando varredura')
  const hoje = hojeEmSP()

  // Todas as contas ativas
  const { data: contas } = await supabase
    .from('contas').select('id').eq('status', 'ativa')

  for (const conta of contas ?? []) {
    try {
      // Gera parcelas recorrentes antes de processar notificações, assim a parcela
      // recém-criada já entra na varredura D-5/D-3... do mesmo ciclo.
      await manterParcelasRecorrentes(supabase, conta.id as string)
      await processarConta(supabase, conta.id as string, hoje)
    } catch (err) {
      logger.error({ contaId: conta.id, err }, 'Scheduler: erro ao processar conta')
    }
  }

  logger.info('Scheduler: varredura concluída')
}

async function manterParcelasRecorrentes(supabase: SupabaseAdmin, contaId: string) {
  // 1. Cobranças recorrentes ativas desta conta
  const { data: cobrancas } = await supabase
    .from('cobrancas')
    .select('id, dia_pagamento, valor_mensalidade')
    .eq('conta_id', contaId)
    .eq('recorrente', true)
    .eq('status', 'ativa')

  if (!cobrancas?.length) return

  const cobIds = cobrancas.map((c: any) => c.id as string)

  // 2. Quais têm parcela aberta (1 query — elimina N+1)
  const { data: comAbertaRows } = await supabase
    .from('parcelas')
    .select('cobranca_id')
    .eq('conta_id', contaId)
    .in('cobranca_id', cobIds)
    .eq('status', 'aberta')

  const comAberta = new Set((comAbertaRows ?? []).map((p: any) => p.cobranca_id as string))
  const semAberta = cobrancas.filter((c: any) => !comAberta.has(c.id as string))

  if (!semAberta.length) return

  // 3. Última parcela de cada cobrança sem aberta (1 query — elimina 2° N+1)
  const semAbertaIds = semAberta.map((c: any) => c.id as string)
  const { data: ultimas } = await supabase
    .from('parcelas')
    .select('cobranca_id, numero, data_vencimento')
    .eq('conta_id', contaId)
    .in('cobranca_id', semAbertaIds)
    .order('numero', { ascending: false })

  // Tomar apenas a de maior número por cobrança
  const ultimaMap = new Map<string, { numero: number; data_vencimento: string }>()
  for (const p of ultimas ?? []) {
    const cid = p.cobranca_id as string
    if (!ultimaMap.has(cid)) {
      ultimaMap.set(cid, { numero: p.numero as number, data_vencimento: p.data_vencimento as string })
    }
  }

  for (const cob of semAberta) {
    const ultima = ultimaMap.get(cob.id as string)
    if (!ultima) continue  // cobrança sem parcelas (não deveria ocorrer)

    const proximoNumero     = ultima.numero + 1
    const proximoVencimento = calcularProximoVencimento(ultima.data_vencimento, cob.dia_pagamento as number)

    const { error } = await supabase.from('parcelas').insert({
      conta_id:        contaId,
      cobranca_id:     cob.id,
      numero:          proximoNumero,
      valor:           cob.valor_mensalidade,
      data_vencimento: proximoVencimento,
      status:          'aberta',
    })

    if (error) {
      logger.error({ contaId, cobrancaId: cob.id, error }, 'Scheduler: erro ao gerar parcela recorrente')
    } else {
      logger.info({ contaId, cobrancaId: cob.id, proximoVencimento, numero: proximoNumero }, 'Scheduler: parcela recorrente gerada')
    }
  }
}

async function processarConta(supabase: SupabaseAdmin, contaId: string, hoje: string) {
  // Buscar configuração de notificações da conta
  const { data: configs } = await supabase
    .from('notificacoes_config')
    .select('tipo, horario, ativo_whatsapp, ativo_email')
    .eq('conta_id', contaId)

  if (!configs?.length) return  // conta sem config, nada a fazer

  const cfgMap = new Map(configs.map((c: any) => [c.tipo, c]))

  for (const { tipo, offset } of JANELAS) {
    const cfg = cfgMap.get(tipo)
    if (!cfg) continue
    if (!cfg.ativo_whatsapp && !cfg.ativo_email) continue  // ambos os canais inativos

    const dataAlvo = addDias(hoje, offset)

    // Parcelas com esse vencimento, abertas e cuja cobrança ainda está ativa.
    // Sem o filtro cobrancas.status o scheduler continuaria gerando notificações
    // para parcelas de cobranças canceladas (parcelas abertas não são apagadas pelo cancelamento).
    const { data: parcelas } = await supabase
      .from('parcelas')
      .select('id, cobranca_id, cobrancas!inner(cliente_id)')
      .eq('conta_id', contaId)
      .eq('data_vencimento', dataAlvo)
      .eq('status', 'aberta')
      .eq('cobrancas.status', 'ativa')

    for (const parcela of parcelas ?? []) {
      const clienteId = (parcela.cobrancas as any)?.cliente_id as string
      const base = {
        conta_id:    contaId,
        parcela_id:  parcela.id,
        cobranca_id: parcela.cobranca_id,
        cliente_id:  clienteId,
        tipo,
      }

      // WhatsApp
      if (cfg.ativo_whatsapp) {
        const { error } = await supabase.from('notificacoes_enviadas').insert({
          ...base, canal: 'whatsapp', status: 'fila',
          agendado_para: agendadoPara(hoje, cfg.horario, false),
        })
        if (error && error.code !== '23505') {
          logger.error({ contaId, parcelaId: parcela.id, tipo, canal: 'whatsapp', error })
        }
      }

      // E-mail
      if (cfg.ativo_email) {
        const { error } = await supabase.from('notificacoes_enviadas').insert({
          ...base, canal: 'email', status: 'fila',
          agendado_para: agendadoPara(hoje, cfg.horario, false),
        })
        if (error && error.code !== '23505') {
          logger.error({ contaId, parcelaId: parcela.id, tipo, canal: 'email', error })
        }
      }
    }
  }
}

// Calcula o timestamp de agendamento para hoje no horário configurado (fuso SP).
// Se já passou das 20h ou o horário configurado já passou, agenda para amanhã às 09h.
function agendadoPara(hoje: string, horario: string, overflow: boolean): string {
  const [h, m] = horario.split(':').map(Number)
  const agora  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const alvo   = new Date(`${hoje}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00-03:00`)

  if (overflow || alvo <= agora) {
    // Overflow: dia seguinte às 09h SP
    const amanha = addDias(hoje, 1)
    return new Date(`${amanha}T09:00:00-03:00`).toISOString()
  }
  return alvo.toISOString()
}
