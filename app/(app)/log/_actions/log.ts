'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatBRL, formatData } from '@/lib/utils/format'
import { substituirVariaveis } from '@/lib/utils/variaveis'
import { revalidatePath } from 'next/cache'

async function getContaId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) throw new Error('Conta não encontrada.')
  return { contaId: conta.id as string }
}

// UPDATE não tem policy RLS — usa service role escopado por conta_id
export async function cancelarNotificacaoAction(id: string) {
  const { contaId } = await getContaId()

  const admin = createAdminClient()
  const { error } = await admin
    .from('notificacoes_enviadas')
    .update({ status: 'cancelado' })
    .eq('id', id)
    .eq('conta_id', contaId)
    .eq('status', 'fila')
  if (error) console.error('[cancelarNotificacao]', error, { id, contaId })

  revalidatePath('/log')
}

// UPDATE não tem policy RLS — usa service role escopado por conta_id
export async function reenviarNotificacaoAction(id: string) {
  const { contaId } = await getContaId()

  const admin = createAdminClient()
  const { error } = await admin
    .from('notificacoes_enviadas')
    .update({
      status:        'fila',
      agendado_para: new Date().toISOString(),
      enviado_em:    null,
    })
    .eq('id', id)
    .eq('conta_id', contaId)
    .in('status', ['falhou', 'cancelado'])
  if (error) console.error('[reenviarNotificacao]', error, { id, contaId })

  revalidatePath('/log')
}

// Templates Meta aprovados — espelho do cron/whatsapp para envio imediato via Forçar.
const META_TMPL: Record<string, { nome: string; idioma: string; params: 2 | 3; corpo: string }> = {
  '5d':                  { nome: 'cobranca_5d',         idioma: 'pt_BR', params: 3, corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence em *5 dias* ({{3}}). Para dúvidas, responda esta mensagem.' },
  '3d':                  { nome: 'cobranca_3d',         idioma: 'en',    params: 3, corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence em *3 dias* ({{3}}). Para dúvidas, responda esta mensagem.' },
  '2d':                  { nome: 'cobranca_2d',         idioma: 'pt_BR', params: 3, corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence em *2 dias* ({{3}}). Não se esqueça de pagar!' },
  '1d':                  { nome: 'cobranca_1d',         idioma: 'pt_BR', params: 3, corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence *amanhã* ({{3}}). Pague hoje para evitar juros.' },
  'dia':                 { nome: 'cobranca_dia',        idioma: 'pt_BR', params: 3, corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence *hoje* ({{3}}). Pague agora para evitar juros.' },
  'vencido1d':           { nome: 'cobranca_vencido',    idioma: 'pt_BR', params: 3, corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* venceu ontem ({{3}}). Regularize o quanto antes para evitar cobrança adicional.' },
  'pagamento_confirmado':{ nome: 'pagamento_confirmado',idioma: 'pt_BR', params: 2, corpo: 'Muito obrigado, *{{1}}*! Recebemos seu pagamento de *{{2}}*. Qualquer dúvida ou problema só me enviar mensagem.' },
  'boasvindas':          { nome: 'boasvindas',          idioma: 'pt_BR', params: 3, corpo: 'Muito obrigado, *{{1}}*! Sua primeira fatura de *{{2}}* vence em *{{3}}*. Estaremos sempre à disposição para melhor lhe atender.' },
}

function _fmtBRL(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}
function _fmtData(iso: string) {
  const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`
}

// Força o envio imediato usando Meta Cloud API (se configurada) ou UazAPI como fallback.
export async function forcarEnvioAction(id: string): Promise<{ error?: string }> {
  const { contaId } = await getContaId()
  const admin = createAdminClient()

  // ── 1. Claim atômico ─────────────────────────────────────────────────────
  const { data: notif } = await admin
    .from('notificacoes_enviadas')
    .update({ status: 'cancelado' })
    .eq('id', id)
    .eq('conta_id', contaId)
    .eq('canal', 'whatsapp')
    .in('status', ['fila', 'cancelado'])
    .select('id, parcela_id, cobranca_id, cliente_id, tipo, mensagem_final')
    .maybeSingle()

  if (!notif) return { error: 'Notificação não encontrada.' }

  // ── 2. Buscar cliente ────────────────────────────────────────────────────
  const { data: cliente } = await admin
    .from('clientes')
    .select('celular, nome, sobrenome, deleted_at')
    .eq('id', notif.cliente_id as string)
    .maybeSingle()

  if (!cliente || cliente.deleted_at) return { error: 'Cliente não encontrado ou excluído.' }
  const celular = cliente.celular
  if (!celular) return { error: 'Cliente sem celular cadastrado.' }

  // ── 3. Verificar provedor ativo ──────────────────────────────────────────
  const { data: cfgConta } = await admin
    .from('configuracoes')
    .select('meta_api_ativo, meta_access_token, meta_phone_number_id')
    .eq('conta_id', contaId)
    .maybeSingle()

  const usarMeta = !!(cfgConta?.meta_api_ativo && cfgConta?.meta_access_token && cfgConta?.meta_phone_number_id)

  // ── 4a. Envio via Meta Cloud API ─────────────────────────────────────────
  if (usarMeta) {
    const tmpl = META_TMPL[notif.tipo as string]
    if (!tmpl) {
      await admin.from('notificacoes_enviadas').update({ status: 'fila' }).eq('id', id)
      return { error: `Tipo "${notif.tipo}" não possui template Meta configurado.` }
    }

    let parcelaId = notif.parcela_id as string | null
    if (!parcelaId && notif.cobranca_id) {
      const { data: p } = await admin
        .from('parcelas').select('id')
        .eq('cobranca_id', notif.cobranca_id as string)
        .order('numero', { ascending: true }).limit(1).maybeSingle()
      parcelaId = (p as any)?.id ?? null
    }

    let valor = ''
    let data  = ''
    if (parcelaId) {
      const { data: parcela } = await admin
        .from('parcelas').select('valor, data_vencimento')
        .eq('id', parcelaId).maybeSingle()
      if (parcela) {
        valor = _fmtBRL(Number((parcela as any).valor ?? 0))
        data  = _fmtData((parcela as any).data_vencimento ?? '')
      }
    }

    const nome       = (cliente.nome as string) || 'Cliente'
    const parametros = tmpl.params === 2 ? [nome, valor] : [nome, valor, data]
    const texto      = tmpl.corpo
      .replace('{{1}}', parametros[0] ?? '')
      .replace('{{2}}', parametros[1] ?? '')
      .replace('{{3}}', parametros[2] ?? '')

    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${cfgConta!.meta_phone_number_id}/messages`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfgConta!.meta_access_token}` },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to:       celular,
            type:     'template',
            template: {
              name:     tmpl.nome,
              language: { code: tmpl.idioma },
              components: [{ type: 'body', parameters: parametros.map(text => ({ type: 'text', text })) }],
            },
          }),
        },
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const msg = (err as any)?.error?.message ?? `Meta erro ${res.status}`
        await admin.from('notificacoes_enviadas').update({ status: 'fila' }).eq('id', id)
        return { error: `Falha ao enviar via Meta: ${msg}` }
      }
    } catch {
      await admin.from('notificacoes_enviadas').update({ status: 'fila' }).eq('id', id)
      return { error: 'Erro de rede ao chamar a Meta API.' }
    }

    const agora = new Date().toISOString()
    await admin.from('notificacoes_enviadas')
      .update({ status: 'enviado', mensagem_final: texto, enviado_em: agora })
      .eq('id', id)

    // Garantir que existe um atendimento para a mensagem aparecer no painel
    let { data: atend } = await admin.from('atendimentos').select('id')
      .eq('conta_id', contaId).eq('celular', celular).neq('status', 'finalizado').maybeSingle()

    if (!atend) {
      const { data: novoAtend } = await admin.from('atendimentos').insert({
        conta_id:        contaId,
        celular,
        cliente_id:      notif.cliente_id as string | null,
        status:          'aguardando',
        ultima_mensagem: texto,
        ultima_msg_em:   agora,
      }).select('id').maybeSingle()
      atend = novoAtend
    } else {
      await admin.from('atendimentos')
        .update({ ultima_mensagem: texto, ultima_msg_em: agora })
        .eq('id', (atend as any).id)
    }

    await admin.from('mensagens_wa').insert({
      conta_id: contaId, cliente_id: notif.cliente_id, atendimento_id: (atend as any)?.id ?? null,
      celular, direcao: 'out', texto, lida: true,
    })

    revalidatePath('/log')
    return {}
  }

  // ── 4b. Fallback: UazAPI ─────────────────────────────────────────────────
  let mensagem: string

  if (notif.tipo === 'agendada') {
    const corpo = ((notif.mensagem_final as string) ?? '').trim()
    if (!corpo) return { error: 'Mensagem não configurada.' }
    mensagem = await resolverVarsLeves(admin, {
      contaId,
      clienteId: notif.cliente_id as string,
      template:  corpo,
    })
  } else {
    const { data: cfgNotif } = await admin
      .from('notificacoes_config')
      .select('template_whatsapp')
      .eq('conta_id', contaId)
      .eq('tipo', notif.tipo)
      .maybeSingle()

    const template = cfgNotif?.template_whatsapp?.trim()
    if (!template) return { error: 'Template WhatsApp não configurado para este tipo.' }

    let parcelaId = notif.parcela_id as string | null
    if (!parcelaId && notif.cobranca_id) {
      const { data: p } = await admin
        .from('parcelas')
        .select('id')
        .eq('cobranca_id', notif.cobranca_id as string)
        .order('numero', { ascending: true })
        .limit(1)
        .maybeSingle()
      parcelaId = p?.id ?? null
    }
    if (!parcelaId) return { error: 'Parcela não encontrada para montar a mensagem.' }

    mensagem = await resolverVars(admin, {
      contaId,
      parcelaId,
      clienteId:  notif.cliente_id as string,
      template,
      cobrancaId: notif.cobranca_id as string | null,
    })
  }

  const uazapiUrl   = (process.env.UAZAPI_URL ?? '').replace(/\/$/, '')
  const globalToken = process.env.UAZAPI_ADMIN_TOKEN ?? process.env.UAZAPI_GLOBAL_TOKEN ?? ''

  if (!uazapiUrl || !globalToken) {
    return { error: 'Nenhum provedor WhatsApp configurado (Meta API ou UazAPI).' }
  }

  const instName = `quita${(contaId).replace(/-/g, '').slice(0, 10)}`
  let instanceToken: string | null = null
  try {
    const resp = await fetch(`${uazapiUrl}/instance/all`, { headers: { admintoken: globalToken } })
    if (resp.ok) {
      const all = await resp.json()
      if (Array.isArray(all)) {
        const inst = all.find((i: any) => i.name === instName)
        if (inst?.status === 'connected') instanceToken = inst.token as string
      }
    }
  } catch {
    return { error: 'Erro ao conectar ao servidor WhatsApp.' }
  }

  if (!instanceToken) {
    return { error: 'WhatsApp desconectado. Reconecte em Conexão WA e tente novamente.' }
  }

  try {
    const resp = await fetch(`${uazapiUrl}/send/text`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', token: instanceToken },
      body:    JSON.stringify({ number: celular, text: mensagem }),
    })
    if (!resp.ok) {
      const txt = await resp.text()
      return { error: `Falha ao enviar: ${txt}` }
    }
  } catch {
    return { error: 'Erro de rede ao enviar a mensagem.' }
  }

  await admin
    .from('notificacoes_enviadas')
    .update({ status: 'enviado', mensagem_final: mensagem, enviado_em: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'cancelado')

  revalidatePath('/log')
  return {}
}

// ── Helpers de resolução de variáveis ───────────────────────────────────────
// A substituição pura (substituirVariaveis) vive em lib/utils/variaveis.ts.
// O worker mantém cópia própria em worker/src/variaveis.ts — processos separados.
// Ao adicionar nova variável de template, atualizar ambos os arquivos.

async function resolverVarsLeves(
  admin: ReturnType<typeof createAdminClient>,
  { contaId, clienteId, template }: { contaId: string; clienteId: string; template: string },
): Promise<string> {
  const [{ data: cliente }, { data: saudacoes }] = await Promise.all([
    admin.from('clientes').select('nome, sobrenome').eq('id', clienteId).single(),
    admin.from('saudacoes').select('texto').eq('conta_id', contaId),
  ])
  const textos   = (saudacoes ?? []).map(s => s.texto)
  const saudacao = textos.length ? textos[Math.floor(Math.random() * textos.length)] : 'Olá!'
  const nome     = cliente?.nome ?? ''
  const sobrenome = cliente?.sobrenome ?? ''
  return template
    .replace(/#NOMECOMPLETO#/g, `${nome} ${sobrenome}`.trim())
    .replace(/#NOME#/g,         nome)
    .replace(/#SAUDACAO#/g,     saudacao)
}

async function resolverVars(
  admin: ReturnType<typeof createAdminClient>,
  { contaId, parcelaId, clienteId, template, cobrancaId }: {
    contaId: string; parcelaId: string; clienteId: string; template: string; cobrancaId?: string | null
  },
): Promise<string> {
  async function buscarPix() {
    if (cobrancaId) {
      const { data: cob } = await admin
        .from('cobrancas').select('meio_pagamento_id').eq('id', cobrancaId).maybeSingle()
      const meioid = cob?.meio_pagamento_id
      if (meioid) {
        const { data: meio } = await admin
          .from('meios_pagamento').select('mensagem').eq('id', meioid).maybeSingle()
        if (meio?.mensagem) return meio
      }
    }
    const { data } = await admin
      .from('meios_pagamento').select('mensagem').eq('conta_id', contaId).eq('is_padrao', true).maybeSingle()
    return data
  }

  const [{ data: parcela }, { data: cliente }, { data: saudacoes }, pix] = await Promise.all([
    admin.from('parcelas').select('valor, data_vencimento').eq('id', parcelaId).single(),
    admin.from('clientes').select('nome, sobrenome').eq('id', clienteId).single(),
    admin.from('saudacoes').select('texto').eq('conta_id', contaId),
    buscarPix(),
  ])

  const textos   = (saudacoes ?? []).map(s => s.texto)
  const saudacao = textos.length ? textos[Math.floor(Math.random() * textos.length)] : 'Olá!'

  return substituirVariaveis(template, {
    valor:        formatBRL(parcela?.valor ?? 0),
    nomecompleto: `${cliente?.nome ?? ''} ${cliente?.sobrenome ?? ''}`.trim(),
    nome:         cliente?.nome ?? '',
    pix:          pix?.mensagem ?? '(Pix não configurado)',
    saudacao,
    vencimento:   formatData(parcela?.data_vencimento),
  })
}
