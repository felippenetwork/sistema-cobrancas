'use client'

import { useActionState, useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, CheckCircle, Pencil, CalendarCheck, MessageSquare, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { baixarParcelaAction, editarParcelaAction, cobrarManualAction } from '../_actions/parcelas'
import { cancelarCobrancaAction } from '../_actions/cobrancas'
import { calcularStatusVisual, STATUS_VISUAL_CFG } from '@/lib/utils/parcelas'
import { formatBRL, formatData } from '@/lib/utils/format'

const INPUT = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary'

type Parcela = {
  id: string; numero: number; valor: string; data_vencimento: string
  status: string; data_pagamento: string | null; observacao: string | null
}
type Cobranca = {
  id: string; valor_mensalidade: string; recorrente: boolean
  dia_pagamento: number; observacao: string | null; status: string
  clientes: { nome: string; sobrenome: string; celular: string; email: string }
  parcelas: Parcela[]
}

function EditarParcelaForm({ parcela, onSucesso }: { parcela: Parcela; onSucesso: () => void }) {
  const [state, formAction, isPending] = useActionState(editarParcelaAction, { error: null })

  useEffect(() => { if (state.success) onSucesso() }, [state.success, onSucesso])

  return (
    <form action={formAction} className="mt-2 space-y-3 rounded-md border border-border bg-input p-3">
      <input type="hidden" name="parcela_id" value={parcela.id} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vencimento</label>
          <input type="date" name="data_vencimento" required defaultValue={parcela.data_vencimento} className={INPUT} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Valor (R$)</label>
          <input type="text" name="valor" required defaultValue={parseFloat(parcela.valor).toFixed(2).replace('.', ',')} className={INPUT} />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Observação</label>
        <input type="text" name="observacao" defaultValue={parcela.observacao ?? ''} placeholder="Opcional" className={INPUT} />
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      <button type="submit" disabled={isPending}
        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
        {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
        {isPending ? 'Salvando...' : 'Salvar'}
      </button>
    </form>
  )
}

export default function CobrancaDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [cobranca, setCobranca] = useState<Cobranca | null>(null)
  const [loading, setLoading]   = useState(true)
  const [editandoId, setEditandoId] = useState<string | null>(null)

  const fetchCobranca = useCallback(async () => {
    const sb = createClient()
    const { data } = await sb
      .from('cobrancas')
      .select(`id, valor_mensalidade, recorrente, dia_pagamento, observacao, status,
        clientes!inner (nome, sobrenome, celular, email),
        parcelas (id, numero, valor, data_vencimento, status, data_pagamento, observacao)`)
      .eq('id', id)
      .single()
    setCobranca(data as unknown as Cobranca)
    setLoading(false)
  }, [id])

  useEffect(() => { fetchCobranca() }, [fetchCobranca])

  if (loading) return (
    <div className="flex min-h-[40vh] items-center justify-center p-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
  if (!cobranca) return (
    <div className="p-8">
      <p className="text-sm text-muted-foreground">Cobrança não encontrada.</p>
      <Link href="/cobrancas" className="mt-2 block text-sm text-primary">← Cobranças</Link>
    </div>
  )

  const cli = cobranca.clientes
  const parcelas = [...(cobranca.parcelas ?? [])].sort((a, b) => a.numero - b.numero)

  return (
    <div className="p-8">
      <Link href="/cobrancas" className="text-xs text-muted-foreground transition hover:text-foreground">
        ← Cobranças
      </Link>

      <div className="mt-2 mb-6">
        <h1 className="text-xl font-semibold text-foreground">{cli.nome} {cli.sobrenome}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {formatBRL(cobranca.valor_mensalidade)}/mês
          {cobranca.recorrente ? ' · Recorrente' : ` · ${parcelas.length} parcela(s)`}
          {cobranca.observacao && ` · ${cobranca.observacao}`}
        </p>
      </div>

      {/* Parcelas */}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30">
            <tr>
              {['#', 'Vencimento', 'Pago em', 'Valor', 'Status', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {parcelas.map(p => {
              const isPaga  = p.status === 'paga'
              const status  = isPaga ? null : calcularStatusVisual(p.data_vencimento)
              const cfg     = status ? STATUS_VISUAL_CFG[status] : null
              const editando = editandoId === p.id

              return (
                <tr key={p.id} className="bg-card">
                  <td colSpan={editando ? 6 : 1} className={editando ? 'px-4 py-2' : 'monetary px-4 py-3 text-muted-foreground'}>
                    {editando ? (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-foreground">Editar parcela #{p.numero}</span>
                          <button onClick={() => setEditandoId(null)} className="text-muted-foreground hover:text-foreground">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <EditarParcelaForm parcela={p} onSucesso={() => { setEditandoId(null); fetchCobranca() }} />
                      </div>
                    ) : `#${p.numero}`}
                  </td>
                  {!editando && <>
                    <td className="monetary px-4 py-3 text-foreground">{formatData(p.data_vencimento)}</td>
                    <td className="monetary px-4 py-3 text-muted-foreground">{formatData(p.data_pagamento)}</td>
                    <td className="monetary px-4 py-3 font-medium text-foreground">{formatBRL(p.valor)}</td>
                    <td className="px-4 py-3">
                      {isPaga
                        ? <span className="flex items-center gap-1 text-xs text-success"><CheckCircle className="h-3 w-3" /> Paga</span>
                        : cfg && <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.cls}`}>{cfg.label}</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {!isPaga && (
                          <>
                            <button
                              onClick={() => setEditandoId(p.id)}
                              aria-label="Editar parcela"
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <form action={baixarParcelaAction}>
                              <input type="hidden" name="parcela_id" value={p.id} />
                              <input type="hidden" name="redirect_to" value={`/cobrancas/${id}`} />
                              <button type="submit" aria-label="Dar baixa" className="rounded p-1 text-success hover:bg-success-bg">
                                <CalendarCheck className="h-3.5 w-3.5" />
                              </button>
                            </form>
                            <form action={cobrarManualAction}>
                              <input type="hidden" name="parcela_id" value={p.id} />
                              <button type="submit" aria-label="Cobrar via WhatsApp" className="rounded p-1 text-muted-foreground hover:text-success" title="Enviar cobrança manual via WhatsApp">
                                <MessageSquare className="h-3.5 w-3.5" />
                              </button>
                            </form>
                          </>
                        )}
                      </div>
                    </td>
                  </>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Cancelar cobrança */}
      {cobranca.status === 'ativa' && (
        <div className="mt-8 rounded-lg border border-destructive/30 bg-card p-4">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Cancelar cobrança</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Para a geração futura de parcelas. Parcelas já abertas permanecem.
          </p>
          <form action={cancelarCobrancaAction}>
            <input type="hidden" name="cobranca_id" value={cobranca.id} />
            <button type="submit" className="rounded-md border border-destructive/40 bg-destructive-bg px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/20">
              Cancelar cobrança
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
