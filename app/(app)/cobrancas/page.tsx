import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { MonthSelector } from '@/app/(app)/_components/month-selector'
import { parseMes, getMesBounds } from '@/lib/utils/mes'
import { formatBRL, somarValores } from '@/lib/utils/format'
import { CobrancasTable } from './_components/cobrancas-table'

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
      id, valor_mensalidade, recorrente, qtd_parcelas, observacao, created_at,
      clientes!inner (id, nome, sobrenome, celular),
      parcelas (id, numero, valor, data_vencimento, status, data_pagamento)
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
  const parcsAbertas = (parcelasDoMes ?? []).filter(p => p.status === 'aberta')
  const parcsPagas   = (parcelasDoMes ?? []).filter(p => p.status === 'paga')
  const valRecebidos = somarValores(lancamentosDoMes ?? [])
  const valAReceber  = somarValores(parcsAbertas)
  const cobAtivas    = (cobrancas ?? []).filter(c =>
    c.parcelas?.some(p => p.status === 'aberta'),
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
        <CobrancasTable cobrancas={cobrancas as any} />
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
