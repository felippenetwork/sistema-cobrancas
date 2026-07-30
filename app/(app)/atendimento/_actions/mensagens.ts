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

const TEMPLATES_META: Record<string, { nome: string; idioma: string; params: 2 | 3; corpo: string }> = {
  '5d': {
    nome: 'cobranca_5d', idioma: 'pt_BR', params: 3,
    corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence em *5 dias* ({{3}}). Para dúvidas, responda esta mensagem.',
  },
  '3d': {
    nome: 'cobranca_3d', idioma: 'en', params: 3,
    corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence em *3 dias* ({{3}}). Para dúvidas, responda esta mensagem.',
  },
  '2d': {
    nome: 'cobranca_2d', idioma: 'pt_BR', params: 3,
    corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence em *2 dias* ({{3}}). Não se esqueça de pagar!',
  },
  '1d': {
    nome: 'cobranca_1d', idioma: 'pt_BR', params: 3,
    corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence *amanhã* ({{3}}). Pague hoje para evitar juros.',
  },
  'dia': {
    nome: 'cobranca_dia', idioma: 'pt_BR', params: 3,
    corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence *hoje* ({{3}}). Pague agora para evitar juros.',
  },
  'vencido1d': {
    nome: 'cobranca_vencido', idioma: 'pt_BR', params: 3,
    corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* venceu ontem ({{3}}). Regularize o quanto antes para evitar cobrança adicional.',
  },
  'pagamento_confirmado': {
    nome: 'pagamento_confirmado', idioma: 'pt_BR', params: 2,
    corpo: '🥳 Renovado com sucesso! Muito obrigado *{{1}}*! Recebemos seu pagamento de *{{2}}*. Qualquer dúvida só me enviar mensagem.',
  },
  'boasvindas': {
    nome: 'boasvindas', idioma: 'pt_BR', params: 3,
    corpo: '🎉 Ativado com sucesso! Muito obrigado *{{1}}*! Sua fatura de *{{2}}* vence em *{{3}}*. Estaremos sempre à disposição!',
  },
}

export async function enviarTemplateAction(
  atendimentoId: string,
  celular: string,
  clienteId: string | null,
  templateTipo: string,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    const tmpl = TEMPLATES_META[templateTipo]
    if (!tmpl) return { error: 'Template inválido.' }

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
    let valor = ''
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

    const parametros = tmpl.params === 2 ? [nome, valor] : [nome, valor, dataVenc]

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
            name:     tmpl.nome,
            language: { code: tmpl.idioma },
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

    // Reconstruir texto legível para salvar no histórico
    const texto = tmpl.corpo
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
