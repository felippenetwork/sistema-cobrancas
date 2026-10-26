'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, X } from 'lucide-react'
import { ROTULO_STATUS, celularLegivel, relatorioCsv, resumoRelatorio, type LinhaRelatorio } from '@/lib/disparo/relatorio'
import { relatorioCampanhaAction } from '../_actions'

type Filtro = 'todos' | 'enviado' | 'falhou' | 'pulado' | 'pendente'

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const COR_STATUS: Record<string, string> = {
  enviado: 'bg-green-500/15 text-green-500',
  falhou: 'bg-destructive/10 text-destructive',
  pulado: 'bg-muted text-muted-foreground',
  pendente: 'bg-muted text-muted-foreground',
}

/** Relatório do disparo: resumo, contato por contato (com filtro) e a planilha para baixar. */
export function RelatorioPainel({ campanha, onFechar }: { campanha: { id: string; nome: string }; onFechar: () => void }) {
  const [linhas, setLinhas] = useState<LinhaRelatorio[] | null>(null)
  const [erro, setErro]     = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todos')

  useEffect(() => {
    let vivo = true
    relatorioCampanhaAction(campanha.id).then(r => {
      if (!vivo) return
      if (r.error) setErro(r.error)
      else setLinhas(r.linhas ?? [])
    })
    return () => { vivo = false }
  }, [campanha.id])

  const resumo = useMemo(() => (linhas ? resumoRelatorio(linhas) : null), [linhas])
  const visiveis = (linhas ?? []).filter(l => filtro === 'todos' || l.status === filtro)

  function baixar() {
    if (!linhas) return
    const url = URL.createObjectURL(new Blob([relatorioCsv(linhas)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `relatorio-${campanha.nome.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'disparo'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const FILTROS: { valor: Filtro; rotulo: string; n: number }[] = resumo ? [
    { valor: 'todos', rotulo: 'Todos', n: resumo.total },
    { valor: 'enviado', rotulo: 'Enviados', n: resumo.enviados },
    { valor: 'falhou', rotulo: 'Falharam', n: resumo.falharam },
    { valor: 'pulado', rotulo: 'Pulados', n: resumo.pulados },
    ...(resumo.naoEnviados ? [{ valor: 'pendente' as const, rotulo: 'Não enviados', n: resumo.naoEnviados }] : []),
  ] : []

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onFechar} />
      <div role="dialog" aria-modal="true" aria-labelledby="titulo-relatorio"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="titulo-relatorio" className="truncate text-sm font-semibold text-foreground">Relatório · {campanha.nome}</h2>
            {resumo?.primeiro && (
              <p className="text-xs text-muted-foreground tabular-nums">
                Primeiro envio {quando(resumo.primeiro)}{resumo.ultimo && resumo.ultimo !== resumo.primeiro && <> · último {quando(resumo.ultimo)}</>}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={baixar} disabled={!linhas?.length}
              className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs text-foreground transition hover:border-primary disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> Baixar planilha
            </button>
            <button onClick={onFechar} aria-label="Fechar relatório" className="rounded-md p-1 text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {erro ? (
          <p role="alert" className="m-5 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>
        ) : !resumo ? (
          <div className="space-y-2 p-5" aria-label="Carregando relatório">
            {[0, 1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 border-b border-border px-5 py-4 sm:grid-cols-4">
              {[
                ['Na lista', resumo.total, 'text-foreground'],
                ['Enviados', resumo.enviados, 'text-green-500'],
                ['Falharam', resumo.falharam, resumo.falharam ? 'text-destructive' : 'text-foreground'],
                ['Pulados', resumo.pulados, 'text-foreground'],
              ].map(([rotulo, n, cor]) => (
                <div key={rotulo as string}>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
                  <p className={`text-2xl font-semibold tabular-nums ${cor}`}>{n}</p>
                </div>
              ))}
              {resumo.comAviso > 0 && (
                <p className="col-span-full text-xs text-muted-foreground">
                  <span className="tabular-nums">{resumo.comAviso}</span> enviado{resumo.comAviso === 1 ? '' : 's'} com aviso (alguma ação depois do envio não deu certo).
                </p>
              )}
            </div>

            <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border px-5">
              {FILTROS.map(f => (
                <button key={f.valor} role="tab" aria-selected={filtro === f.valor} onClick={() => setFiltro(f.valor)}
                  className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition ${filtro === f.valor ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                  {f.rotulo} <span className="tabular-nums">({f.n})</span>
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {!visiveis.length ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Ninguém nesta situação.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {visiveis.map((l, i) => (
                    <li key={i} className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{l.nome ?? celularLegivel(l.celular)}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${COR_STATUS[l.status] ?? 'bg-muted text-muted-foreground'}`}>
                          {ROTULO_STATUS[l.status] ?? l.status}
                        </span>
                        {l.enviado_em && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{quando(l.enviado_em)}</span>}
                      </div>
                      {l.nome && <p className="text-xs text-muted-foreground tabular-nums">{celularLegivel(l.celular)}</p>}
                      {l.status !== 'enviado' && l.erro && <p className="mt-0.5 text-xs text-muted-foreground">Motivo: {l.erro}</p>}
                      {l.aviso && <p className="mt-0.5 text-xs text-muted-foreground">Aviso: {l.aviso}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
