import { createAdminClient } from '@/lib/supabase/admin'
import { encontrarOuCriarAtendimento } from '@/lib/atendimento/encontrar-ou-criar'
import { atualizarStatusNotificacao } from '@/lib/whatsapp/status-notificacao'
import { resolverVariaveis, resolverVariaveisLeves, VariaveisIndisponiveisError } from '@/lib/whatsapp/resolver-variaveis'
import { sendText, UazapiRateLimitError } from '@/lib/uazapi'
import type { NotifTipo } from '@/lib/notificacao/tipos'

/**
 * Tenta enviar uma notificação WhatsApp imediatamente via uazapi (QR Code),
 * se a conta estiver conectada. Se bem-sucedido: atualiza notificacoes_enviadas
 * para 'enviado' e registra em mensagens_wa. Se não puder enviar por aqui
 * (desconectada, template ausente, cliente inválido, falha no envio): a
 * notificação volta/permanece em 'fila' para o cron processar depois.
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

  // Conexão lida ANTES de reivindicar a notificação (reivindicar primeiro e
  // desistir depois deixava a confirmação de pagamento / cobrança manual
  // presa em 'processando' para sempre, já que o cron só lê 'fila').
  const { data: conexao } = await supabase
    .from('conexoes')
    .select('uazapi_instance_token, status')
    .eq('conta_id', contaId)
    .maybeSingle()

  if (conexao?.status !== 'conectado' || !conexao.uazapi_instance_token) return false

  // Claim atômico: só processa se a notificação ainda estiver em 'fila'.
  // Evita envio duplo quando o cron e o envio imediato disputam a mesma notificação.
  const { data: claimed, error: claimErr } = await supabase
    .from('notificacoes_enviadas')
    .update({ status: 'processando' })
    .eq('id', notifId)
    .eq('conta_id', contaId)
    .eq('status', 'fila')
    .select('id')
    .maybeSingle()

  if (claimErr) {
    console.error('[enviarWhatsAppImediato] claim falhou', { notifId, contaId, claimErr })
    return false
  }
  if (!claimed?.id) {
    console.log('[enviarWhatsAppImediato] notificação já reivindicada por outro processo', notifId)
    return false
  }

  // Daqui até o envio de fato, qualquer saída sem enviar devolve a notificação
  // para 'fila' — o cron decide o destino final (cancelar, falhar, reenviar).
  const liberar = (etapa: string) =>
    atualizarStatusNotificacao(supabase, contaId, notifId, { status: 'fila' }, etapa)

  const { data: cliente } = await supabase
    .from('clientes')
    .select('celular, nome, deleted_at')
    .eq('id', clienteId)
    .eq('conta_id', contaId)
    .maybeSingle()

  if (!cliente || cliente.deleted_at || !cliente.celular) {
    await liberar('cliente_invalido')
    return false
  }
  const celular = cliente.celular

  // Mesmo template e resolução de variáveis do cron uazapi
  // (notificacoes_config.template_whatsapp + #VARS#).
  const { data: cfgNotif } = await supabase
    .from('notificacoes_config')
    .select('template_whatsapp')
    .eq('conta_id', contaId)
    .eq('tipo', tipo as NotifTipo)
    .maybeSingle()

  const template = cfgNotif?.template_whatsapp?.trim()
  if (!template) {
    await liberar('sem_template')
    return false
  }

  let pid = parcelaId
  if (!pid && cobrancaId) {
    const { data: p } = await supabase
      .from('parcelas').select('id')
      .eq('cobranca_id', cobrancaId).eq('conta_id', contaId)
      .order('numero', { ascending: true }).limit(1).maybeSingle()
    pid = p?.id ?? null
  }

  let textoMensagem: string
  try {
    textoMensagem = tipo === 'agendada'
      ? await resolverVariaveisLeves(supabase, { contaId, clienteId, template })
      : await resolverVariaveis(supabase, { contaId, parcelaId: pid as string, clienteId, template, cobrancaId })
  } catch (err) {
    if (err instanceof VariaveisIndisponiveisError && err.motivo === 'nao_encontrado') {
      await liberar('dados_inexistentes')
    } else {
      console.error('[enviarWhatsAppImediato] variáveis indisponíveis', { notifId, contaId, err })
      await liberar('variaveis_indisponiveis')
    }
    return false
  }

  try {
    await sendText(conexao.uazapi_instance_token, celular, textoMensagem)
  } catch (err) {
    if (err instanceof UazapiRateLimitError) {
      await liberar('rate_limited')
    } else {
      console.error('[enviarWhatsAppImediato] uazapi recusou o envio', { notifId, contaId, err })
      await liberar('envio_falhou')
    }
    return false
  }

  // ── A partir daqui a mensagem JÁ FOI enviada. Nada abaixo pode devolver a
  // notificação para 'fila' — o cron reenviaria e o cliente receberia 2x.
  const gravado = await atualizarStatusNotificacao(
    supabase, contaId, notifId,
    { status: 'enviado', mensagem_final: textoMensagem, enviado_em: new Date().toISOString() },
    'pos_envio', 3,
  )
  if (!gravado) {
    console.error('[enviarWhatsAppImediato] MENSAGEM ENVIADA MAS STATUS NÃO GRAVADO — conferir manualmente', { notifId, contaId })
  }

  try {
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
  } catch (err) {
    console.error('[enviarWhatsAppImediato] histórico de atendimento falhou (mensagem já enviada)', { notifId, contaId, err })
  }

  return true
}
