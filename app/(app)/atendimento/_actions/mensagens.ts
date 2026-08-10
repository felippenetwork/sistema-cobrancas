'use server'

import { revalidatePath } from 'next/cache'
import { getConta } from '@/lib/conta'

export type ActionState = { error: string | null }

// ── Enviar resposta ao cliente ────────────────────────────────────────────────
export async function enviarRespostaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    const celular       = (formData.get('celular')        as string)?.trim()
    const texto         = (formData.get('texto')          as string)?.trim()
    const atendimentoId = (formData.get('atendimento_id') as string | null) ?? null

    if (!celular) return { error: 'Celular inválido.' }
    if (!texto)   return { error: 'Mensagem vazia.' }

    // Busca credenciais Meta + Twilio + conexão uazapiGO em paralelo
    const [{ data: cfg }, { data: conexao }] = await Promise.all([
      supabase
        .from('configuracoes')
        .select('meta_access_token, meta_phone_number_id, meta_api_ativo, twilio_account_sid, twilio_auth_token, twilio_from_number, twilio_ativo')
        .eq('conta_id', contaId)
        .maybeSingle(),
      supabase
        .from('conexoes')
        .select('uazapi_instance_token, status')
        .eq('conta_id', contaId)
        .maybeSingle(),
    ])

    const usarMeta   = !!(cfg?.meta_api_ativo !== false && cfg?.meta_access_token && cfg?.meta_phone_number_id)
    const usarTwilio = !!(cfg?.twilio_ativo !== false && cfg?.twilio_account_sid && cfg?.twilio_auth_token && cfg?.twilio_from_number)

    let waId: string | null = null

    if (usarMeta) {
      // ── Envio via Meta Cloud API ────────────────────────────────────────────
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${cfg.meta_phone_number_id}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.meta_access_token}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type:    'individual',
            to:                celular,
            type:              'text',
            text:              { preview_url: false, body: texto },
          }),
        },
      )

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg  = body?.error?.message ?? `Erro Meta API: ${res.status}`
        return { error: msg }
      }

      const metaJson = await res.json().catch(() => ({}))
      waId = (metaJson?.messages?.[0]?.id as string | undefined) ?? null

    } else if (usarTwilio) {
      // ── Envio via Twilio ────────────────────────────────────────────────────
      const sid   = cfg.twilio_account_sid!
      const token = cfg.twilio_auth_token!
      const from  = cfg.twilio_from_number!
      const to    = `whatsapp:+${celular}`

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization:  `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          },
          body: new URLSearchParams({ From: from, To: to, Body: texto }).toString(),
        },
      )

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg  = body?.message ?? `Erro Twilio: ${res.status}`
        return { error: msg }
      }

    } else {
      // ── Fallback: uazapiGO ─────────────────────────────────────────────────
      if (!conexao?.uazapi_instance_token || conexao.status !== 'conectado') {
        return { error: 'WhatsApp não está conectado. Configure Meta API, Twilio ou verifique a conexão.' }
      }

      const uazapiUrl = process.env.UAZAPI_URL?.replace(/\/$/, '')
      if (!uazapiUrl) return { error: 'UAZAPI_URL não configurado.' }

      const res = await fetch(`${uazapiUrl}/send/text`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', token: conexao.uazapi_instance_token },
        body:    JSON.stringify({ number: celular, text: texto }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { error: `Falha ao enviar: ${res.status} ${body}` }
      }
    }

    // Salva mensagem enviada no banco
    const { data: cliente } = await supabase
      .from('clientes')
      .select('id')
      .eq('conta_id', contaId)
      .eq('celular', celular)
      .maybeSingle()

    await supabase.from('mensagens_wa').insert({
      conta_id:       contaId,
      cliente_id:     cliente?.id ?? null,
      atendimento_id: atendimentoId,
      celular,
      direcao: 'out',
      texto,
      lida:    true,
      ...(waId ? { wa_id: waId } : {}),
    })

    if (atendimentoId) {
      await supabase
        .from('atendimentos')
        .update({ ultima_mensagem: texto, ultima_msg_em: new Date().toISOString() })
        .eq('id', atendimentoId)
        .eq('conta_id', contaId)
    }

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/atendimento')
  return { error: null }
}

// ── Enviar template Meta para iniciar conversa (janela expirada) ─────────────

export async function enviarTemplateAction(
  atendimentoId: string,
  celular: string,
  clienteId: string | null,
  templateNome: string,
  templateIdioma: string,
  templateCorpo: string,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    // Credenciais Meta
    const { data: cfg } = await supabase
      .from('configuracoes')
      .select('meta_access_token, meta_phone_number_id, meta_api_ativo')
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!cfg?.meta_api_ativo || !cfg.meta_access_token || !cfg.meta_phone_number_id) {
      return { error: 'Meta API não configurada. Ative em Configurações.' }
    }

    // Nome do cliente
    let nome = 'Cliente'
    if (clienteId) {
      const { data: cli } = await supabase
        .from('clientes').select('nome').eq('id', clienteId).maybeSingle()
      if (cli) nome = (cli as any).nome || 'Cliente'
    }

    // Parcela aberta mais próxima (para valor e data)
    let valor    = ''
    let dataVenc = ''
    if (clienteId) {
      const { data: cobs } = await supabase
        .from('cobrancas')
        .select('id')
        .eq('conta_id', contaId)
        .eq('cliente_id', clienteId)
        .eq('status', 'ativa')

      const cobIds = (cobs ?? []).map((c: any) => c.id as string)

      if (cobIds.length > 0) {
        const { data: parc } = await supabase
          .from('parcelas')
          .select('valor, data_vencimento')
          .eq('conta_id', contaId)
          .in('cobranca_id', cobIds)
          .eq('status', 'aberta')
          .order('data_vencimento', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (parc) {
          valor = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
            .format(Number((parc as any).valor ?? 0))
          const [a, m, d] = ((parc as any).data_vencimento as string).split('-')
          dataVenc = `${d}/${m}/${a}`
        }
      }
    }

    // Determinar quantidade de parâmetros pelo corpo do template
    const maxParam = templateCorpo.includes('{{3}}') ? 3 : templateCorpo.includes('{{2}}') ? 2 : 1
    const parametros = maxParam === 2 ? [nome, valor] : [nome, valor, dataVenc]

    // Enviar via Meta API
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${cfg.meta_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${cfg.meta_access_token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to:   celular,
          type: 'template',
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
      const body = await res.json().catch(() => ({}))
      return { error: (body as any)?.error?.message ?? `Erro Meta API: ${res.status}` }
    }

    const metaJson = await res.json().catch(() => ({}))
    const waId = (metaJson?.messages?.[0]?.id as string | undefined) ?? null

    // Reconstruir texto legível para salvar no histórico
    const texto = templateCorpo
      .replace('{{1}}', parametros[0] ?? '')
      .replace('{{2}}', parametros[1] ?? '')
      .replace('{{3}}', parametros[2] ?? '')

    await supabase.from('mensagens_wa').insert({
      conta_id:       contaId,
      cliente_id:     clienteId,
      atendimento_id: atendimentoId,
      celular,
      direcao:        'out',
      texto,
      lida:           true,
      ...(waId ? { wa_id: waId } : {}),
    })

    await supabase
      .from('atendimentos')
      .update({ ultima_mensagem: texto, ultima_msg_em: new Date().toISOString() })
      .eq('id', atendimentoId)
      .eq('conta_id', contaId)

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/atendimento')
  return { error: null }
}

// ── Marcar mensagens de uma conversa como lidas ───────────────────────────────
export async function marcarLidaAction(celular: string): Promise<void> {
  try {
    const { supabase, contaId } = await getConta()
    await supabase
      .from('mensagens_wa')
      .update({ lida: true })
      .eq('conta_id', contaId)
      .eq('celular', celular)
      .eq('lida', false)
  } catch {
    // não crítico
  }
}

// ── Iniciar nova conversa via template (cria atendimento se não existir) ──────
export async function iniciarConversaAction(
  celular: string,
  clienteId: string | null,
  templateNome: string,
  templateIdioma: string,
  templateCorpo: string,
): Promise<{ error: string | null; atendimentoId?: string }> {
  try {
    const { supabase, contaId } = await getConta()

    // Credenciais Meta
    const { data: cfg } = await supabase
      .from('configuracoes')
      .select('meta_access_token, meta_phone_number_id, meta_api_ativo')
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!cfg?.meta_api_ativo || !cfg.meta_access_token || !cfg.meta_phone_number_id) {
      return { error: 'Meta API não configurada. Ative em Configurações.' }
    }

    // Verificar atendimento aberto existente
    const { data: atendExistente } = await supabase
      .from('atendimentos')
      .select('id')
      .eq('conta_id', contaId)
      .eq('celular', celular)
      .neq('status', 'finalizado')
      .maybeSingle()

    let atendimentoId = (atendExistente as any)?.id as string | undefined
    let criouNovo = false

    if (!atendimentoId) {
      const { data: novoAt, error: atErr } = await supabase
        .from('atendimentos')
        .insert({ conta_id: contaId, celular, cliente_id: clienteId, status: 'aguardando' })
        .select('id')
        .single()

      if (atErr) return { error: atErr.message }
      atendimentoId = (novoAt as any).id as string
      criouNovo = true
    }

    // Buscar nome do cliente para parâmetros
    let nome = 'Cliente'
    let valor = ''
    let dataVenc = ''

    if (clienteId) {
      const { data: cli } = await supabase
        .from('clientes').select('nome').eq('id', clienteId).maybeSingle()
      if (cli) nome = (cli as any).nome || 'Cliente'

      const { data: cobs } = await supabase
        .from('cobrancas').select('id')
        .eq('conta_id', contaId).eq('cliente_id', clienteId).eq('status', 'ativa')

      const cobIds = (cobs ?? []).map((c: any) => c.id as string)
      if (cobIds.length > 0) {
        const { data: parc } = await supabase
          .from('parcelas').select('valor, data_vencimento')
          .eq('conta_id', contaId).in('cobranca_id', cobIds)
          .eq('status', 'aberta').order('data_vencimento', { ascending: true })
          .limit(1).maybeSingle()

        if (parc) {
          valor = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
            .format(Number((parc as any).valor ?? 0))
          const [a, m, d] = ((parc as any).data_vencimento as string).split('-')
          dataVenc = `${d}/${m}/${a}`
        }
      }
    }

    const maxParam   = templateCorpo.includes('{{3}}') ? 3 : templateCorpo.includes('{{2}}') ? 2 : 1
    const parametros = maxParam === 2 ? [nome, valor] : [nome, valor, dataVenc]

    // Enviar template via Meta
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${cfg.meta_phone_number_id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.meta_access_token}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to:   celular,
          type: 'template',
          template: {
            name:     templateNome,
            language: { code: templateIdioma },
            components: [{ type: 'body', parameters: parametros.map(text => ({ type: 'text', text })) }],
          },
        }),
      },
    )

    if (!res.ok) {
      if (criouNovo) {
        await supabase.from('atendimentos').delete().eq('id', atendimentoId)
      }
      const body = await res.json().catch(() => ({}))
      return { error: (body as any)?.error?.message ?? `Erro Meta API: ${res.status}` }
    }

    const texto = templateCorpo
      .replace('{{1}}', parametros[0] ?? '')
      .replace('{{2}}', parametros[1] ?? '')
      .replace('{{3}}', parametros[2] ?? '')

    await supabase.from('mensagens_wa').insert({
      conta_id: contaId, cliente_id: clienteId,
      atendimento_id: atendimentoId, celular,
      direcao: 'out', texto, lida: true,
    })

    await supabase.from('atendimentos')
      .update({ ultima_mensagem: texto, ultima_msg_em: new Date().toISOString() })
      .eq('id', atendimentoId)

    revalidatePath('/atendimento')
    return { error: null, atendimentoId }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// ── Atualizar dados básicos do cliente ────────────────────────────────────────
export async function atualizarClienteAction(
  clienteId: string,
  nome: string,
  sobrenome: string,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()
    const { error } = await supabase
      .from('clientes')
      .update({ nome: nome.trim(), sobrenome: sobrenome.trim() || null })
      .eq('id', clienteId)
      .eq('conta_id', contaId)

    if (error) return { error: error.message }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/atendimento')
  return { error: null }
}
