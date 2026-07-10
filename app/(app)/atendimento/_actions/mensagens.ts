'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type ActionState = { error: string | null }

async function getConta() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) throw new Error('Conta não encontrada.')
  return { supabase, contaId: conta.id as string }
}

// ── Enviar resposta ao cliente ────────────────────────────────────────────────
export async function enviarRespostaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    const celular = (formData.get('celular') as string)?.trim()
    const texto   = (formData.get('texto')   as string)?.trim()

    if (!celular) return { error: 'Celular inválido.' }
    if (!texto)   return { error: 'Mensagem vazia.' }

    // Buscar token uazapi da instância conectada
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

    // Enviar via uazapi
    const res = await fetch(`${uazapiUrl}/send/text`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', token: conexao.uazapi_instance_token },
      body:    JSON.stringify({ number: celular, text: texto }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { error: `Falha ao enviar: ${res.status} ${body}` }
    }

    // Salvar mensagem enviada no histórico
    const { data: cliente } = await supabase
      .from('clientes')
      .select('id')
      .eq('conta_id', contaId)
      .eq('celular', celular)
      .maybeSingle()

    await supabase.from('mensagens_wa').insert({
      conta_id:   contaId,
      cliente_id: cliente?.id ?? null,
      celular,
      direcao:    'out',
      texto,
      lida:       true,
    })

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/atendimento')
  return { error: null }
}

// ── Marcar conversa como lida ─────────────────────────────────────────────────
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
