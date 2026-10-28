'use client'

// Campos de uma AÇÃO na conversa (etiqueta, arquivar, fixar…), usados na caixinha "Ação" do editor
// de mensagens (passos-editor.tsx) — a ação entra no meio da sequência, na ordem que a pessoa
// escolher (pedido do Felippe, 2026-10-28). Formato e execução: lib/disparo/acoes.ts.

import { useEffect, useState } from 'react'
import type { UazapiEtiqueta } from '@/lib/uazapi'
import type { Acao, TipoAcao } from '@/lib/disparo/acoes'
import { listarEtiquetasAction } from '../_actions'

const SELECT = 'rounded-lg border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none focus-visible:border-primary disabled:opacity-50'

export function novaAcao(tipo: TipoAcao): Acao {
  switch (tipo) {
    case 'etiqueta_por':
    case 'etiqueta_tirar': return { tipo, id: '', nome: '' }
    case 'fixar_mensagem': return { tipo, dias: 7 }
    case 'silenciar':      return { tipo, horas: 8 }
    case 'nota':           return { tipo, texto: '' }
    default:               return { tipo } as Acao
  }
}

/** Ação ainda sem etiqueta escolhida ou nota vazia (a tela não deixa salvar assim). */
export const acaoIncompleta = (a: Acao) => ((a.tipo === 'etiqueta_por' || a.tipo === 'etiqueta_tirar') && !a.id) || (a.tipo === 'nota' && !a.texto.trim())

/** Etiquetas do WhatsApp Business, buscadas só quando alguma ação precisa delas. */
export function useEtiquetas(precisa: boolean): { etiquetas: UazapiEtiqueta[] | null; erro: string | null } {
  const [etiquetas, setEtiquetas] = useState<UazapiEtiqueta[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    if (!precisa || etiquetas || erro) return
    let vivo = true
    listarEtiquetasAction().then(r => {
      if (!vivo) return
      if (r.error) setErro(r.error)
      else setEtiquetas(r.etiquetas ?? [])
    })
    return () => { vivo = false }
  }, [precisa, etiquetas, erro])
  return { etiquetas, erro }
}

/** O que a ação precisa além do tipo: qual etiqueta, por quanto tempo, o texto da nota. */
export function AcaoCampos({ acao, onChange, etiquetas, erroEtiquetas }: {
  acao: Acao
  onChange: (a: Acao) => void
  etiquetas: UazapiEtiqueta[] | null
  erroEtiquetas: string | null
}) {
  const a = acao
  if (a.tipo === 'etiqueta_por' || a.tipo === 'etiqueta_tirar') {
    if (erroEtiquetas) return <p className="text-xs text-muted-foreground">{erroEtiquetas}</p>
    return (
      <select aria-label={`Etiqueta para ${a.tipo === 'etiqueta_por' ? 'pôr' : 'tirar'}`} value={a.id} disabled={!etiquetas}
        onChange={e => { const x = etiquetas?.find(l => l.id === e.target.value); onChange({ ...a, id: x?.id ?? '', nome: x?.nome ?? '' }) }}
        className={SELECT + ' w-full'}>
        <option value="">{etiquetas ? 'Escolha a etiqueta' : 'Carregando etiquetas…'}</option>
        {etiquetas?.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
        {a.id && etiquetas && !etiquetas.some(l => l.id === a.id) && <option value={a.id}>{a.nome || a.id} (não existe mais)</option>}
      </select>
    )
  }
  if (a.tipo === 'fixar_mensagem') {
    return (
      <div className="space-y-1">
        <select aria-label="Por quanto tempo fixar" value={a.dias} onChange={e => onChange({ ...a, dias: Number(e.target.value) as 1 | 7 | 30 })} className={SELECT}>
          <option value={1}>Por 1 dia</option><option value={7}>Por 7 dias</option><option value={30}>Por 30 dias</option>
        </select>
        <p className="text-xs text-muted-foreground">Fixa a última mensagem que saiu antes desta ação.</p>
      </div>
    )
  }
  if (a.tipo === 'silenciar') {
    return (
      <select aria-label="Por quanto tempo silenciar" value={a.horas} onChange={e => onChange({ ...a, horas: Number(e.target.value) as 8 | 168 | -1 })} className={SELECT}>
        <option value={8}>Por 8 horas</option><option value={168}>Por 1 semana</option><option value={-1}>Para sempre</option>
      </select>
    )
  }
  if (a.tipo === 'nota') {
    return (
      <textarea aria-label="Texto da nota" value={a.texto} maxLength={500} rows={2} placeholder="Ex.: Recebeu a campanha de {{periododia}}"
        onChange={e => onChange({ ...a, texto: e.target.value })}
        className="w-full resize-y rounded-lg border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary" />
    )
  }
  if (a.tipo === 'salvar_contato') return <p className="text-xs text-muted-foreground">Salva com o nome do contato (sem nome, fica só o número).</p>
  if (a.tipo === 'etiquetas_tirar_todas') return <p className="text-xs text-muted-foreground">Tira todas as etiquetas que a conversa tiver nesse momento.</p>
  return null
}
