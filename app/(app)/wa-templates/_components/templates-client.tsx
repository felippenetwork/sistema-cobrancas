'use client'

import { useEffect, useState } from 'react'
import { FileText, Image as ImageIcon, Loader2, Mic, Pencil, Plus, Trash2, Type, Video, X } from 'lucide-react'
import { criarModeloAction, atualizarModeloAction, excluirModeloAction } from '../_actions'
import { TIPOS_MIDIA, type Passo } from '@/lib/disparo/passos'
import { PassosEditor, novoPasso, paraEditavel, paraEnvio, type PassoEditavel } from '../../disparos/_components/passos-editor'

type Modelo = { id: string; nome: string; passos: Passo[]; criado_em: string }

const INPUT = 'w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20'
const LABEL = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground'

const ICONE: Record<Passo['tipo'], React.ReactNode> = {
  texto:     <Type className="h-3 w-3" />,
  imagem:    <ImageIcon className="h-3 w-3" />,
  video:     <Video className="h-3 w-3" />,
  audio:     <Mic className="h-3 w-3" />,
  documento: <FileText className="h-3 w-3" />,
}

export function TemplatesClient({ modelos: modelosIniciais }: { modelos: Modelo[] }) {
  const [modelos, setModelos]           = useState(modelosIniciais)
  const [editando, setEditando]         = useState<Modelo | 'novo' | null>(null)
  const [excluindoId, setExcluindoId]   = useState<string | null>(null)
  const [erroExclusao, setErroExclusao] = useState<string | null>(null)

  // A lista vem do server component (page.tsx); revalidatePath() nas actions a atualiza.
  useEffect(() => { setModelos(modelosIniciais) }, [modelosIniciais])

  async function handleExcluir(id: string) {
    setErroExclusao(null)
    const r = await excluirModeloAction(id)
    setExcluindoId(null)
    if (r.error) { setErroExclusao(r.error); return }
    setModelos(prev => prev.filter(m => m.id !== id))
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Modelos de disparo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            O que cada contato recebe num disparo: uma ou mais mensagens de texto, imagem, vídeo, áudio ou documento, com o tempo de digitação entre elas.
          </p>
        </div>
        <button
          onClick={() => setEditando('novo')}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Novo modelo
        </button>
      </div>

      {erroExclusao && (
        <p role="alert" className="mb-4 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{erroExclusao}</p>
      )}

      {modelos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">Nenhum modelo ainda. Crie um para escolher na hora do disparo.</p>
          <button onClick={() => setEditando('novo')}
            className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">
            Criar primeiro modelo
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modelos.map(m => {
            const texto = m.passos.find(p => p.tipo === 'texto')
            const segundos = m.passos.reduce((s, p) => s + p.digitacao_seg, 0)
            return (
              <div key={m.id} className="space-y-3 rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{m.nome}</h2>
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => setEditando(m)} aria-label={`Editar ${m.nome}`}
                      className="rounded p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setExcluindoId(m.id)} aria-label={`Excluir ${m.nome}`}
                      className="rounded p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {texto?.tipo === 'texto' && <p className="line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{texto.texto}</p>}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  {m.passos.map((p, i) => (
                    <span key={i} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                      {ICONE[p.tipo]} {p.tipo === 'texto' ? 'Texto' : TIPOS_MIDIA[p.tipo].rotulo}
                    </span>
                  ))}
                  <span className="tabular-nums">· {segundos} s de digitação</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {excluindoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setExcluindoId(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-5" onClick={e => e.stopPropagation()}>
            <p className="text-sm text-foreground">Excluir este modelo? Os disparos já criados com ele continuam iguais.</p>
            <div className="flex gap-2">
              <button onClick={() => setExcluindoId(null)} className="flex-1 rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent">
                Cancelar
              </button>
              <button onClick={() => handleExcluir(excluindoId)} className="flex-1 rounded-xl bg-destructive px-3 py-2.5 text-sm font-medium text-destructive-foreground hover:opacity-90">
                Excluir modelo
              </button>
            </div>
          </div>
        </div>
      )}

      {editando && (
        <ModeloSheet
          modelo={editando === 'novo' ? null : editando}
          onClose={() => setEditando(null)}
          onSalvo={m => {
            setModelos(prev => (prev.some(x => x.id === m.id) ? prev.map(x => (x.id === m.id ? m : x)) : [m, ...prev]))
            setEditando(null)
          }}
        />
      )}
    </div>
  )
}

function ModeloSheet({ modelo, onClose, onSalvo }: {
  modelo: Modelo | null
  onClose: () => void
  onSalvo: (m: Modelo) => void
}) {
  const [nome, setNome]         = useState(modelo?.nome ?? '')
  const [passos, setPassos]     = useState<PassoEditavel[]>(() => (modelo?.passos.length ? paraEditavel(modelo.passos) : [novoPasso('texto', 0)]))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro]         = useState<string | null>(null)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (passos.some(p => p.tipo !== 'texto' && !p.caminho)) { setErro('Uma mensagem de mídia ainda está sem arquivo.'); return }
    setSalvando(true)
    const entrada = { nome, passos: paraEnvio(passos) }
    const r = modelo ? await atualizarModeloAction(modelo.id, entrada) : await criarModeloAction(entrada)
    setSalvando(false)
    if (r.error || !r.id) { setErro(r.error ?? 'Não foi possível salvar o modelo.'); return }
    onSalvo({
      id: r.id, nome: nome.trim(), criado_em: modelo?.criado_em ?? new Date().toISOString(),
      passos: entrada.passos.map(p => (p.tipo === 'texto' ? { ...p, variacoes: p.variacoes.filter(Boolean) } : p)) as Passo[],
    })
  }

  const segundos = passos.reduce((s, p) => s + p.digitacao_seg, 0)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <form onSubmit={salvar} role="dialog" aria-modal="true" aria-labelledby="titulo-modelo"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="titulo-modelo" className="text-base font-semibold text-foreground">{modelo ? 'Editar modelo' : 'Novo modelo'}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <label htmlFor="modelo-nome" className={LABEL}>Nome do modelo</label>
            <input id="modelo-nome" value={nome} onChange={e => setNome(e.target.value)} required maxLength={80}
              className={INPUT} placeholder="Prospecção — apresentação" />
          </div>
          <section>
            <p className={LABEL + ' mb-0'}>Mensagens, na ordem em que chegam</p>
            <PassosEditor passos={passos} onChange={setPassos} />
            <p className="mt-2 text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1">{'{{nome}}'}</code> vira o nome do contato (some da frase se não houver) e <code className="rounded bg-muted px-1">{'{{periododia}}'}</code> vira Bom dia, Boa tarde ou Boa noite pela hora em que a mensagem sai.
              Cada contato leva cerca de <span className="tabular-nums">{segundos}</span> s entre digitação e envios.
            </p>
          </section>
          {erro && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{erro}</p>}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-6 py-4">
          <button type="submit" disabled={salvando}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            {salvando ? 'Salvando…' : modelo ? 'Salvar alterações' : 'Criar modelo'}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground transition hover:text-foreground">
            Cancelar
          </button>
        </div>
      </form>
    </>
  )
}
