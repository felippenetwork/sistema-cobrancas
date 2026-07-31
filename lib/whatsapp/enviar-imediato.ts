import { createAdminClient } from '@/lib/supabase/admin'
import { encontrarOuCriarAtendimento } from '@/lib/atendimento/encontrar-ou-criar'

const META_TEMPLATES: Record<string, { nome: string; idioma: string; params: 2 | 3; corpo: string }> = {
  '5d':                 { nome: 'cobranca_5d',           idioma: 'pt_BR', params: 3, corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence em *5 dias* ({{3}}). Para dúvidas, responda esta mensagem.' },
  '3d':                 { nome: 'cobranca_3d',           idioma: 'en',    params: 3, corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence em *3 dias* ({{3}}). Para dúvidas, responda esta mensagem.' },
  '2d':                 { nome: 'cobranca_2d',           idioma: 'pt_BR', params: 3, corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence em *2 dias* ({{3}}). Não se esqueça de pagar!' },
  '1d':                 { nome: 'cobranca_1d',           idioma: 'pt_BR', params: 3, corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence *amanhã* ({{3}}). Pague hoje para evitar juros.' },
  'dia':                { nome: 'cobranca_dia',          idioma: 'pt_BR', params: 3, corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* vence *hoje* ({{3}}). Pague agora para evitar juros.' },
  'vencido1d':          { nome: 'cobranca_vencido',      idioma: 'pt_BR', params: 3, corpo: 'Olá, *{{1}}*! Sua fatura de *{{2}}* venceu ontem ({{3}}). Regularize o quanto antes para evitar cobrança adicional.' },
  'pagamento_confirmado': { nome: 'pagamento_confirmado', idioma: 'pt_BR', params: 2, corpo: '🥳 Renovado com sucesso 🥳\n\nMuito obrigado Sr.(Sra.) *{{1}}*! Recebemos seu pagamento de *{{2}}*.\n\n🥳 Qualquer dúvida ou problema só me enviar mensagem. 🥳' },
  'boasvindas':         { nome: 'boasvindas',            idioma: 'pt_BR', params: 3, corpo: '🎉 Ativado com sucesso 🎉\n\nMuito obrigado Sr.(Sra.) *{{1}}*! Sua primeira fatura de *{{2}}* vence em *{{3}}*.\n\n🤩 Estaremos sempre à disposição para melhor lhe atender. 🤩' },
}

function reconstruir(corpo: string, p: string[]): string {
  return corpo.replace('{{1}}', p[0] ?? '').replace('{{2}}', p[1] ?? '').replace('{{3}}', p[2] ?? '')
}

function formatarMoeda(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function formatarData(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

/**
 * Tenta enviar uma notificação WhatsApp imediatamente via Meta Cloud API.
 * Se bem-sucedido: atualiza notificacoes_enviadas para 'enviado' e registra em mensagens_wa.
 * Se falhar: mantém 'fila' para o cron processar como retry.
 * Retorna true se enviou com sucesso.
 */
export async function enviarWhatsAppImediato(
  contaId: string,
  notifId: string,
  parcelaId: string | null,
  cobrancaId: string | null,
  clienteId: string,
  tipo: string,
): Promise<boolean> {
  const supabase = createAdminClient()

  // Credenciais Meta
  const { data: cfg } = await supabase
    .from('configuracoes')
    .select('meta_api_ativo, meta_access_token, meta_phone_number_id')
    .eq('conta_id', contaId)
    .maybeSingle()

  if (!cfg?.meta_api_ativo || !cfg.meta_access_token || !cfg.meta_phone_number_id) {
    return false
  }

  const tmpl = META_TEMPLATES[tipo]
  if (!tmpl) return false

  // Dados do cliente
  const { data: cliente } = await supabase
    .from('clientes')
    .select('celular, nome, deleted_at')
    .eq('id', clienteId)
    .maybeSingle()

  if (!cliente || (cliente as any).deleted_at || !(cliente as any).celular) return false
  const celular = (cliente as any).celular as string
  const nome    = ((cliente as any).nome as string) || 'Cliente'

  // Resolver parcela
  let pid = parcelaId
  if (!pid && cobrancaId) {
    const { data: p } = await supabase
      .from('parcelas').select('id')
      .eq('cobranca_id', cobrancaId)
      .order('numero', { ascending: true }).limit(1).maybeSingle()
    pid = (p as any)?.id ?? null
  }

  let valor = ''
  let data  = ''
  if (pid) {
    const { data: parcela } = await supabase
      .from('parcelas').select('valor, data_vencimento').eq('id', pid).maybeSingle()
    if (parcela) {
      valor = formatarMoeda(Number((parcela as any).valor ?? 0))
      data  = formatarData((parcela as any).data_vencimento ?? '')
    }
  }

  const parametros    = tmpl.params === 2 ? [nome, valor] : [nome, valor, data]
  const textoMensagem = reconstruir(tmpl.corpo, parametros)

  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${cfg.meta_phone_number_id}/messages`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.meta_access_token}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to:   celular,
          type: 'template',
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
      throw new Error((err as any)?.error?.message ?? `Meta erro ${res.status}`)
    }

    const agora = new Date().toISOString()

    await supabase.from('notificacoes_enviadas').update({
      status:         'enviado',
      mensagem_final: textoMensagem,
      enviado_em:     agora,
    }).eq('id', notifId)

    const atendimentoId = await encontrarOuCriarAtendimento(
      supabase, contaId, celular, clienteId, textoMensagem,
    )

    const { error: mwaErr } = await supabase.from('mensagens_wa').insert({
      conta_id:       contaId,
      cliente_id:     clienteId,
      atendimento_id: atendimentoId,
      celular,
      direcao:        'out',
      texto:          textoMensagem,
      lida:           true,
    })
    if (mwaErr) console.error('[enviarWhatsAppImediato] mensagens_wa', mwaErr)

    return true
  } catch (err: any) {
    console.error('[enviarWhatsAppImediato] falha ao enviar', tipo, err?.message)
    return false
  }
}
