'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { resolverVariaveis, resolverVariaveisLeves, VariaveisIndisponiveisError } from '@/lib/whatsapp/resolver-variaveis'
import { atualizarStatusNotificacao } from '@/lib/whatsapp/status-notificacao'
import { sendText, UazapiRateLimitError } from '@/lib/uazapi'

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

// Força o envio imediato via uazapi.
export async function forcarEnvioAction(id: string): Promise<{ error?: string }> {
  const { contaId } = await getContaId()
  const admin = createAdminClient()

  // Status de antes do clique: o claim abaixo marca a notificação como 'cancelado' enquanto
  // trabalha. Sem lembrar o original, qualquer falha deixava um lembrete que estava na
  // 'fila' CANCELADO em silêncio (e um cancelado de propósito virava 'fila' e saía sozinho).
  const { data: atual } = await admin
    .from('notificacoes_enviadas')
    .select('status')
    .eq('id', id)
    .eq('conta_id', contaId)
    .eq('canal', 'whatsapp')
    .in('status', ['fila', 'cancelado'])
    .maybeSingle()
  if (!atual) return { error: 'Notificação não encontrada.' }
  const statusAnterior = atual.status as 'fila' | 'cancelado'

  // ── 1. Claim atômico ─────────────────────────────────────────────────────
  const { data: notif } = await admin
    .from('notificacoes_enviadas')
    .update({ status: 'cancelado' })
    .eq('id', id)
    .eq('conta_id', contaId)
    .eq('canal', 'whatsapp')
    .eq('status', statusAnterior)
    .select('id, parcela_id, cobranca_id, cliente_id, tipo, mensagem_final')
    .maybeSingle()

  if (!notif) return { error: 'Notificação não encontrada.' }

  // Toda saída com erro depois do claim devolve a notificação ao status original.
  const falhar = async (mensagem: string): Promise<{ error: string }> => {
    await atualizarStatusNotificacao(admin, contaId, id, { status: statusAnterior }, 'forcar_envio_falhou')
    return { error: mensagem }
  }

  // ── 2. Buscar cliente ────────────────────────────────────────────────────
  const { data: cliente } = await admin
    .from('clientes')
    .select('celular, nome, sobrenome, deleted_at')
    .eq('id', notif.cliente_id as string)
    .eq('conta_id', contaId)
    .maybeSingle()

  if (!cliente || cliente.deleted_at) return falhar('Cliente não encontrado ou excluído.')
  const celular = cliente.celular
  if (!celular) return falhar('Cliente sem celular cadastrado.')

  // ── 3. Montar a mensagem ──────────────────────────────────────────────────
  let mensagem: string

  const erroVariaveis = (err: unknown) => falhar(
    err instanceof VariaveisIndisponiveisError && err.motivo === 'nao_encontrado'
      ? 'Parcela ou cliente não encontrado para montar a mensagem.'
      : 'Não foi possível montar a mensagem agora. Tente novamente.',
  )

  if (notif.tipo === 'agendada') {
    const corpo = ((notif.mensagem_final as string) ?? '').trim()
    if (!corpo) return falhar('Mensagem não configurada.')
    try {
      mensagem = await resolverVariaveisLeves(admin, {
        contaId,
        clienteId: notif.cliente_id as string,
        template:  corpo,
      })
    } catch (err) {
      return erroVariaveis(err)
    }
  } else {
    const { data: cfgNotif } = await admin
      .from('notificacoes_config')
      .select('template_whatsapp')
      .eq('conta_id', contaId)
      .eq('tipo', notif.tipo)
      .maybeSingle()

    const template = cfgNotif?.template_whatsapp?.trim()
    if (!template) return falhar('Template WhatsApp não configurado para este tipo.')

    let parcelaId = notif.parcela_id as string | null
    if (!parcelaId && notif.cobranca_id) {
      const { data: p } = await admin
        .from('parcelas')
        .select('id')
        .eq('cobranca_id', notif.cobranca_id as string)
        .eq('conta_id', contaId)
        .order('numero', { ascending: true })
        .limit(1)
        .maybeSingle()
      parcelaId = p?.id ?? null
    }
    if (!parcelaId) return falhar('Parcela não encontrada para montar a mensagem.')

    try {
      mensagem = await resolverVariaveis(admin, {
        contaId,
        parcelaId,
        clienteId:  notif.cliente_id as string,
        template,
        cobrancaId: notif.cobranca_id as string | null,
      })
    } catch (err) {
      return erroVariaveis(err)
    }
  }

  // Fonte de verdade: conexoes.status/uazapi_instance_token — a MESMA que o
  // cron usa pra decidir quem está elegível para enviar (não uma checagem ao
  // vivo via /instance/all). Achado real (2026-09-19, dois bugs seguidos
  // nesse caminho): a versão anterior fazia sua própria checagem contra a API
  // de administração da uazapi (getAllInstances/instName), que depende do
  // UAZAPI_ADMIN_TOKEN — uma credencial SEPARADA do token da instância, só
  // usada para listar/gerenciar instâncias. Esse token estava vazio em
  // produção, então "Forçar" sempre reportava "desconectado" mesmo com o
  // WhatsApp genuinamente conectado (quem autentica o ENVIO em si é o token
  // da própria instância, já salvo em conexoes — nunca precisou do admin
  // token). Ler direto da mesma coluna que o cron e a tela /conexao usam
  // elimina essa dependência e mantém "Forçar" sempre consistente com o que
  // o dono vê na tela de conexão.
  const { data: conexao } = await admin
    .from('conexoes')
    .select('uazapi_instance_token, status')
    .eq('conta_id', contaId)
    .maybeSingle()

  if (!conexao?.uazapi_instance_token || conexao.status !== 'conectado') {
    return falhar('WhatsApp desconectado. Reconecte em Conexão WA e tente novamente.')
  }

  try {
    await sendText(conexao.uazapi_instance_token, celular, mensagem)
  } catch (err) {
    if (err instanceof UazapiRateLimitError) {
      return falhar('Servidor WhatsApp ocupado agora (rate limit). Tente novamente em alguns segundos.')
    }
    // Detalhe da uazapi vai para o log do servidor, não para a tela (SEG-M3).
    console.error('[forcarEnvio] uazapi recusou o envio', { id, contaId, err })
    return falhar('Falha ao enviar pela uazapi (rede ou recusa do provedor). Tente novamente.')
  }

  // A mensagem JÁ FOI enviada: gravar o status com repetição, sem nunca devolver o original.
  await atualizarStatusNotificacao(
    admin, contaId, id,
    { status: 'enviado', mensagem_final: mensagem, enviado_em: new Date().toISOString() },
    'forcar_envio_pos_envio', 3,
  )

  revalidatePath('/log')
  return {}
}

// Resolução de variáveis (#VALOR# #NOME# #PIX# etc.) vive em
// lib/whatsapp/resolver-variaveis.ts — compartilhada com o cron uazapi.
// O worker mantém cópia própria em worker/src/variaveis.ts (processo separado).
