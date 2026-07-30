// Cron: roda a cada minuto — processa a fila de notificações WhatsApp via Meta Cloud API.
// Vercel invoca via GET com Authorization: Bearer CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 300

// Tipos que ignoram a janela horária (enviados a qualquer hora)
const TIPOS_SEM_JANELA = new Set(['pagamento_confirmado', 'boasvindas', 'manual', 'agendada'])

// Templates aprovados na Meta — mapeados por tipo de notificação
const META_TEMPLATES: Record<string, { nome: string; idioma: string; params: 2 | 3 }> = {
  '5d':                   { nome: 'cobranca_5d',          idioma: 'pt_BR', params: 3 },
  '3d':                   { nome: 'cobranca_3d',          idioma: 'en',    params: 3 },
  '2d':                   { nome: 'cobranca_2d',          idioma: 'pt_BR', params: 3 },
  '1d':                   { nome: 'cobranca_1d',          idioma: 'pt_BR', params: 3 },
  'dia':                  { nome: 'cobranca_dia',         idioma: 'pt_BR', params: 3 },
  'vencido1d':            { nome: 'cobranca_vencido',     idioma: 'pt_BR', params: 3 },
  'pagamento_confirmado': { nome: 'pagamento_confirmado', idioma: 'pt_BR', params: 2 },
  'boasvindas':           { nome: 'boasvindas',           idioma: 'pt_BR', params: 3 },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hojeEmSP(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function addDias(data: string, dias: number): string {
  const d = new Date(data + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function dentroDaJanela(inicio = '09:00', fim = '20:00'): boolean {
  const agora  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const minutos = agora.getHours() * 60 + agora.getMinutes()
  const [hI, mI] = inicio.split(':').map(Number)
  const [hF, mF] = fim.split(':').map(Number)
  return minutos >= hI * 60 + mI && minutos < hF * 60 + mF
}

function formatarMoeda(valor: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)
}

function formatarData(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-')
  return `${dia}/${mes}/${ano}`
}

// ── Envio via Meta Cloud API — template pré-aprovado ─────────────────────────

async function enviarTemplate(
  phoneNumberId: string,
  token: string,
  celular: string,
  templateNome: string,
  templateIdioma: string,
  parametros: string[],
): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${token}`,
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
    throw new Error((err as any)?.error?.message ?? `Meta erro ${res.status}`)
  }
}

// ── Processar uma notificação ─────────────────────────────────────────────────

async function processarNotificacao(
  supabase: ReturnType<typeof createAdminClient>,
  notif: {
    id: string
    conta_id: string
    parcela_id: string | null
    cobranca_id: string | null
    cliente_id: string
    tipo: string
    mensagem_final: string | null
  },
  metaToken: string,
  metaPhoneId: string,
  hInicio: string,
  hFim: string,
): Promise<'enviado' | 'fora_janela' | 'sem_template' | 'erro'> {

  // Verificar janela horária
  if (!TIPOS_SEM_JANELA.has(notif.tipo) && !dentroDaJanela(hInicio, hFim)) {
    return 'fora_janela'
  }

  const tmpl = META_TEMPLATES[notif.tipo]
  if (!tmpl) {
    await supabase.from('notificacoes_enviadas')
      .update({ status: 'falhou' }).eq('id', notif.id)
    return 'sem_template'
  }

  // Buscar celular do cliente
  const { data: cliente } = await supabase
    .from('clientes')
    .select('celular, deleted_at, nome')
    .eq('id', notif.cliente_id)
    .maybeSingle()

  if (!cliente || (cliente as any).deleted_at) {
    await supabase.from('notificacoes_enviadas')
      .update({ status: 'cancelado' }).eq('id', notif.id)
    return 'erro'
  }

  const celular = (cliente as any).celular as string | null
  if (!celular) {
    await supabase.from('notificacoes_enviadas')
      .update({ status: 'falhou' }).eq('id', notif.id)
    return 'erro'
  }

  // Resolver parcela (boasvindas pode não ter parcela_id)
  let parcelaId = notif.parcela_id
  if (!parcelaId && notif.cobranca_id) {
    const { data: p } = await supabase
      .from('parcelas')
      .select('id')
      .eq('cobranca_id', notif.cobranca_id)
      .order('numero', { ascending: true })
      .limit(1)
      .maybeSingle()
    parcelaId = (p as any)?.id ?? null
  }

  // Buscar dados da parcela para os parâmetros
  let valor = ''
  let data  = ''

  if (parcelaId) {
    const { data: parcela } = await supabase
      .from('parcelas')
      .select('valor, data_vencimento')
      .eq('id', parcelaId)
      .maybeSingle()

    if (parcela) {
      valor = formatarMoeda(Number((parcela as any).valor ?? 0))
      data  = formatarData((parcela as any).data_vencimento ?? '')
    }
  }

  const nome = ((cliente as any).nome as string) || 'Cliente'
  const parametros = tmpl.params === 2 ? [nome, valor] : [nome, valor, data]

  try {
    await enviarTemplate(metaPhoneId, metaToken, celular, tmpl.nome, tmpl.idioma, parametros)

    await supabase.from('notificacoes_enviadas').update({
      status:         'enviado',
      mensagem_final: parametros.join(' | '),
      enviado_em:     new Date().toISOString(),
    }).eq('id', notif.id).eq('status', 'fila')

    return 'enviado'

  } catch (err: any) {
    console.error('[cron/whatsapp] erro ao enviar', notif.id, err?.message)

    // Fora da janela de serviço da Meta (131026) → reagenda para amanhã
    if (err?.message?.includes('131026') || err?.message?.includes('outside')) {
      const amanha = addDias(hojeEmSP(), 1)
      await supabase.from('notificacoes_enviadas')
        .update({ agendado_para: new Date(`${amanha}T09:00:00-03:00`).toISOString() })
        .eq('id', notif.id)
    } else {
      await supabase.from('notificacoes_enviadas')
        .update({ status: 'falhou' }).eq('id', notif.id)
    }

    return 'erro'
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const agora    = new Date().toISOString()

  // Buscar notificações pendentes (todas de uma vez, até 50)
  const { data: pendentes } = await supabase
    .from('notificacoes_enviadas')
    .select('id, conta_id, parcela_id, cobranca_id, cliente_id, tipo, mensagem_final')
    .eq('canal', 'whatsapp')
    .eq('status', 'fila')
    .lte('agendado_para', agora)
    .order('agendado_para', { ascending: true })
    .limit(50)

  if (!pendentes?.length) {
    return NextResponse.json({ ok: true, processadas: 0 })
  }

  // Carregar credenciais Meta e config de horário para todas as contas (1 query)
  const contaIds = [...new Set(pendentes.map(n => n.conta_id as string))]
  const { data: configs } = await supabase
    .from('configuracoes')
    .select('conta_id, meta_api_ativo, meta_access_token, meta_phone_number_id, horario_inicio, horario_fim')
    .in('conta_id', contaIds)

  const cfgMap = new Map(
    (configs ?? []).map((c: any) => [c.conta_id as string, c])
  )

  let enviadas    = 0
  let foraJanela  = 0
  let erros       = 0

  for (const notif of pendentes) {
    const cfg = cfgMap.get(notif.conta_id as string)

    // Pula contas sem Meta API configurada
    if (!cfg?.meta_api_ativo || !cfg.meta_access_token || !cfg.meta_phone_number_id) continue

    const resultado = await processarNotificacao(
      supabase,
      notif as any,
      cfg.meta_access_token as string,
      cfg.meta_phone_number_id as string,
      (cfg.horario_inicio as string) ?? '09:00',
      (cfg.horario_fim    as string) ?? '20:00',
    )

    if (resultado === 'enviado')      enviadas++
    else if (resultado === 'fora_janela') foraJanela++
    else                              erros++
  }

  console.log(`[cron/whatsapp] enviadas=${enviadas} fora_janela=${foraJanela} erros=${erros}`)
  return NextResponse.json({ ok: true, enviadas, foraJanela, erros })
}
