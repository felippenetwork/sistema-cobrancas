import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'

type Conta = {
  id: string
  nome_empresa: string
  status: 'ativa' | 'suspensa' | 'expirada'
  validade_plano: string | null
  limite_clientes: number
  created_at: string
}

const STATUS = {
  ativa:    { label: 'Ativa',    cls: 'bg-success-bg text-success' },
  suspensa: { label: 'Suspensa', cls: 'bg-warning-bg text-warning' },
  expirada: { label: 'Expirada', cls: 'bg-destructive-bg text-destructive' },
} as const

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  // Append noon to avoid timezone offset shifting the date
  return new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR')
}

export const metadata = { title: 'Contas — Admin' }

export default async function ContasPage() {
  const admin = createAdminClient()
  const { data: contas } = await admin
    .from('contas')
    .select('id, nome_empresa, status, validade_plano, limite_clientes, created_at')
    .order('created_at', { ascending: false })

  const rows = (contas ?? []) as Conta[]

  return (
    <div className="p-8">

      {/* Cabeçalho */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Contas</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {rows.length} conta{rows.length !== 1 ? 's' : ''} cadastrada{rows.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/admin/contas/nova"
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Nova conta
        </Link>
      </div>

      {/* Tabela / vazio */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card py-20 text-center">
          <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada ainda.</p>
          <Link
            href="/admin/contas/nova"
            className="mt-3 block text-sm text-primary transition hover:opacity-80"
          >
            Criar primeira conta
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                {['Empresa', 'Status', 'Válido até', 'Limite', 'Criado em', ''].map(h => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(c => {
                const s = STATUS[c.status] ?? { label: c.status, cls: 'bg-muted text-muted-foreground' }
                return (
                  <tr key={c.id} className="bg-card transition-colors hover:bg-accent/20">
                    <td className="px-4 py-3 font-medium text-foreground">{c.nome_empresa}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
                        {s.label}
                      </span>
                    </td>
                    <td className="monetary px-4 py-3 text-muted-foreground">{fmtDate(c.validade_plano)}</td>
                    <td className="monetary px-4 py-3 text-muted-foreground">{c.limite_clientes}</td>
                    <td className="monetary px-4 py-3 text-muted-foreground">{fmtDate(c.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/contas/${c.id}`}
                        className="rounded px-2 py-1 text-xs text-primary transition hover:opacity-80"
                      >
                        Gerenciar
                      </Link>
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
