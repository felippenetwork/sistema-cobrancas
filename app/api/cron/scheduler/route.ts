// Cron: roda a cada hora — enfileira notificações na tabela notificacoes_enviadas.
// Vercel invoca via GET com Authorization: Bearer CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 300

const JANELAS = [
  { tipo: '5d',        offset: 5 },
  { tipo: '3d',        offset: 3 },
  { tipo: '2d',        offset: 2 },
  { tipo: '1d',        offset: 1 },
  { tipo: 'dia',       offset: 0 },
  { tipo: 'vencido1d', offset: -1 },
] as const

// ── Helpers de data ───────────────────────────────────────────────────────────

function hojeEmSP(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function addDias(data: string, dias: number): string {
  const d = new Date(data + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function agendadoPara(hoje: string, horario: string): string {
  const [h, m] = (horario || '09:00').split(':').map(Number)
  const agora  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const alvo   = new Date(`${hoje}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`)

  if (alvo <= agora) {
    const amanha = addDias(hoje, 1)
    return new Date(`${amanha}T09:00:00-03:00`).toISOString()
  }
  return alvo.toISOString()
}

function calcularProximoVencimento(ultimoVencimento: string, diaPagamento: number): string {
  const [ano, mes] = ultimoVencimento.split('-').map(Number)
  let novoMes = mes + 1
  let novoAno = ano
  if (novoMes > 12) { novoMes = 1; novoAno++ }
  const ultimoDia = new Date(novoAno, novoMes, 0).getDate()
  const dia = Math.min(diaPagamento, ultimoDia)
  return `${novoAno}-${String(novoMes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

// ── Gerar parcelas recorrentes ────────────────────────────────────────────────

async function gerarParcelasRecorrentes(
  supabase: ReturnType<typeof createAdminClient>,
  contaId: string,
) {
  const { data: cobrancas } = await supabase
    .from('cobrancas')
    .select('id, dia_pagamento, valor_mensalidade')
    .eq('conta_id', contaId)
    .eq('recorrente', true)
    .eq('status', 'ativa')

  if (!cobrancas?.length) return

  const cobIds = cobrancas.map((c: any) => c.id as string)

  const { data: comAbertaRows } = await supabase
    .from('parcelas')
    .select('cobranca_id')
    .eq('conta_id', contaId)
    .in('cobranca_id', cobIds)
    .eq('status', 'aberta')

  const comAberta = new Set((comAbertaRows ?? []).map((p: any) => p.cobranca_id as string))
  const semAberta = cobrancas.filter((c: any) => !comAberta.has(c.id as string))
  if (!semAberta.length) return

  const semAbertaIds = semAberta.map((c: any) => c.id as string)
  const { data: ultimas } = await supabase
    .from('parcelas')
    .select('cobranca_id, numero, data_vencimento')
    .eq('conta_id', contaId)
    .in('cobranca_id', semAbertaIds)
    .order('numero', { ascending: false })

  const ultimaMap = new Map<string, { numero: number; data_vencimento: string }>()
  for (const p of ultimas ?? []) {
    const cid = p.cobranca_id as string
    if (!ultimaMap.has(cid)) {
      ultimaMap.set(cid, { numero: p.numero as number, data_vencimento: p.data_vencimento as string })
    }
  }

  for (const cob of semAberta) {
    const ultima = ultimaMap.get(cob.id as string)
    if (!ultima) continue

    const proximoNumero     = ultima.numero + 1
    const proximoVencimento = calcularProximoVencimento(ultima.data_vencimento, cob.dia_pagamento as number)

    await supabase.from('parcelas').insert({
      conta_id:        contaId,
      cobranca_id:     cob.id,
      numero:          proximoNumero,
      valor:           cob.valor_mensalidade,
      data_vencimento: proximoVencimento,
      status:          'aberta',
    })
  }
}

// ── Enfileirar notificações da conta ─────────────────────────────────────────

async function enfileirarNotificacoes(
  supabase: ReturnType<typeof createAdminClient>,
  contaId: string,
  hoje: string,
) {
  const { data: configs } = await supabase
    .from('notificacoes_config')
    .select('tipo, horario, ativo_whatsapp, ativo_email')
    .eq('conta_id', contaId)

  if (!configs?.length) return

  const cfgMap = new Map(configs.map((c: any) => [c.tipo, c]))

  for (const { tipo, offset } of JANELAS) {
    const cfg = cfgMap.get(tipo)
    if (!cfg) continue
    if (!cfg.ativo_whatsapp && !cfg.ativo_email) continue

    const dataAlvo = addDias(hoje, offset)

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

      if (cfg.ativo_whatsapp) {
        await supabase.from('notificacoes_enviadas').insert({
          ...base, canal: 'whatsapp', status: 'fila',
          agendado_para: agendadoPara(hoje, cfg.horario),
        })
        // ignora duplicata (código 23505)
      }

      if (cfg.ativo_email) {
        await supabase.from('notificacoes_enviadas').insert({
          ...base, canal: 'email', status: 'fila',
          agendado_para: agendadoPara(hoje, cfg.horario),
        })
      }
    }
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const hoje     = hojeEmSP()

  const { data: contas } = await supabase.from('contas').select('id').eq('status', 'ativa')

  let processadas = 0
  let erros       = 0

  for (const conta of contas ?? []) {
    try {
      await gerarParcelasRecorrentes(supabase, conta.id as string)
      await enfileirarNotificacoes(supabase, conta.id as string, hoje)
      processadas++
    } catch (err) {
      console.error('[cron/scheduler] conta', conta.id, err)
      erros++
    }
  }

  console.log(`[cron/scheduler] ${processadas} contas OK, ${erros} erros`)
  return NextResponse.json({ ok: true, processadas, erros })
}
