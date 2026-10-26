'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from 'lucide-react'
import type { UazapiEtiqueta } from '@/lib/uazapi'
import { MAX_ACOES, TIPOS_ACAO, type Acao, type TipoAcao } from '@/lib/disparo/acoes'
import { listarEtiquetasAction } from '../_actions'

const SELECT = 'rounded-lg border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none focus-visible:border-primary disabled:opacity-50'

function novaAcao(tipo: TipoAcao): Acao {
  switch (tipo) {
    case 'etiqueta_por':
    case 'etiqueta_tirar': return { tipo, id: '', nome: '' }
    case 'fixar_mensagem': return { tipo, dias: 7 }
    case 'silenciar':      return { tipo, horas: 8 }
    case 'nota':           return { tipo, texto: '' }
    default:               return { tipo } as Acao
  }
}

/** Ação de etiqueta ainda sem etiqueta escolhida (a tela não deixa salvar assim). */
export const acaoIncompleta = (a: Acao) => ((a.tipo === 'etiqueta_por' || a.tipo === 'etiqueta_tirar') && !a.id) || (a.tipo === 'nota' && !a.texto.trim())

/**
 * "Depois de enviar": o que fazer na conversa de cada contato, na ordem da lista (pedido do
 * Felippe, 2026-10-26). Cada ação que falhar vira aviso no contato; a próxima continua.
 */
export function AcoesEditor({ acoes, onChange, ajuda, name }: {
  acoes: Acao[]
  onChange: (a: Acao[]) => void
  ajuda: string
  /** Gera um campo escondido com a lista (formulário enviado por FormData). */
  name?: string
}) {
  const [etiquetas, setEtiquetas] = useState<UazapiEtiqueta[] | null>(null)
  const [erroEtq, setErroEtq]     = useState<string | null>(null)
  const precisaEtiquetas = acoes.some(a => a.tipo === 'etiqueta_por' || a.tipo === 'etiqueta_tirar')

  useEffect(() => {
    if (!precisaEtiquetas || etiquetas || erroEtq) return
    let vivo = true
    listarEtiquetasAction().then(r => {
      if (!vivo) return
      if (r.error) setErroEtq(r.error)
      else setEtiquetas(r.etiquetas ?? [])
    })
    return () => { vivo = false }
  }, [precisaEtiquetas, etiquetas, erroEtq])

  const trocar = (i: number, a: Acao) => onChange(acoes.map((x, j) => (j === i ? a : x)))
  const mover = (i: number, d: -1 | 1) => { const n = [...acoes]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n) }

  return (
    <div className="space-y-3 rounded-xl border border-border px-4 py-3">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <ListChecks className="h-3.5 w-3.5 text-muted-foreground" /> Depois de enviar
        </p>
        <p className="text-xs text-muted-foreground">{ajuda}</p>
      </div>

      {acoes.length > 0 && (
        <ol className="space-y-2">
          {acoes.map((a, i) => {
            const rotulo = TIPOS_ACAO.find(t => t.tipo === a.tipo)?.rotulo ?? a.tipo
            return (
              <li key={i} className="space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1 text-sm text-foreground">{rotulo}</span>
                  <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Fazer antes: ${rotulo}`}
                    className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => mover(i, 1)} disabled={i === acoes.length - 1} aria-label={`Fazer depois: ${rotulo}`}
                    className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => onChange(acoes.filter((_, j) => j !== i))} aria-label={`Remover: ${rotulo}`}
                    className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>

                {(a.tipo === 'etiqueta_por' || a.tipo === 'etiqueta_tirar') && (
                  erroEtq ? <p className="text-xs text-muted-foreground">{erroEtq}</p> : (
                    <select aria-label={`Etiqueta para ${a.tipo === 'etiqueta_por' ? 'pôr' : 'tirar'}`} value={a.id} disabled={!etiquetas}
                      onChange={e => { const x = etiquetas?.find(l => l.id === e.target.value); trocar(i, { ...a, id: x?.id ?? '', nome: x?.nome ?? '' }) }}
                      className={SELECT + ' w-full'}>
                      <option value="">{etiquetas ? 'Escolha a etiqueta' : 'Carregando etiquetas…'}</option>
                      {etiquetas?.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
                      {a.id && etiquetas && !etiquetas.some(l => l.id === a.id) && <option value={a.id}>{a.nome || a.id} (não existe mais)</option>}
                    </select>
                  )
                )}
                {a.tipo === 'fixar_mensagem' && (
                  <select aria-label="Por quanto tempo fixar" value={a.dias} onChange={e => trocar(i, { ...a, dias: Number(e.target.value) as 1 | 7 | 30 })} className={SELECT}>
                    <option value={1}>Por 1 dia</option><option value={7}>Por 7 dias</option><option value={30}>Por 30 dias</option>
                  </select>
                )}
                {a.tipo === 'silenciar' && (
                  <select aria-label="Por quanto tempo silenciar" value={a.horas} onChange={e => trocar(i, { ...a, horas: Number(e.target.value) as 8 | 168 | -1 })} className={SELECT}>
                    <option value={8}>Por 8 horas</option><option value={168}>Por 1 semana</option><option value={-1}>Para sempre</option>
                  </select>
                )}
                {a.tipo === 'nota' && (
                  <textarea aria-label="Texto da nota" value={a.texto} maxLength={500} rows={2} placeholder="Ex.: Recebeu a campanha de {{periododia}}"
                    onChange={e => trocar(i, { ...a, texto: e.target.value })}
                    className="w-full resize-y rounded-lg border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary" />
                )}
                {a.tipo === 'salvar_contato' && <p className="text-xs text-muted-foreground">Salva com o nome do contato (sem nome, fica só o número).</p>}
                {a.tipo === 'etiquetas_tirar_todas' && <p className="text-xs text-muted-foreground">Tira todas as etiquetas que a conversa tiver nesse momento.</p>}
              </li>
            )
          })}
        </ol>
      )}

      {acoes.length < MAX_ACOES && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Plus className="h-3.5 w-3.5 text-primary" />
          <select aria-label="Adicionar ação depois do envio" value="" onChange={e => { if (e.target.value) onChange([...acoes, novaAcao(e.target.value as TipoAcao)]) }}
            className={SELECT + ' text-xs'}>
            <option value="">{acoes.length ? 'Adicionar outra ação…' : 'Adicionar ação…'}</option>
            {TIPOS_ACAO.map(t => <option key={t.tipo} value={t.tipo}>{t.rotulo}</option>)}
          </select>
        </label>
      )}
      {name && <input type="hidden" name={name} value={JSON.stringify(acoes)} />}
    </div>
  )
}
