import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DisparosClient } from './_components/disparos-client'

export const dynamic = 'force-dynamic'

export default async function DisparosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: conta } = await supabase
    .from('contas')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (!conta) redirect('/login')
  const contaId = conta.id

  const [{ data: campanhas }, { data: modelos }, { data: clientes }] = await Promise.all([
    supabase
      .from('campanhas_wa')
      .select(`
        id, nome, status, tipo, total_destinatarios, total_enviados, total_falhas, total_pulados,
        agendado_para, iniciado_em, concluido_em, criado_em,
        janela_inicio, janela_fim, prog_inicio, prog_maximo, prog_dia, prog_planejado_em,
        registrar_enviados, excluir_ja_enviados,
        modelos_wa(nome, status)
      `)
      .eq('conta_id', contaId)
      .order('criado_em', { ascending: false })
      .limit(50),
    supabase
      .from('modelos_wa')
      .select('id, nome, status, corpo')
      .eq('conta_id', contaId)
      .in('status', ['aprovado', 'rascunho'])
      .order('nome'),
    supabase
      .from('clientes')
      .select('id, nome, sobrenome, celular')
      .eq('conta_id', contaId)
      .is('deleted_at', null)
      .order('nome')
      .limit(500),
  ])

  return (
    <DisparosClient
      campanhas={(campanhas as any[]) ?? []}
      modelos={modelos ?? []}
      clientes={clientes ?? []}
    />
  )
}
