'use client'

import { useEffect, useState } from 'react'
import { Tag } from 'lucide-react'
import type { UazapiEtiqueta } from '@/lib/uazapi'
import { listarEtiquetasAction } from '../_actions'

export type EtiquetaEscolhida = { id: string; nome: string } | null

/**
 * Etiqueta do WhatsApp Business para remover e/ou adicionar na conversa depois do envio.
 * Com `nomeCampo`, também gera os inputs escondidos para formulários (modo normal).
 */
export function EtiquetasCampo({ adicionar, remover, onAdicionar, onRemover, nomeCampo = false }: {
  adicionar: EtiquetaEscolhida
  remover: EtiquetaEscolhida
  onAdicionar: (e: EtiquetaEscolhida) => void
  onRemover: (e: EtiquetaEscolhida) => void
  nomeCampo?: boolean
}) {
  const [etiquetas, setEtiquetas] = useState<UazapiEtiqueta[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    listarEtiquetasAction().then(r => {
      if (!vivo) return
      if (r.error) setErro(r.error)
      else setEtiquetas(r.etiquetas ?? [])
    })
    return () => { vivo = false }
  }, [])

  const escolher = (id: string): EtiquetaEscolhida => {
    const e = etiquetas?.find(x => x.id === id)
    return e ? { id: e.id, nome: e.nome } : null
  }

  const SELECT = 'w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none focus-visible:border-primary disabled:opacity-50'

  return (
    <div className="space-y-2 rounded-xl border border-border px-4 py-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Tag className="h-3.5 w-3.5 text-muted-foreground" />
        Etiquetas do WhatsApp Business
      </p>
      <p className="text-xs text-muted-foreground">Aplicadas na conversa de cada contato logo depois do envio.</p>
      {erro ? (
        <p className="text-xs text-muted-foreground">{erro}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            Adicionar
            <select value={adicionar?.id ?? ''} disabled={!etiquetas} onChange={e => onAdicionar(escolher(e.target.value))} className={SELECT + ' mt-1'}>
              <option value="">{etiquetas ? 'Nenhuma' : 'Carregando…'}</option>
              {etiquetas?.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Remover
            <select value={remover?.id ?? ''} disabled={!etiquetas} onChange={e => onRemover(escolher(e.target.value))} className={SELECT + ' mt-1'}>
              <option value="">{etiquetas ? 'Nenhuma' : 'Carregando…'}</option>
              {etiquetas?.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </label>
        </div>
      )}
      {nomeCampo && (
        <>
          <input type="hidden" name="etiqueta_adicionar" value={adicionar?.id ?? ''} />
          <input type="hidden" name="etiqueta_adicionar_nome" value={adicionar?.nome ?? ''} />
          <input type="hidden" name="etiqueta_remover" value={remover?.id ?? ''} />
          <input type="hidden" name="etiqueta_remover_nome" value={remover?.nome ?? ''} />
        </>
      )}
    </div>
  )
}
