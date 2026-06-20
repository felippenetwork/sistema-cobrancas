import Link from 'next/link'
import { Users, FileText, Wallet, WifiOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { MonthSelector } from '@/app/(app)/_components/month-selector'
import { parseMes, getMesBounds } from '@/lib/utils/mes'
import { formatBRL, somarValores } from '@/lib/utils/format'

export const metadata = { title: 'Dashboard' }

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  const { mes: mesParam } = await searchParams
  const { ano, mes, param } = parseMes(mesParam)
  const { inicio, fim } = getMesBounds(ano, mes)

  const supabase = await createClient()

  const [
    { count: totalClientes },
    { data: cobrancasAtivas },
    { data: parcelasDoMes },
    { data: lancamentosDoMes },
    { data: conexao },
  ] = await Promise.all([
    supabase.from('clientes').select('*', { count: 'exact', head: true }).is('deleted_at', null),

    supabase.from('cobrancas')
      .select('id, parcelas!inner(id, status)')
      .eq('status', 'ativa'),

    supabase.from('parcelas')
      .select('id, valor, status, data_pagamento')
      .gte('data_vencimento', inicio)
      .lte('data_vencimento', fim),

    supabase.from('lancamentos')
      .select('tipo, valor')
      .gte('data', inicio)
      .lte('data', fim),

    supabase.from('conexoes')
      .select('status, numero_conectado')
      .maybeSingle(),
  ])

  // ── KPIs financeiros (§6 regras-financeiras) ─────────────────────────────
  const recebidos = somarValores((lancamentosDoMes ?? []).filter((l: any) => l.tipo === 'entrada'))
  const saidas    = somarValores((lancamentosDoMes ?? []).filter((l: any) => l.tipo === 'saida'))
  const saldo     = recebidos - saidas

  // ── Indicadores de contagem ───────────────────────────────────────────────
  const cobAtivasCount = (cobrancasAtivas ?? []).filter((c: any) =>
    (c.parcelas as any[]).some((p: any) => p.status === 'aberta'),
  ).length

  const emAberto = (parcelasDoMes ?? []).filter((p: any) => p.status === 'aberta').length
  const pagas    = (parcelasDoMes ?? []).filter((p: any) => p.status === 'paga').length

  const waStatus = (conexao as any)?.status ?? null
  const waOff    = !waStatus || waStatus !== 'conectado'

  return (
    <div className="p-8">

      {/* Cabeçalho + seletor de mês */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <MonthSelector mesParam={param} basePath="/dashboard" />
      </div>

      {/* Alerta de WhatsApp desconectado */}
      {waOff && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive-bg px-4 py-3">
          <WifiOff className="h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">
            <span className="font-semibold">WhatsApp desconectado</span> — as notificações automáticas estão pausadas.
          </p>
          <Link href="/conexao" className="ml-auto shrink-0 text-xs text-destructive underline hover:opacity-80">
            Conectar
          </Link>
        </div>
      )}

      {/* KPIs financeiros */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recebidos no mês</p>
          <p className="monetary mt-3 text-3xl font-semibold text-success">{formatBRL(recebidos)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Saídas no mês</p>
          <p className="monetary mt-3 text-3xl font-semibold text-destructive">{formatBRL(saidas)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Saldo do mês</p>
          <p className={`monetary mt-3 text-3xl font-semibold ${saldo >= 0 ? 'text-foreground' : 'text-destructive'}`}>
            {formatBRL(saldo)}
          </p>
        </div>
      </div>

      {/* Indicadores de contagem */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <CountCard label="Clientes"          value={totalClientes ?? 0} />
        <CountCard label="Cobranças ativas"  value={cobAtivasCount} />
        <CountCard label="Em aberto"         value={emAberto} highlight="warning" />
        <CountCard label="Pagas"             value={pagas}    highlight="success" />
      </div>

      {/* Atalhos */}
      <div>
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Atalhos</p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/clientes/novo"
            className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-foreground transition hover:bg-accent"
          >
            <Users className="h-4 w-4 text-muted-foreground" />
            Cadastrar cliente
          </Link>
          <Link
            href="/cobrancas"
            className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-foreground transition hover:bg-accent"
          >
            <FileText className="h-4 w-4 text-muted-foreground" />
            Ver cobranças
          </Link>
          <Link
            href="/caixa"
            className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-foreground transition hover:bg-accent"
          >
            <Wallet className="h-4 w-4 text-muted-foreground" />
            Entradas e saídas
          </Link>
        </div>
      </div>

    </div>
  )
}

function CountCard({
  label, value, highlight,
}: {
  label: string; value: number; highlight?: 'warning' | 'success'
}) {
  const valueColor = highlight === 'warning' ? 'text-warning'
    : highlight === 'success' ? 'text-success'
    : 'text-foreground'

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`monetary mt-2 text-2xl font-semibold ${valueColor}`}>{value}</p>
    </div>
  )
}
