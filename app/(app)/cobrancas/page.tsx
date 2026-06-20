import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { MonthSelector } from '@/app/(app)/_components/month-selector'
import { parseMes, getMesBounds } from '@/lib/utils/mes'
import { baixarParcelaAction } from './_actions/parcelas'
import { badgesCobranca, calcularStatusVisual, STATUS_VISUAL_CFG } from '@/lib/utils/parcelas'
import { formatBRL, formatData, somarValores } from '@/lib/utils/format'

export const metadata = { title: 'Cobranças' }


export default async function CobrancasPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  const { mes: mesParam } = await searchParams
  const { ano, mes, param } = parseMes(mesParam)

  const { inicio: mesInicio, fim: mesFim } = getMesBounds(ano, mes)

  const supabase = await createClient()

  // Consultas em paralelo
  const [
    { count: totalClientes },
    { data: cobrancas },
    { data: parcelasDoMes },
    { data: lancamentosDoMes },
  ] = await Promise.all([
    supabase.from('clientes').select('*', { count: 'exact', head: true }).is('deleted_at', null),

    supabase.from('cobrancas').select(`
      id, valor_mensalidade, recorrente, observacao,
      clientes!inner (id, nome, sobrenome, celular),
      parcelas (id, numero, valor, data_vencimento, status)
    `).eq('status', 'ativa').order('created_at', { ascending: false }),

    supabase.from('parcelas')
      .select('id, valor, status, data_pagamento')
      .gte('data_vencimento', mesInicio)
      .lte('data_vencimento', mesFim),

    supabase.from('lancamentos')
      .select('valor')
      .eq('tipo', 'entrada')
      .eq('origem', 'parcela')
      .gte('data', mesInicio)
      .lte('data', mesFim),
  ])

  // ── Indicadores (§6 regras-financeiras) ────────────────────────────────────
  const parcsAbertas = (parcelasDoMes ?? []).filter((p: any) => p.status === 'aberta')
  const parcsPagas   = (parcelasDoMes ?? []).filter((p: any) => p.status === 'paga')
  const valRecebidos = somarValores(lancamentosDoMes ?? [])
  const valAReceber  = somarValores(parcsAbertas)
  const cobAtivas    = (cobrancas ?? []).filter((c: any) =>
    (c.parcelas as any[]).some((p: any) => p.status === 'aberta'),
  ).length

  return (
    <div className="p-8">

      {/* Cabeçalho */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-foreground">Cobranças</h1>
          <MonthSelector mesParam={param} basePath="/cobrancas" />
        </div>
        <Link
          href="/cobrancas/nova"
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Nova cobrança
        </Link>
      </div>

      {/* Indicadores */}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label="Valores Recebidos"    value={formatBRL(valRecebidos)}       mono />
        <KpiCard label="Valores a Receber"    value={formatBRL(valAReceber)}         mono />
        <KpiCard label="Clientes Cadastrados" value={String(totalClientes ?? 0)} />
        <KpiCard label="Cobranças Ativas"     value={String(cobAtivas)} />
        <KpiCard label="Mensalidades em Aberto" value={String(parcsAbertas.length)} />
        <KpiCard label="Mensalidades Pagas"   value={String(parcsPagas.length)} />
      </div>

      {/* Lista de cobranças */}
      {!(cobrancas?.length) ? (
        <div className="rounded-lg border border-border bg-card py-20 text-center">
          <p className="text-sm text-muted-foreground">Nenhuma cobrança ativa.</p>
          <Link href="/cobrancas/nova" className="mt-3 block text-sm text-primary hover:opacity-80">
            Criar primeira cobrança
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                {['Cliente', 'Mensalidade', 'Próximo vencimento', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(cobrancas ?? []).map((c: any) => {
                const abertas = (c.parcelas as any[])
                  .filter((p: any) => p.status === 'aberta')
                  .sort((a: any, b: any) => a.data_vencimento.localeCompare(b.data_vencimento))
                const proxima = abertas[0] ?? null
                const badges  = badgesCobranca(abertas)
                const cli     = c.clientes as any

                return (
                  <tr key={c.id} className="bg-card transition-colors hover:bg-accent/20">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{cli.nome} {cli.sobrenome}</p>
                      <p className="text-xs text-muted-foreground">{cli.celular}</p>
                    </td>
                    <td className="monetary px-4 py-3 font-medium text-foreground">
                      {formatBRL(c.valor_mensalidade)}
                    </td>
                    <td className="monetary px-4 py-3 text-muted-foreground">
                      {proxima ? formatData(proxima.data_vencimento) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {badges.length === 0
                          ? <span className="text-xs text-muted-foreground">Sem parcelas</span>
                          : badges.map(b => (
                            <span key={b.label} className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${b.cls}`}>
                              {b.label}
                            </span>
                          ))
                        }
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {proxima && (
                          <form action={baixarParcelaAction}>
                            <input type="hidden" name="parcela_id" value={proxima.id} />
                            <button
                              type="submit"
                              className="rounded-md bg-success-bg px-2.5 py-1 text-xs font-medium text-success transition hover:opacity-80"
                            >
                              Pago
                            </button>
                          </form>
                        )}
                        <Link
                          href={`/cobrancas/${c.id}`}
                          className="text-xs text-primary transition hover:opacity-80"
                        >
                          Ver
                        </Link>
                      </div>
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

function KpiCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold text-foreground ${mono ? 'monetary' : ''}`}>{value}</p>
    </div>
  )
}
