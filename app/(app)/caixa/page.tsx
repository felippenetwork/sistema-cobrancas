import { createClient } from '@/lib/supabase/server'
import { MonthSelector } from '@/app/(app)/_components/month-selector'
import { NovoLancamentoForm } from './_components/novo-lancamento-form'
import { excluirLancamentoAction } from './_actions/lancamentos'
import { parseMes, getMesBounds } from '@/lib/utils/mes'
import { formatBRL, formatData, somarValores } from '@/lib/utils/format'
import { Trash2 } from 'lucide-react'

export const metadata = { title: 'Caixa' }

export default async function CaixaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  const { mes: mesParam } = await searchParams
  const { ano, mes, param } = parseMes(mesParam)
  const { inicio, fim } = getMesBounds(ano, mes)

  const supabase = await createClient()

  const { data: lancamentos } = await supabase
    .from('lancamentos')
    .select('id, tipo, origem, valor, data, descricao, parcela_id')
    .gte('data', inicio)
    .lte('data', fim)
    .order('data', { ascending: false })
    .order('created_at', { ascending: false })

  const rows      = lancamentos ?? []
  const recebidos = somarValores(rows.filter((l: any) => l.tipo === 'entrada'))
  const saidas    = somarValores(rows.filter((l: any) => l.tipo === 'saida'))
  const saldo     = recebidos - saidas

  return (
    <div className="p-8">

      {/* Cabeçalho */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-foreground">Caixa</h1>
          <MonthSelector mesParam={param} basePath="/caixa" />
        </div>
        <NovoLancamentoForm />
      </div>

      {/* Resumo do mês */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recebidos</p>
          <p className="monetary mt-2 text-2xl font-semibold text-success">{formatBRL(recebidos)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Saídas</p>
          <p className="monetary mt-2 text-2xl font-semibold text-destructive">{formatBRL(saidas)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Saldo</p>
          <p className={`monetary mt-2 text-2xl font-semibold ${saldo >= 0 ? 'text-foreground' : 'text-destructive'}`}>
            {formatBRL(saldo)}
          </p>
        </div>
      </div>

      {/* Tabela de lançamentos */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center">
          <p className="text-sm text-muted-foreground">Nenhum lançamento neste mês.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-[480px] w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                {['Data', 'Descrição', 'Tipo', 'Valor', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((l: any) => (
                <tr key={l.id} className="bg-card transition-colors hover:bg-accent/20">
                  <td className="monetary px-4 py-3 text-muted-foreground">{formatData(l.data)}</td>
                  <td className="px-4 py-3 text-foreground">
                    {l.descricao ?? (l.origem === 'parcela' ? 'Parcela recebida' : '—')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                      l.tipo === 'entrada'
                        ? 'bg-success-bg text-success'
                        : 'bg-destructive-bg text-destructive'
                    }`}>
                      {l.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                    </span>
                  </td>
                  <td className={`monetary px-4 py-3 font-medium ${l.tipo === 'entrada' ? 'text-success' : 'text-destructive'}`}>
                    {l.tipo === 'saida' ? '− ' : ''}{formatBRL(l.valor)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {l.origem === 'manual' && (
                      <form action={excluirLancamentoAction}>
                        <input type="hidden" name="lancamento_id" value={l.id} />
                        <button
                          type="submit"
                          aria-label="Excluir lançamento"
                          className="rounded p-1 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}
