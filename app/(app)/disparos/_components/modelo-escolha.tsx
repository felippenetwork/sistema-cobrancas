'use client'

import Link from 'next/link'
import { FileText, Image as ImageIcon, Mic, Type, Video } from 'lucide-react'
import { TIPOS_MIDIA, type Passo } from '@/lib/disparo/passos'

export type ModeloDisparo = { id: string; nome: string; passos: Passo[] }

const ICONE: Record<Passo['tipo'], React.ReactNode> = {
  texto:     <Type className="h-3.5 w-3.5" />,
  imagem:    <ImageIcon className="h-3.5 w-3.5" />,
  video:     <Video className="h-3.5 w-3.5" />,
  audio:     <Mic className="h-3.5 w-3.5" />,
  documento: <FileText className="h-3.5 w-3.5" />,
}

const SELECT = 'w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20'

/**
 * Escolha do modelo do disparo (o que cada contato recebe) + prévia da sequência. As mensagens
 * são criadas e editadas em Modelos (/wa-templates); o disparo copia a sequência na criação.
 */
export function ModeloEscolha({ id, modelos, valor, onChange, name }: {
  id: string
  modelos: ModeloDisparo[]
  valor: string
  onChange: (id: string) => void
  /** Nome do campo quando o formulário é enviado por FormData (modo normal). */
  name?: string
}) {
  const escolhido = modelos.find(m => m.id === valor)

  if (!modelos.length) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
        Você ainda não tem modelo. As mensagens do disparo (texto, imagem, vídeo, áudio, documento e o tempo de digitação) ficam no modelo.{' '}
        <Link href="/wa-templates" className="font-medium text-primary hover:underline">Criar modelo</Link>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <select id={id} name={name} value={valor} required onChange={e => onChange(e.target.value)} className={SELECT}>
        <option value="" disabled>Escolha um modelo</option>
        {modelos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
      </select>

      {escolhido && (
        <ol className="space-y-1.5 rounded-xl border border-border bg-muted/30 px-3 py-3" aria-label={`Mensagens do modelo ${escolhido.nome}`}>
          {escolhido.passos.map((p, i) => (
            <li key={i} className="text-xs">
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {p.tipo === 'audio' ? 'Gravando áudio' : 'Digitando'}… {p.digitacao_seg} s
              </p>
              <div className="mt-0.5 flex items-start gap-2 text-foreground">
                <span className="mt-0.5 shrink-0 text-muted-foreground">{ICONE[p.tipo]}</span>
                <span className="min-w-0 flex-1">
                  {p.tipo === 'texto' ? (
                    <span className="line-clamp-3 whitespace-pre-line">{p.texto}</span>
                  ) : (
                    <span className="block truncate">
                      {TIPOS_MIDIA[p.tipo].rotulo}{p.nome_arquivo ? `: ${p.nome_arquivo}` : ''}
                      {p.legenda && <span className="text-muted-foreground"> · {p.legenda}</span>}
                    </span>
                  )}
                  {p.tipo === 'texto' && p.variacoes.length > 0 && (
                    <span className="block text-[11px] text-muted-foreground">
                      + {p.variacoes.length} variaç{p.variacoes.length === 1 ? 'ão' : 'ões'}, alternando a cada contato
                    </span>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">
        Para mudar as mensagens, edite em <Link href="/wa-templates" className="font-medium text-primary hover:underline">Modelos</Link>.
      </p>
    </div>
  )
}
