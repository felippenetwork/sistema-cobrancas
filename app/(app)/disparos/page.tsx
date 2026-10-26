import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { passosDoModelo } from '@/lib/disparo/passos'
import { lerAcoes } from '@/lib/disparo/acoes'
import { dataSP, instanteSP } from '@/lib/disparo/progressivo'
import { DisparosClient } from './_components/disparos-client'

export const dynamic = 'force-dynamic'
// As ações desta página leem grupos na uazapi (/group/list), que leva dezenas de segundos em grupos grandes.
export const maxDuration = 60

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

  const [{ data: campanhas }, { data: modelos }, { data: clientes }, { data: fluxos }] = await Promise.all([
    supabase
      .from('campanhas_wa')
      .select(`
        id, nome, status, tipo, total_destinatarios, total_enviados, total_falhas, total_pulados,
        agendado_para, iniciado_em, concluido_em, criado_em,
        janela_inicio, janela_fim, prog_inicio, prog_maximo, prog_dia, prog_planejado_em,
        registrar_enviados, excluir_ja_enviados, passos, etiqueta_adicionar_nome, etiqueta_remover_nome, acoes,
        modelos_wa(nome, status)
      `)
      .eq('conta_id', contaId)
      .order('criado_em', { ascending: false })
      .limit(50),
    supabase
      .from('modelos_wa')
      .select('id, nome, corpo, passos, acoes')
      .eq('conta_id', contaId)
      .order('nome'),
    supabase
      .from('clientes')
      .select('id, nome, sobrenome, celular')
      .eq('conta_id', contaId)
      .is('deleted_at', null)
      .order('nome')
      .limit(500),
    supabase
      .from('bot_fluxos')
      .select('id, nome, ativo')
      .eq('conta_id', contaId)
      .order('nome'),
  ])

  // Horários de hoje dos progressivos em andamento: o que já saiu e o que está agendado.
  const progressivas = (campanhas ?? []).filter(c => c.tipo === 'progressivo' && ['enviando', 'pausada'].includes(c.status)).map(c => c.id)
  const agenda: Record<string, { hora: string; enviado: boolean }[]> = {}
  if (progressivas.length) {
    const inicioHoje = instanteSP(dataSP(), '00:00').toISOString()
    const [agendados, enviados] = await Promise.all([
      supabase.from('campanha_destinatarios').select('campanha_id, agendado_para')
        .eq('conta_id', contaId).in('campanha_id', progressivas).eq('status', 'pendente').not('agendado_para', 'is', null)
        .order('agendado_para', { ascending: true }).limit(1000),
      supabase.from('campanha_destinatarios').select('campanha_id, enviado_em')
        .eq('conta_id', contaId).in('campanha_id', progressivas).eq('status', 'enviado').gte('enviado_em', inicioHoje)
        .order('enviado_em', { ascending: true }).limit(1000),
    ])
    if (agendados.error || enviados.error) console.error('[disparos] leitura da agenda falhou', { contaId, erro: agendados.error ?? enviados.error })
    for (const d of enviados.data ?? []) (agenda[d.campanha_id] ??= []).push({ hora: d.enviado_em as string, enviado: true })
    for (const d of agendados.data ?? []) (agenda[d.campanha_id] ??= []).push({ hora: d.agendado_para as string, enviado: false })
  }

  return (
    <DisparosClient
      agenda={agenda}
      campanhas={(campanhas as any[]) ?? []}
      modelos={(modelos ?? []).flatMap(m => {
        // Só modelos com mensagem válida aparecem para escolha.
        const passos = passosDoModelo(m)
        return passos ? [{ id: m.id, nome: m.nome, passos, acoes: lerAcoes(m.acoes) }] : []
      })}
      clientes={clientes ?? []}
      fluxos={fluxos ?? []}
    />
  )
}
