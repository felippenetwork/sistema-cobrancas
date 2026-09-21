'use server'

import { revalidatePath } from 'next/cache'
import { getConta } from '@/lib/conta'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendText, UazapiRateLimitError } from '@/lib/uazapi'

export type ActionState = { error: string | null }

// ── Enviar resposta ao cliente ────────────────────────────────────────────────
export async function enviarRespostaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()
    const admin = createAdminClient()

    const celular       = (formData.get('celular')        as string)?.trim()
    const texto         = (formData.get('texto')          as string)?.trim()
    const atendimentoId = (formData.get('atendimento_id') as string | null) ?? null

    if (!celular) return { error: 'Celular inválido.' }
    if (!texto)   return { error: 'Mensagem vazia.' }

    // Conexão lida com service role: getConta() já confirmou que o usuário
    // pertence à conta, mas desde a migration 0033 um atendente não lê
    // 'configuracoes'/'conexoes' diretamente (SEG-N4) — enviar mensagem
    // continua sendo tarefa dele.
    const { data: conexao } = await admin
      .from('conexoes')
      .select('uazapi_instance_token, status')
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!conexao?.uazapi_instance_token || conexao.status !== 'conectado') {
      return { error: 'WhatsApp não está conectado. Verifique a conexão em Conexão WA.' }
    }

    try {
      await sendText(conexao.uazapi_instance_token, celular, texto)
    } catch (err) {
      if (err instanceof UazapiRateLimitError) {
        return { error: 'Servidor WhatsApp ocupado agora (rate limit). Tente novamente em alguns segundos.' }
      }
      // Detalhe da uazapi vai para o log do servidor, não para a tela (SEG-M3).
      console.error('[enviarResposta] uazapi recusou o envio', { contaId, err })
      return { error: 'Falha ao enviar pela uazapi (rede ou recusa do provedor). Tente novamente.' }
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

// ── Iniciar nova conversa (cria o atendimento se não existir) ─────────────────
// Sem Meta não existe "janela de 24h"/template pra reabrir conversa — a uazapi
// manda texto livre a qualquer momento, igual enviarRespostaAction.
export async function iniciarConversaAction(
  celular: string,
  clienteId: string | null,
  texto: string,
): Promise<{ error: string | null; atendimentoId?: string }> {
  try {
    const { supabase, contaId } = await getConta()
    const admin = createAdminClient()

    const { data: conexao } = await admin
      .from('conexoes')
      .select('uazapi_instance_token, status')
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!conexao?.uazapi_instance_token || conexao.status !== 'conectado') {
      return { error: 'WhatsApp não está conectado. Verifique a conexão em Conexão WA.' }
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

    try {
      await sendText(conexao.uazapi_instance_token, celular, texto)
    } catch (err) {
      if (criouNovo) await supabase.from('atendimentos').delete().eq('id', atendimentoId)
      if (err instanceof UazapiRateLimitError) {
        return { error: 'Servidor WhatsApp ocupado agora (rate limit). Tente novamente em alguns segundos.' }
      }
      console.error('[iniciarConversa] uazapi recusou o envio', { contaId, err })
      return { error: 'Falha ao enviar pela uazapi (rede ou recusa do provedor). Tente novamente.' }
    }

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
