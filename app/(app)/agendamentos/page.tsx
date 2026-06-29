import { createClient } from '@/lib/supabase/server'
import { NovoAgendamentoForm } from './_components/novo-agendamento-form'
import { cancelarAgendamentoAction } from './_actions/agendamentos'
import { X } from 'lucide-react'

export const metadata = { title: 'Agendamentos' }

const CANAL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email:    'E-mail',
}

const CANAL_CLS: Record<string, string> = {
  whatsapp: 'bg-success/10 text-success',
  email:    'bg-primary/10 text-primary',
}

const STATUS_CLS: Record<string, string> = {
  fila:      'bg-warning/10 text-warning',
  enviado:   'bg-success/10 text-success',
  falhou:    'bg-destructive/10 text-destructive',
  cancelado: 'bg-muted text-muted-foreground',
}

const STATUS_LABEL: Record<string, string> = {
  fila:      'Na fila',
  enviado:   'Enviado',
  falhou:    'Falhou',
  cancelado: 'Cancelado',
}

function formatDataHoraSP(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default async function AgendamentosPage() {
  const supabase = await createClient()

  const [{ data: clientes }, { data: agendamentos }] = await Promise.all([
    supabase
      .from('clientes')
      .select('id, nome, sobrenome')
      .is('deleted_at', null)
      .order('nome'),

    supabase
      .from('notificacoes_enviadas')
      .select('id, canal, status, mensagem_final, assunto, agendado_para, enviado_em, clientes!inner(nome, sobrenome)')
      .eq('tipo', 'agendada')
      .order('agendado_para', { ascending: false })
      .limit(100),
  ])

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">Agendamentos</h1>
        <NovoAgendamentoForm clientes={(clientes ?? []) as any[]} />
      </div>

      {!agendamentos?.length ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center">
          <p className="text-sm text-muted-foreground">Nenhum agendamento ainda. Clique em &ldquo;Novo agendamento&rdquo; para começar.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                {['Cliente', 'Canal', 'Mensagem', 'Agendado para', 'Status', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(agendamentos ?? []).map((a: any) => {
                const cli = a.clientes
                const preview = (a.mensagem_final ?? '').slice(0, 60) + ((a.mensagem_final ?? '').length > 60 ? '…' : '')
                return (
                  <tr key={a.id} className="bg-card hover:bg-accent/20">
                    <td className="px-4 py-3 text-foreground">{cli?.nome} {cli?.sobrenome}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${CANAL_CLS[a.canal] ?? 'bg-muted text-muted-foreground'}`}>
                        {CANAL_LABEL[a.canal] ?? a.canal}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px]">
                      {a.assunto && <span className="block text-xs font-medium text-foreground truncate">{a.assunto}</span>}
                      <span className="truncate block">{preview || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{formatDataHoraSP(a.agendado_para)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[a.status] ?? 'bg-muted text-muted-foreground'}`}>
                        {STATUS_LABEL[a.status] ?? a.status}
                      </span>
                    </td>
                    <td className="px-2 py-3">
                      {a.status === 'fila' && (
                        <form action={cancelarAgendamentoAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <button
                            type="submit"
                            aria-label="Cancelar agendamento"
                            className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                            Cancelar
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
