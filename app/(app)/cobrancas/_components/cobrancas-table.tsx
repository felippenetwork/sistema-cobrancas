'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Eye, Trash2, Search, X } from 'lucide-react'
import { cancelarCobrancaAction } from '../_actions/cobrancas'
import { formatBRL, formatData } from '@/lib/utils/format'
import { formatarCelular } from '@/lib/validations/celular'
import { ConfirmarBaixaModal, type ModalPagamento } from './ConfirmarBaixaModal'

function diasAteVencimento(dataVencimento: string): number {
  const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  hoje.setHours(0, 0, 0, 0)
  const venc = new Date(dataVencimento + 'T00:00:00')
  return Math.round((venc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
}

function StatusBadge({ dataVencimento }: { dataVencimento: string }) {
  const dias = diasAteVencimento(dataVencimento)
  if (dias > 0)  return <span className="inline-flex rounded-full bg-success/20 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-success">Vencer em ({dias} dias)</span>
  if (dias === 0) return <span className="inline-flex rounded-full bg-warning/20 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-warning">Vence hoje</span>
  return <span className="inline-flex rounded-full bg-destructive/20 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-destructive">Vencido ({Math.abs(dias)} dias)</span>
}

type Parcela = {
  id: string
  numero: number
  valor: number
  data_vencimento: string
  data_pagamento: string | null
  status: string
}

type CobrancaRow = {
  id: string
  valor_mensalidade: number
  recorrente: boolean
  qtd_parcelas: number | null
  observacao: string | null
  created_at: string
  clientes: { id: string; nome: string; sobrenome: string | null; celular: string }
  parcelas: Parcela[]
}

const PER_PAGE_OPTIONS = [10, 15, 25, 50]

function calcProximoVencimento(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  // month em JS é 0-indexed — passar mes (1-indexed) avança 1 mês
  return new Date(ano, mes, dia).toISOString().slice(0, 10)
}

export function CobrancasTable({ cobrancas }: { cobrancas: CobrancaRow[] }) {
  const [cancelandoId, setCancelandoId]   = useState<string | null>(null)
  const [modalPagamento, setModalPagamento] = useState<ModalPagamento | null>(null)
  const [pagina, setPagina]     = useState(1)
  const [perPage, setPerPage]   = useState(10)
  const [busca, setBusca]       = useState('')

  const filtradas = busca.trim()
    ? cobrancas.filter(c => {
        const termo = busca.toLowerCase()
        const nome  = `${c.clientes.nome} ${c.clientes.sobrenome}`.toLowerCase()
        return nome.includes(termo)
      })
    : cobrancas

  const ordenadas = [...filtradas].sort((a, b) => {
    const pA = [...a.parcelas].filter(p => p.status === 'aberta').sort((x, y) => x.data_vencimento.localeCompare(y.data_vencimento))[0]
    const pB = [...b.parcelas].filter(p => p.status === 'aberta').sort((x, y) => x.data_vencimento.localeCompare(y.data_vencimento))[0]
    if (!pA && !pB) return 0
    if (!pA) return 1
    if (!pB) return -1
    return pA.data_vencimento.localeCompare(pB.data_vencimento)
  })

  const totalPaginas = Math.max(1, Math.ceil(ordenadas.length / perPage))
  const paginaAtual  = Math.min(pagina, totalPaginas)
  const inicio       = (paginaAtual - 1) * perPage
  const visiveis     = ordenadas.slice(inicio, inicio + perPage)

  function mudarPerPage(novo: number) {
    setPerPage(novo)
    setPagina(1)
  }

  function handleBusca(valor: string) {
    setBusca(valor)
    setPagina(1)
  }

  return (
    <div className="space-y-3">

      {/* Barra de busca */}
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={busca}
          onChange={e => handleBusca(e.target.value)}
          placeholder="Buscar por nome..."
          className="w-full rounded-md border border-border bg-input py-2 pl-9 pr-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary"
        />
        {busca && (
          <button
            onClick={() => handleBusca('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-border bg-muted/30">
            <tr>
              {['Nome', 'Celular', 'Tipo', 'Mensalidade', 'Início', 'Próx. Venc.', 'Status', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
          {visiveis.map((c) => {
            const abertas = [...c.parcelas]
              .filter(p => p.status === 'aberta')
              .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))
            const proxima    = abertas[0] ?? null
            const cli        = c.clientes
            const pagas      = c.parcelas.filter(p => p.status === 'paga').length
            const total      = c.qtd_parcelas ?? c.parcelas.length
            const cancelando = cancelandoId === c.id

            return (
              <tr key={c.id} className="bg-card transition-colors hover:bg-accent/20">

                <td className="px-4 py-3 font-medium text-foreground">
                  {cli.nome} {cli.sobrenome}
                </td>

                <td className="monetary px-4 py-3 text-muted-foreground">
                  {formatarCelular(cli.celular)}
                </td>

                <td className="px-4 py-3">
                  {c.recorrente ? (
                    <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      Recorrente
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {pagas}/{total} parc.
                    </span>
                  )}
                </td>

                <td className="monetary px-4 py-3 font-medium text-foreground">
                  {formatBRL(c.valor_mensalidade)}
                </td>

                <td className="monetary px-4 py-3 text-muted-foreground">
                  {formatData(c.created_at)}
                </td>

                <td className="monetary px-4 py-3 text-muted-foreground">
                  {proxima ? formatData(proxima.data_vencimento) : '—'}
                </td>

                <td className="px-4 py-3">
                  {proxima
                    ? <StatusBadge dataVencimento={proxima.data_vencimento} />
                    : <span className="text-xs text-muted-foreground">—</span>
                  }
                </td>

                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {/* Dar baixa — abre modal de confirmação */}
                    {proxima && (
                      <button
                        type="button"
                        title="Marcar como pago"
                        onClick={() => setModalPagamento({
                          parcelaId:         proxima.id,
                          cobrancaId:        c.id,
                          clienteNome:       `${cli.nome} ${cli.sobrenome ?? ''}`.trim(),
                          valor:             proxima.valor,
                          createdAt:         c.created_at,
                          recorrente:        c.recorrente,
                          proximoVencimento: calcProximoVencimento(proxima.data_vencimento),
                        })}
                        className="flex h-7 w-7 items-center justify-center rounded-md bg-success-bg text-success transition hover:opacity-80"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {/* Ver detalhes */}
                    <Link
                      href={`/cobrancas/${c.id}`}
                      title="Ver parcelas"
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary transition hover:bg-primary/20"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Link>

                    {/* Cancelar cobrança */}
                    {cancelando ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Cancelar?</span>
                        <form action={cancelarCobrancaAction}>
                          <input type="hidden" name="cobranca_id" value={c.id} />
                          <button type="submit" className="text-xs font-medium text-destructive hover:opacity-80">
                            Sim
                          </button>
                        </form>
                        <button onClick={() => setCancelandoId(null)} className="text-xs text-muted-foreground hover:opacity-80">
                          Não
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setCancelandoId(c.id)}
                        title="Cancelar cobrança"
                        className="flex h-7 w-7 items-center justify-center rounded-md bg-destructive-bg text-destructive transition hover:opacity-80"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
          </tbody>
        </table>
      </div>

      {/* Rodapé: paginação + seletor de itens por página */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">

        {/* Info + seletor por página */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {inicio + 1}–{Math.min(inicio + perPage, ordenadas.length)} de {ordenadas.length}
          </span>
          <span className="text-border">|</span>
          <span>Por página:</span>
          <select
            value={perPage}
            onChange={e => mudarPerPage(Number(e.target.value))}
            className="rounded border border-border bg-card px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {PER_PAGE_OPTIONS.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {/* Botões de página */}
        {totalPaginas > 1 && (
          <div className="flex items-center gap-1">
            <button
              disabled={paginaAtual === 1}
              onClick={() => setPagina(1)}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-30"
            >
              «
            </button>
            <button
              disabled={paginaAtual === 1}
              onClick={() => setPagina(p => p - 1)}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-30"
            >
              ‹
            </button>
            {Array.from({ length: totalPaginas }, (_, i) => i + 1)
              .filter(n => n === 1 || n === totalPaginas || Math.abs(n - paginaAtual) <= 1)
              .reduce<(number | '…')[]>((acc, n, i, arr) => {
                if (i > 0 && (n as number) - (arr[i - 1] as number) > 1) acc.push('…')
                acc.push(n)
                return acc
              }, [])
              .map((n, i) =>
                n === '…' ? (
                  <span key={`e${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                ) : (
                  <button
                    key={n}
                    onClick={() => setPagina(n as number)}
                    className={`min-w-[28px] rounded px-2 py-1 text-xs transition ${
                      paginaAtual === n
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {n}
                  </button>
                )
              )}
            <button
              disabled={paginaAtual === totalPaginas}
              onClick={() => setPagina(p => p + 1)}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-30"
            >
              ›
            </button>
            <button
              disabled={paginaAtual === totalPaginas}
              onClick={() => setPagina(totalPaginas)}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-30"
            >
              »
            </button>
          </div>
        )}
      </div>

      {/* Modal de confirmação de pagamento */}
      {modalPagamento && (
        <ConfirmarBaixaModal
          modal={modalPagamento}
          onClose={() => setModalPagamento(null)}
        />
      )}
    </div>
  )
}
