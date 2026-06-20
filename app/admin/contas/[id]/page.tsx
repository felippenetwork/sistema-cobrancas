import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ShieldAlert, UserCheck, PowerOff, RefreshCw, Eye } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { EditContaForm } from './edit-form'
import { alterarStatusAction, impersonarAction } from '../../_actions/contas'

const STATUS_LABEL = {
  ativa:    { label: 'Ativa',    cls: 'bg-success-bg text-success' },
  suspensa: { label: 'Suspensa', cls: 'bg-warning-bg text-warning' },
  expirada: { label: 'Expirada', cls: 'bg-destructive-bg text-destructive' },
} as const

export default async function EditContaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const admin   = createAdminClient()

  const { data: conta } = await admin
    .from('contas')
    .select('id, nome_empresa, status, validade_plano, limite_clientes, owner_user_id, created_at')
    .eq('id', id)
    .single()

  if (!conta) notFound()

  // E-mail do dono (auth.users — só acessível via service role)
  const { data: { user: owner } } = await admin.auth.admin.getUserById(conta.owner_user_id as string)

  // Últimas 8 ações de auditoria desta conta
  const { data: logs } = await admin
    .from('audit_log')
    .select('id, acao, actor, created_at, detalhe')
    .eq('conta_id_alvo', id)
    .order('created_at', { ascending: false })
    .limit(8)

  // ── Inline server actions ──────────────────────────────────────────────
  async function suspender() {
    'use server'
    await alterarStatusAction(id, 'suspensa')
  }
  async function ativar() {
    'use server'
    await alterarStatusAction(id, 'ativa')
  }
  async function expirar() {
    'use server'
    await alterarStatusAction(id, 'expirada')
  }
  async function acessarConta() {
    'use server'
    await impersonarAction(id)
  }
  // ──────────────────────────────────────────────────────────────────────

  const statusCfg = STATUS_LABEL[conta.status as keyof typeof STATUS_LABEL]
    ?? { label: conta.status, cls: 'bg-muted text-muted-foreground' }

  return (
    <div className="p-8">

      {/* Breadcrumb */}
      <Link href="/admin/contas" className="text-xs text-muted-foreground transition hover:text-foreground">
        ← Contas
      </Link>

      {/* Cabeçalho */}
      <div className="mt-2 flex items-center gap-3">
        <h1 className="text-xl font-semibold text-foreground">{conta.nome_empresa}</h1>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusCfg.cls}`}>
          {statusCfg.label}
        </span>
      </div>
      {owner?.email && (
        <p className="mt-0.5 text-sm text-muted-foreground">{owner.email}</p>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-3">

        {/* Coluna principal */}
        <div className="space-y-8 lg:col-span-2">

          {/* Editar dados */}
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Dados da conta</h2>
            <EditContaForm conta={{
              id: conta.id,
              nome_empresa: conta.nome_empresa,
              validade_plano: conta.validade_plano as string | null,
              limite_clientes: conta.limite_clientes as number,
            }} />
          </section>

          {/* Histórico de ações */}
          <section className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Histórico de ações</h2>
            {!logs?.length ? (
              <p className="text-sm text-muted-foreground">Sem ações registradas.</p>
            ) : (
              <ul className="space-y-2">
                {logs.map((l: any) => (
                  <li key={l.id} className="flex items-start gap-3 text-sm">
                    <span className="monetary shrink-0 text-xs text-muted-foreground">
                      {new Date(l.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                    <span className="font-medium text-foreground">{l.acao}</span>
                    <span className="text-muted-foreground">{l.actor}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

        </div>

        {/* Coluna lateral: ações */}
        <div className="space-y-4">

          {/* Acesso de suporte */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Suporte
            </h2>
            <form action={acessarConta}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
              >
                <Eye className="h-4 w-4" />
                Acessar conta
              </button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              Registrado em audit_log. Acesso somente leitura.
            </p>
          </section>

          {/* Alterar status */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Status
            </h2>
            <div className="space-y-2">
              {conta.status !== 'ativa' && (
                <form action={ativar}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2 rounded-md border border-success/30 bg-success-bg px-3 py-2 text-sm font-medium text-success transition hover:bg-success/10"
                  >
                    <UserCheck className="h-4 w-4" />
                    Ativar conta
                  </button>
                </form>
              )}
              {conta.status === 'ativa' && (
                <form action={suspender}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm font-medium text-warning transition hover:bg-warning/10"
                  >
                    <PowerOff className="h-4 w-4" />
                    Suspender
                  </button>
                </form>
              )}
              {conta.status !== 'expirada' && (
                <form action={expirar}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2 rounded-md border border-destructive/30 bg-destructive-bg px-3 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10"
                  >
                    <ShieldAlert className="h-4 w-4" />
                    Expirar
                  </button>
                </form>
              )}
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
