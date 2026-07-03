import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, Users, FileText, Wifi, WifiOff } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function ImpersonarPage({
  params,
}: {
  params: Promise<{ contaId: string }>
}) {
  const { contaId } = await params
  const admin = createAdminClient()

  const { data: conta } = await admin
    .from('contas')
    .select('id, nome_empresa, status, validade_plano, limite_clientes')
    .eq('id', contaId)
    .single()

  if (!conta) notFound()

  // Dados do tenant — todas as queries com conta_id explícito (service role bypassa RLS)
  const [
    { count: totalClientes },
    { count: cobrancasAtivas },
    { count: parcelasAberto },
    { data: conexao },
  ] = await Promise.all([
    admin.from('clientes').select('*', { count: 'exact', head: true })
      .eq('conta_id', contaId).is('deleted_at', null),
    admin.from('cobrancas').select('*', { count: 'exact', head: true })
      .eq('conta_id', contaId).eq('status', 'ativa'),
    admin.from('parcelas').select('*', { count: 'exact', head: true })
      .eq('conta_id', contaId).eq('status', 'aberta'),
    admin.from('conexoes').select('status, numero_conectado, device_name')
      .eq('conta_id', contaId).maybeSingle(),
  ])

  const waConectado = conexao?.status === 'conectado'

  return (
    <div className="p-8">

      {/* Banner de impersonação — fica sempre visível */}
      <div className="mb-6 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-bg px-4 py-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
        <p className="text-sm text-warning">
          <span className="font-semibold">Acesso administrativo</span> — você está visualizando dados de{' '}
          <span className="font-semibold">{conta.nome_empresa}</span>. Ação registrada em audit_log.
        </p>
        <Link
          href={`/admin/contas/${contaId}`}
          className="ml-auto shrink-0 text-xs text-warning underline transition hover:opacity-80"
        >
          Voltar ao admin
        </Link>
      </div>

      <h1 className="text-xl font-semibold text-foreground">{conta.nome_empresa}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">Visão geral da conta — somente leitura</p>

      {/* Indicadores */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Users className="h-4 w-4" />} label="Clientes" value={totalClientes ?? 0} />
        <StatCard icon={<FileText className="h-4 w-4" />} label="Cobranças ativas" value={cobrancasAtivas ?? 0} />
        <StatCard icon={<FileText className="h-4 w-4" />} label="Parcelas em aberto" value={parcelasAberto ?? 0} />
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            {waConectado
              ? <Wifi className="h-4 w-4 text-success" />
              : <WifiOff className="h-4 w-4 text-destructive" />}
            <span className="text-xs uppercase tracking-wide">WhatsApp</span>
          </div>
          <p className={`mt-2 text-sm font-semibold ${waConectado ? 'text-success' : 'text-destructive'}`}>
            {waConectado ? 'Conectado' : 'Desconectado'}
          </p>
          {waConectado && conexao?.numero_conectado && (
            <p className="monetary mt-0.5 text-xs text-muted-foreground">
              {conexao.numero_conectado}
            </p>
          )}
        </div>
      </div>

      {/* Plano */}
      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plano</h2>
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="mt-0.5 font-medium text-foreground capitalize">{conta.status}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Válido até</dt>
            <dd className="monetary mt-0.5 font-medium text-foreground">
              {conta.validade_plano
                ? new Date((conta.validade_plano as string).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR')
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Limite de clientes</dt>
            <dd className="monetary mt-0.5 font-medium text-foreground">{conta.limite_clientes}</dd>
          </div>
        </dl>
      </div>

    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">{icon}
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <p className="monetary mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  )
}
