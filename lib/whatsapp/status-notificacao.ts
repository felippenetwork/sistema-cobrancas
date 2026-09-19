import type { createAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/types/database'

type Supabase = ReturnType<typeof createAdminClient>

// Lembretes ligados a uma parcela em aberto: perdem o sentido se ela foi paga.
// pagamento_confirmado, manual, boasvindas e agendada NÃO entram aqui — são
// enviados de propósito (inclusive depois da baixa) ou não dependem da parcela.
export const TIPOS_LEMBRETE = new Set(['5d', '3d', '2d', '1d', 'dia', 'vencido1d'])

export type VereditoLembrete = 'enviar' | 'cancelar' | 'tentar_depois'

/**
 * Grava a mudança de status de uma notificação verificando o retorno do banco.
 * Com `tentativas` > 1 repete em caso de erro — usar depois de um envio já
 * concluído, quando falhar em gravar deixaria a notificação presa em
 * 'processando' (mensagem enviada, log dizendo que não).
 */
export async function atualizarStatusNotificacao(
  supabase: Supabase,
  contaId: string,
  notifId: string,
  patch: TablesUpdate<'notificacoes_enviadas'>,
  etapa: string,
  tentativas = 1,
): Promise<boolean> {
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    const { error } = await supabase
      .from('notificacoes_enviadas')
      .update(patch)
      .eq('id', notifId)
      .eq('conta_id', contaId)

    if (!error) return true

    console.error('[status-notificacao] update falhou', { notifId, contaId, etapa, tentativa, tentativas, error })
    if (tentativa < tentativas) await new Promise(resolve => setTimeout(resolve, 200 * tentativa))
  }
  return false
}

/**
 * Última checagem antes de mandar um lembrete: a parcela ainda está em aberto?
 * A baixa só cancela notificações em 'fila'; uma que já foi reivindicada
 * ('processando') e está aguardando a simulação de digitação continuaria
 * indo para quem acabou de pagar.
 * Erro de leitura NÃO libera o envio — perder um lembrete é melhor do que
 * cobrar quem já pagou; a notificação volta para a fila e tenta de novo.
 */
export async function vereditoLembrete(
  supabase: Supabase,
  contaId: string,
  notif: { id: string; tipo: string; parcela_id: string | null },
): Promise<VereditoLembrete> {
  if (!TIPOS_LEMBRETE.has(notif.tipo) || !notif.parcela_id) return 'enviar'

  const { data, error } = await supabase
    .from('parcelas')
    .select('status')
    .eq('id', notif.parcela_id)
    .eq('conta_id', contaId)
    .maybeSingle()

  if (error) {
    console.error('[status-notificacao] leitura da parcela falhou', { notifId: notif.id, contaId, error })
    return 'tentar_depois'
  }
  // 'vencida' é derivada na query (migration 0002), mas se um dia for gravada
  // continua sendo "não paga": só 'paga' (ou parcela inexistente) cancela.
  if (!data || data.status === 'paga') return 'cancelar'
  return 'enviar'
}
