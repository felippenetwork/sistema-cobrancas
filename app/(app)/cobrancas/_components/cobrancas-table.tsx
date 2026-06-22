'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X, CheckCircle } from 'lucide-react'
import { baixarParcelaAction } from '../_actions/parcelas'
import { badgesCobranca, calcularStatusVisual, STATUS_VISUAL_CFG } from '@/lib/utils/parcelas'
import { formatBRL, formatData } from '@/lib/utils/format'
import { formatarCelular } from '@/lib/validations/celular'

type Parcela = {
  id: string
  numero: number
  valor: string
  data_vencimento: string
  data_pagamento: string | null
  status: string
}

type CobrancaRow = {
  id: string
  valor_mensalidade: string
  recorrente: boolean
  observacao: string | null
  clientes: { id: string; nome: string; sobrenome: string; celular: string }
  parcelas: Parcela[]
}

export function CobrancasTable({ cobrancas }: { cobrancas: CobrancaRow[] }) {
  const [viewingId, setViewingId] = useState<string | null>(null)
  const viewingCob = cobrancas.find(c => c.id === viewingId) ?? null

  // Parcelas a exibir no sheet:
  // - Recorrente: pagas (ordenadas) + próxima aberta
  // - Fixas: todas ordenadas por número
  let parcelasVer: Parcela[] = []
  if (viewingCob) {
    const pagas = [...viewingCob.parcelas]
      .filter(p => p.status === 'paga')
      .sort((a, b) => a.numero - b.numero)

    if (viewingCob.recorrente) {
      const proximaAberta = [...viewingCob.parcelas]
        .filter(p => p.status === 'aberta')
        .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))[0]
      parcelasVer = proximaAberta ? [...pagas, proximaAberta] : pagas
    } else {
      parcelasVer = [...viewingCob.parcelas].sort((a, b) => a.numero - b.numero)
    }
  }

  return (
    <>
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
            {cobrancas.map((c) => {
              const abertas = [...c.parcelas]
                .filter(p => p.status === 'aberta')
                .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))
              const proxima = abertas[0] ?? null
              const badges  = badgesCobranca(abertas)
              const cli     = c.clientes

              return (
                <tr key={c.id} className="bg-card transition-colors hover:bg-accent/20">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{cli.nome} {cli.sobrenome}</p>
                    <p className="text-xs text-muted-foreground">{formatarCelular(cli.celular)}</p>
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
                    <div className="flex items-center justify-end gap-2">
                      {proxima && (
                        <form action={baixarParcelaAction}>
                          <input type="hidden" name="parcela_id" value={proxima.id} />
                          <button
                            type="submit"
                            className="rounded-md bg-success-bg px-3 py-1.5 text-xs font-medium text-success transition hover:opacity-80"
                          >
                            Pago
                          </button>
                        </form>
                      )}
                      <button
                        onClick={() => setViewingId(c.id)}
                        className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/20"
                      >
                        Ver
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Sheet — Ver parcelas */}
      {viewingCob && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setViewingId(null)}
          />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {viewingCob.clientes.nome} {viewingCob.clientes.sobrenome}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {formatBRL(viewingCob.valor_mensalidade)}/mês
                  {viewingCob.recorrente
                    ? ' · Recorrente'
                    : ` · ${viewingCob.parcelas.length} parcela(s)`}
                  {viewingCob.observacao && ` · ${viewingCob.observacao}`}
                </p>
              </div>
              <button
                onClick={() => setViewingId(null)}
                aria-label="Fechar"
                className="rounded-md p-1 text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {parcelasVer.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma parcela encontrada.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-border bg-card">
                    <tr>
                      {['#', 'Vencimento', 'Pago em', 'Valor', 'Status'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {parcelasVer.map(p => {
                      const isPaga  = p.status === 'paga'
                      const statusV = isPaga ? null : calcularStatusVisual(p.data_vencimento)
                      const cfg     = statusV ? STATUS_VISUAL_CFG[statusV] : null

                      return (
                        <tr key={p.id} className="bg-card">
                          <td className="monetary px-4 py-3 text-xs text-muted-foreground">#{p.numero}</td>
                          <td className="monetary px-4 py-3 text-foreground">{formatData(p.data_vencimento)}</td>
                          <td className="monetary px-4 py-3 text-muted-foreground">{formatData(p.data_pagamento)}</td>
                          <td className="monetary px-4 py-3 font-medium text-foreground">{formatBRL(p.valor)}</td>
                          <td className="px-4 py-3">
                            {isPaga
                              ? <span className="flex items-center gap-1 text-xs text-success"><CheckCircle className="h-3 w-3" /> Paga</span>
                              : cfg && <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.cls}`}>{cfg.label}</span>
                            }
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border-t border-border px-6 py-4">
              <Link
                href={`/cobrancas/${viewingCob.id}`}
                className="text-xs text-primary hover:opacity-80"
                onClick={() => setViewingId(null)}
              >
                Ver detalhes completos →
              </Link>
            </div>
          </div>
        </>
      )}
    </>
  )
}
