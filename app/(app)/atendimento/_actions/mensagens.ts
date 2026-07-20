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

    // Busca credenciais Meta + conexão uazapiGO em paralelo
    const [{ data: cfg }, { data: conexao }] = await Promise.all([
      supabase
        .from('configuracoes')
        .select('meta_access_token, meta_phone_number_id')
        .eq('conta_id', contaId)
        .maybeSingle(),
      supabase
        .from('conexoes')
        .select('uazapi_instance_token, status')
        .eq('conta_id', contaId)
        .maybeSingle(),
    ])

    const usarMeta = !!(cfg?.meta_access_token && cfg?.meta_phone_number_id)

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

    } else {
      // ── Fallback: uazapiGO ─────────────────────────────────────────────────
      if (!conexao?.uazapi_instance_token || conexao.status !== 'conectado') {
        return { error: 'WhatsApp não está conectado. Configure a API Meta ou verifique a conexão.' }
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
