'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, FileText, Image as ImageIcon, Loader2, Mic, Paperclip, Plus, Trash2, Type, Video } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { BUCKET_MIDIA, MAX_PASSOS, TAMANHO_MAX_MIDIA, TIPOS_MIDIA, digitacaoPadrao, type Passo, type TipoMidia } from '@/lib/disparo/passos'
import { prepararUploadMidiaAction } from '../_actions'

/** Passo em edição na tela (mídia pode estar sem arquivo ainda). */
export type PassoEditavel =
  | { chave: string; tipo: 'texto'; texto: string; variacoes: string[]; digitacao_seg: number }
  | { chave: string; tipo: TipoMidia; caminho: string | null; nome_arquivo: string | null; tamanho: number | null; legenda: string; digitacao_seg: number }

const INPUT = 'w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20'

const ICONE: Record<PassoEditavel['tipo'], React.ReactNode> = {
  texto:     <Type className="h-3.5 w-3.5" />,
  imagem:    <ImageIcon className="h-3.5 w-3.5" />,
  video:     <Video className="h-3.5 w-3.5" />,
  audio:     <Mic className="h-3.5 w-3.5" />,
  documento: <FileText className="h-3.5 w-3.5" />,
}

let seq = 0
const novaChave = () => `p${Date.now()}-${seq++}`

export function novoPasso(tipo: PassoEditavel['tipo'], indice: number): PassoEditavel {
  const digitacao_seg = digitacaoPadrao(indice)
  return tipo === 'texto'
    ? { chave: novaChave(), tipo, texto: '', variacoes: [], digitacao_seg }
    : { chave: novaChave(), tipo, caminho: null, nome_arquivo: null, tamanho: null, legenda: '', digitacao_seg }
}

/** Sequência gravada (modelo) → caixinhas editáveis. */
export function paraEditavel(passos: Passo[]): PassoEditavel[] {
  return passos.map(p => (p.tipo === 'texto'
    ? { chave: novaChave(), tipo: p.tipo, texto: p.texto, variacoes: p.variacoes, digitacao_seg: p.digitacao_seg }
    : { chave: novaChave(), tipo: p.tipo, caminho: p.caminho, nome_arquivo: p.nome_arquivo, tamanho: null, legenda: p.legenda ?? '', digitacao_seg: p.digitacao_seg }))
}

/** Caixinhas da tela → formato que o servidor valida (schemaPassos). */
export function paraEnvio(passos: PassoEditavel[]) {
  return passos.map(p => p.tipo === 'texto'
    ? { tipo: p.tipo, texto: p.texto, variacoes: p.variacoes, digitacao_seg: p.digitacao_seg }
    : { tipo: p.tipo, caminho: p.caminho ?? '', nome_arquivo: p.nome_arquivo, legenda: p.legenda.trim() || null, digitacao_seg: p.digitacao_seg })
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`

/** Tempo de "digitando…"/"gravando…" ANTES da caixinha — editável entre as caixinhas. */
function Digitacao({ passo, primeiro, onChange }: { passo: PassoEditavel; primeiro: boolean; onChange: (seg: number) => void }) {
  const verbo = passo.tipo === 'audio' ? 'Gravando áudio' : 'Digitando'
  return (
    <div className="flex items-center gap-2 py-1 pl-4 text-xs text-muted-foreground">
      <span aria-hidden className="h-4 border-l border-dashed border-border" />
      <label className="flex items-center gap-1.5">
        {verbo}… por
        <input
          type="number" min={0} max={120} value={passo.digitacao_seg}
          onChange={e => onChange(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
          aria-label={`Segundos de ${verbo.toLowerCase()} antes da mensagem`}
          className="w-14 rounded-lg border border-border bg-input px-2 py-1 text-center text-xs text-foreground tabular-nums outline-none focus-visible:border-primary"
        />
        s {primeiro ? 'antes da primeira mensagem (abertura da conversa)' : 'antes desta'}
      </label>
    </div>
  )
}

function CampoMidia({ passo, onChange }: {
  passo: Extract<PassoEditavel, { caminho: string | null }>
  onChange: (p: Partial<Extract<PassoEditavel, { caminho: string | null }>>) => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const info = TIPOS_MIDIA[passo.tipo]

  async function escolher(arquivo: File | undefined) {
    if (!arquivo) return
    setErro(null)
    if (!(info.mimes as readonly string[]).includes(arquivo.type)) { setErro(`Formato não aceito para ${info.rotulo.toLowerCase()}.`); return }
    if (arquivo.size > TAMANHO_MAX_MIDIA) { setErro('O arquivo passa de 16 MB, o limite do WhatsApp.'); return }

    setEnviando(true)
    const r = await prepararUploadMidiaAction({ tipo: passo.tipo, mime: arquivo.type, tamanho: arquivo.size, nome: arquivo.name })
    if (r.error || !r.caminho || !r.token) { setEnviando(false); setErro(r.error ?? 'Não foi possível enviar o arquivo.'); return }
    const { error } = await createClient().storage.from(BUCKET_MIDIA).uploadToSignedUrl(r.caminho, r.token, arquivo, { contentType: arquivo.type })
    setEnviando(false)
    if (error) { setErro('O envio do arquivo falhou. Tente de novo.'); return }
    onChange({ caminho: r.caminho, nome_arquivo: arquivo.name.slice(0, 200), tamanho: arquivo.size })
  }

  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground transition hover:border-primary focus-within:border-primary">
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        <span className="min-w-0 flex-1 truncate">
          {enviando ? 'Enviando arquivo…'
            : passo.nome_arquivo ? <><span className="text-foreground">{passo.nome_arquivo}</span>{passo.tamanho ? ` · ${mb(passo.tamanho)}` : ''} — trocar</>
            : `Escolher ${info.rotulo.toLowerCase()} (até 16 MB)`}
        </span>
        <input type="file" accept={info.mimes.join(',')} className="sr-only" disabled={enviando}
          onChange={e => { escolher(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
      {passo.tipo !== 'audio' && (
        <input value={passo.legenda} onChange={e => onChange({ legenda: e.target.value })} maxLength={1024}
          placeholder="Legenda (opcional) — aceita {{nome}} e {{periododia}}" aria-label="Legenda" className={INPUT} />
      )}
    </div>
  )
}

export function PassosEditor({ passos, onChange }: { passos: PassoEditavel[]; onChange: (p: PassoEditavel[]) => void }) {
  const atualizar = (i: number, patch: Partial<PassoEditavel>) =>
    onChange(passos.map((p, j) => (j === i ? ({ ...p, ...patch } as PassoEditavel) : p)))
  const mover = (i: number, d: -1 | 1) => {
    const nova = [...passos]
    ;[nova[i], nova[i + d]] = [nova[i + d], nova[i]]
    onChange(nova)
  }

  return (
    <div>
      {passos.map((p, i) => (
        <div key={p.chave}>
          <Digitacao passo={p} primeiro={i === 0} onChange={seg => atualizar(i, { digitacao_seg: seg })} />
          <div className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                {ICONE[p.tipo]}
                Mensagem {i + 1} · {p.tipo === 'texto' ? 'Texto' : TIPOS_MIDIA[p.tipo].rotulo}
              </span>
              <div className="ml-auto flex">
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir mensagem ${i + 1}`}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => mover(i, 1)} disabled={i === passos.length - 1} aria-label={`Descer mensagem ${i + 1}`}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => onChange(passos.filter((_, j) => j !== i))} disabled={passos.length === 1} aria-label={`Remover mensagem ${i + 1}`}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>

            {p.tipo === 'texto' ? (
              <>
                <textarea value={p.texto} onChange={e => atualizar(i, { texto: e.target.value })} rows={3} maxLength={4000}
                  aria-label={`Texto da mensagem ${i + 1}`} placeholder="{{periododia}}, {{nome}}! Tudo bem? …" className={INPUT + ' resize-y'} />
                {p.variacoes.map((v, k) => (
                  <div key={k} className="flex gap-2">
                    <textarea value={v} rows={2} maxLength={4000} aria-label={`Variação ${k + 1} da mensagem ${i + 1}`}
                      onChange={e => atualizar(i, { variacoes: p.variacoes.map((x, j) => (j === k ? e.target.value : x)) })}
                      placeholder={`Variação ${k + 1} — outro jeito de dizer o mesmo`} className={INPUT + ' resize-y'} />
                    <button type="button" onClick={() => atualizar(i, { variacoes: p.variacoes.filter((_, j) => j !== k) })}
                      aria-label={`Remover variação ${k + 1}`} className="h-10 shrink-0 rounded-lg px-2 text-muted-foreground hover:bg-accent hover:text-foreground">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {p.variacoes.length < 5 && (
                  <button type="button" onClick={() => atualizar(i, { variacoes: [...p.variacoes, ''] })}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    <Plus className="h-3.5 w-3.5" /> Variação (alterna a cada contato)
                  </button>
                )}
              </>
            ) : (
              <CampoMidia passo={p} onChange={patch => atualizar(i, patch)} />
            )}
          </div>
        </div>
      ))}

      {passos.length < MAX_PASSOS && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(['texto', 'imagem', 'video', 'audio', 'documento'] as const).map(tipo => (
            <button key={tipo} type="button" onClick={() => onChange([...passos, novoPasso(tipo, passos.length)])}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground">
              <Plus className="h-3 w-3" />
              {tipo === 'texto' ? 'Texto' : TIPOS_MIDIA[tipo].rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
