'use server'

import { revalidatePath } from 'next/cache'
import { getConta } from '@/lib/conta'

type Result = { error: string | null }

export async function criarCampanhaAction(
  _prev: { error: string | null; id?: string },
  formData: FormData,
): Promise<{ error: string | null; id?: string }> {
  try {
    const { supabase, contaId } = await getConta()

    const nome     = (formData.get('nome')      as string)?.trim()
    const modeloId = (formData.get('modelo_id') as string) || null

    if (!nome) return { error: 'Informe o nome da campanha.' }

    const { data, error } = await supabase
      .from('campanhas_wa')
      .insert({ conta_id: contaId, nome, modelo_id: modeloId, status: 'rascunho' })
      .select('id')
      .single()

    if (error) return { error: error.message }

    revalidatePath('/disparos')
    return { error: null, id: data.id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function adicionarDestinatariosAction(
  campanhaId: string,
  celulares: string[],
): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    // Valida que a campanha pertence à conta
    const { data: campanha } = await supabase
      .from('campanhas_wa')
      .select('id, status')
      .eq('id', campanhaId)
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!campanha) return { error: 'Campanha não encontrada.' }
    if (campanha.status !== 'rascunho') return { error: 'Só é possível editar campanhas em rascunho.' }

    // Busca clientes por celular para vincular cliente_id
    const celularesUnicos = [...new Set(celulares.map(c => c.replace(/\D/g, '').trim()).filter(Boolean))]

    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, celular')
      .eq('conta_id', contaId)
      .in('celular', celularesUnicos)

    const clienteMap = new Map(clientes?.map(c => [c.celular, c.id]) ?? [])

    const destinatarios = celularesUnicos.map(celular => ({
      campanha_id: campanhaId,
      conta_id:    contaId,
      celular,
      cliente_id:  clienteMap.get(celular) ?? null,
      status:      'pendente' as const,
    }))

    const { error: insErr } = await supabase
      .from('campanha_destinatarios')
      .insert(destinatarios)

    if (insErr) return { error: insErr.message }

    // Atualiza contador
    await supabase
      .from('campanhas_wa')
      .update({ total_destinatarios: celularesUnicos.length })
      .eq('id', campanhaId)

    revalidatePath('/disparos')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// Só marca a campanha como 'enviando' — quem processa de verdade é o cron
// /api/cron/whatsapp-uazapi (a cada 1min), respeitando o ritmo anti-ban
// (intervalo 45-80s configurado + 15-20s de simulação de digitação por
// envio). Um clique não dispara mais um loop síncrono aqui: com esse ritmo,
// qualquer campanha um pouco maior estouraria o tempo de execução da Vercel
// e ficaria pela metade. A campanha continua sendo drenada mesmo se esta
// tela for fechada — o progresso aparece pelos totais em campanhas_wa.
export async function enviarCampanhaAction(campanhaId: string): Promise<{
  error: string | null
}> {
  try {
    const { supabase, contaId } = await getConta()

    const { data: campanha } = await supabase
      .from('campanhas_wa')
      .select('id, status, modelo_id, total_destinatarios, modelos_wa(corpo, status)')
      .eq('id', campanhaId)
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!campanha) return { error: 'Campanha não encontrada.' }
    if (!['rascunho', 'agendada'].includes(campanha.status)) {
      return { error: 'Campanha já foi enviada ou está em andamento.' }
    }

    const modelo = (campanha as any).modelos_wa
    if (!modelo?.corpo) return { error: 'Selecione um template antes de enviar.' }

    if (!campanha.total_destinatarios) return { error: 'Nenhum destinatário cadastrado.' }

    const { data: conexao } = await supabase
      .from('conexoes')
      .select('uazapi_instance_token, status')
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!conexao?.uazapi_instance_token || conexao.status !== 'conectado') {
      return { error: 'WhatsApp não está conectado. Verifique a conexão.' }
    }

    await supabase
      .from('campanhas_wa')
      .update({ status: 'enviando', iniciado_em: new Date().toISOString() })
      .eq('id', campanhaId)

    revalidatePath('/disparos')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function cancelarCampanhaAction(campanhaId: string): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    const { error } = await supabase
      .from('campanhas_wa')
      .update({ status: 'cancelada' })
      .eq('id', campanhaId)
      .eq('conta_id', contaId)
      .in('status', ['rascunho', 'agendada'])

    if (error) return { error: error.message }

    revalidatePath('/disparos')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
