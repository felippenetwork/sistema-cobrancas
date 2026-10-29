import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { passosDoModelo, resumoDosPassos, schemaPassos } from '@/lib/disparo/passos'
import { AgendamentosClient, type LinhaAgendamento } from './_components/agendamentos-client'

export const metadata = { title: 'Agendamentos' }
export const dynamic = 'force-dynamic'

export default async function AgendamentosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: conta } = await supabase.from('contas').select('id').eq('owner_user_id', user.id).maybeSingle()
  if (!conta) redirect('/login')
  const contaId = conta.id

  const [clientes, modelos, envios, antigos] = await Promise.all([
    supabase.from('clientes').select('id, nome, sobrenome, celular')
      .eq('conta_id', contaId).is('deleted_at', null).not('celular', 'is', null).order('nome').limit(2000),
    supabase.from('modelos_wa').select('id, nome, corpo, passos').eq('conta_id', contaId).order('nome'),
    supabase.from('envios_agendados').select('id, celular, nome, passos, agendado_para, status, erro, aviso, enviado_em, clientes(nome, sobrenome)')
      .eq('conta_id', contaId).order('agendado_para', { ascending: false }).limit(200),
    // Mensagens avulsas da tela antiga (só clientes, só texto) — continuam saindo pelo cron.
    supabase.from('notificacoes_enviadas').select('id, status, mensagem_final, agendado_para, enviado_em, clientes(nome, sobrenome, celular)')
      .eq('conta_id', contaId).eq('tipo', 'agendada').eq('canal', 'whatsapp').order('agendado_para', { ascending: false }).limit(100),
  ])

  const erro = clientes.error ?? modelos.error ?? envios.error ?? antigos.error
  if (erro) {
    console.error('[agendamentos] leitura falhou', { contaId, erro })
    throw new Error('Não foi possível carregar os agendamentos.')
  }

  const nomeCompleto = (c: { nome: string | null; sobrenome: string | null } | null) =>
    c ? [c.nome, c.sobrenome].filter(Boolean).join(' ') || null : null

  const linhas: LinhaAgendamento[] = [
    ...(envios.data ?? []).map(e => {
      const passos = schemaPassos.safeParse(e.passos)
      const cliente = e.clientes as unknown as { nome: string | null; sobrenome: string | null } | null
      return {
        id: e.id, antigo: false, celular: e.celular, nome: nomeCompleto(cliente) ?? e.nome,
        resumo: passos.success ? resumoDosPassos(passos.data) : '',
        agendado_para: e.agendado_para, status: e.status, erro: e.erro, aviso: e.aviso, enviado_em: e.enviado_em,
      }
    }),
    ...(antigos.data ?? []).map(a => {
      const cliente = a.clientes as unknown as { nome: string | null; sobrenome: string | null; celular: string | null } | null
      const status = a.status === 'fila' || a.status === 'processando' ? 'pendente' as const
        : a.status === 'enviado' ? 'enviado' as const : a.status === 'falhou' ? 'falhou' as const : 'cancelado' as const
      return {
        id: a.id, antigo: true, celular: cliente?.celular ?? '', nome: nomeCompleto(cliente),
        resumo: a.mensagem_final ?? '', agendado_para: a.agendado_para as string, status,
        erro: null, aviso: null, enviado_em: a.enviado_em,
      }
    }),
  ].sort((a, b) => b.agendado_para.localeCompare(a.agendado_para))

  return (
    <AgendamentosClient
      linhas={linhas}
      clientes={(clientes.data ?? []).map(c => ({ id: c.id, nome: nomeCompleto(c) ?? 'Sem nome', celular: c.celular as string }))}
      modelos={(modelos.data ?? []).flatMap(m => {
        const passos = passosDoModelo(m)
        return passos ? [{ id: m.id, nome: m.nome, passos }] : []
      })}
    />
  )
}
