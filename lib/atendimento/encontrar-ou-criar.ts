import { createAdminClient } from '@/lib/supabase/admin'
import { celularVariantes } from '@/lib/utils/celular'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Encontra atendimento aberto para o celular ou cria um novo.
 * Segue o mesmo padrão do webhook (incluindo tratamento de race condition 23505).
 * Atualiza ultima_mensagem/ultima_msg_em quando o atendimento já existe.
 */
export async function encontrarOuCriarAtendimento(
  supabase: AdminClient,
  contaId: string,
  celular: string,
  clienteId: string | null,
  ultimaMensagem: string,
): Promise<string | null> {
  const agora = new Date().toISOString()

  // Busca por variantes para evitar duplicatas quando número tem/não tem 9 transitório
  const { data: existing } = await supabase
    .from('atendimentos')
    .select('id, cliente_id')
    .eq('conta_id', contaId)
    .in('celular', celularVariantes(celular))
    .neq('status', 'finalizado')
    .maybeSingle()

  if (existing) {
    const vincularCliente = clienteId && !(existing as any).cliente_id
    await supabase.from('atendimentos').update({
      ultima_mensagem: ultimaMensagem,
      ultima_msg_em:   agora,
      ...(vincularCliente ? { cliente_id: clienteId } : {}),
    } as any).eq('id', (existing as any).id)
    return (existing as any).id
  }

  // Tenta criar novo atendimento
  const { data: deptGeral } = await supabase
    .from('departamentos')
    .select('id')
    .eq('conta_id', contaId)
    .eq('nome', 'Geral')
    .maybeSingle()

  const { data: novo, error } = await supabase
    .from('atendimentos')
    .insert({
      conta_id:        contaId,
      celular,
      cliente_id:      clienteId,
      departamento_id: (deptGeral as any)?.id ?? null,
      status:          'aguardando',
      ultima_mensagem: ultimaMensagem,
      ultima_msg_em:   agora,
    })
    .select('id')
    .single()

  if (error) {
    // Race condition: outro processo criou o atendimento ao mesmo tempo
    if (error.code === '23505') {
      const { data: race } = await supabase
        .from('atendimentos')
        .select('id')
        .eq('conta_id', contaId)
        .eq('celular', celular)
        .neq('status', 'finalizado')
        .maybeSingle()
      return (race as any)?.id ?? null
    }
    console.error('[encontrarOuCriarAtendimento]', error, { contaId, celular })
    return null
  }

  return (novo as any)?.id ?? null
}
