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

    const { data: conexao } = await supabase
      .from('conexoes')
      .select('uazapi_instance_token, status')
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!conexao?.uazapi_instance_token || conexao.status !== 'conectado') {
      return { error: 'WhatsApp não está conectado. Verifique a conexão.' }
    }

    const uazapiUrl = process.env.UAZAPI_URL?.replace(/\/$/, '')
    if (!uazapiUrl) return { error: 'Configuração UAZAPI_URL ausente.' }

    const res = await fetch(`${uazapiUrl}/send/text`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', token: conexao.uazapi_instance_token },
      body:    JSON.stringify({ number: celular, text: texto }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { error: `Falha ao enviar: ${res.status} ${body}` }
    }

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

    // Atualiza ultima_mensagem do atendimento
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
