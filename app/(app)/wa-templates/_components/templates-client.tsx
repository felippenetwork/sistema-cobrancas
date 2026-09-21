'use client'

import { useActionState, useEffect, useState } from 'react'
import { Loader2, Plus, Pencil, Trash2, X } from 'lucide-react'
import { criarModeloAction, atualizarModeloAction, excluirModeloAction } from '../_actions'

type Modelo = { id: string; nome: string; corpo: string; criado_em: string }

const INPUT    = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary'
const TEXTAREA = INPUT + ' resize-none'
const LABEL    = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1'

export function TemplatesClient({ modelos: modelosIniciais }: { modelos: Modelo[] }) {
  const [modelos, setModelos]     = useState(modelosIniciais)
  const [sheetAberto, setSheetAberto] = useState(false)
  const [editando, setEditando]   = useState<Modelo | null>(null)
  const [excluindoId, setExcluindoId] = useState<string | null>(null)
  const [erroExclusao, setErroExclusao] = useState<string | null>(null)

  const [stateNovo, formActionNovo, isPendingNovo] = useActionState(criarModeloAction, { error: null })

  // A lista vem do server component (page.tsx); revalidatePath() nas actions
  // atualiza modelosIniciais a cada submit — sincroniza o estado local com isso.
  useEffect(() => { setModelos(modelosIniciais) }, [modelosIniciais])

  useEffect(() => {
    if (stateNovo.success) setSheetAberto(false)
  }, [stateNovo.success])

  function abrirNovo() {
    setEditando(null)
    setSheetAberto(true)
  }

  function abrirEdicao(m: Modelo) {
    setEditando(m)
    setSheetAberto(true)
  }

  async function handleExcluir(id: string) {
    setErroExclusao(null)
    const r = await excluirModeloAction(id)
    if (r.error) {
      setErroExclusao(r.error)
      setExcluindoId(null)
      return
    }
    setModelos(prev => prev.filter(m => m.id !== id))
    setExcluindoId(null)
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Modelos de disparo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Textos usados nas campanhas em massa (/disparos), enviados pelo WhatsApp conectado (QR Code).
          </p>
        </div>
        <button
          onClick={abrirNovo}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Novo modelo
        </button>
      </div>

      {erroExclusao && (
        <p className="mb-4 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{erroExclusao}</p>
      )}

      {modelos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhum modelo criado ainda. Crie um para usar nas suas campanhas de disparo.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modelos.map(m => (
            <div key={m.id} className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">{m.nome}</h2>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => abrirEdicao(m)}
                    className="rounded p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    aria-label="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setExcluindoId(m.id)}
                    className="rounded p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Excluir"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="line-clamp-4 text-xs text-muted-foreground">{m.corpo}</p>
            </div>
          ))}
        </div>
      )}

      {/* Confirmar exclusão */}
      {excluindoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setExcluindoId(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <p className="text-sm text-foreground">Excluir este modelo? Essa ação não pode ser desfeita.</p>
            <div className="flex gap-2">
              <button onClick={() => setExcluindoId(null)} className="flex-1 rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent">
                Cancelar
              </button>
              <button onClick={() => handleExcluir(excluindoId)} className="flex-1 rounded-xl bg-destructive px-3 py-2.5 text-sm font-medium text-destructive-foreground hover:opacity-90">
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sheet criar/editar */}
      {sheetAberto && (
        <ModeloSheet
          modelo={editando}
          formActionNovo={formActionNovo}
          isPendingNovo={isPendingNovo}
          erroNovo={stateNovo.error}
          onClose={() => setSheetAberto(false)}
          onSalvo={(atualizado) => {
            if (editando) {
              setModelos(prev => prev.map(m => m.id === atualizado.id ? atualizado : m))
            } else {
              setModelos(prev => [atualizado, ...prev])
            }
            setSheetAberto(false)
          }}
        />
      )}
    </div>
  )
}

function ModeloSheet({
  modelo, formActionNovo, isPendingNovo, erroNovo, onClose, onSalvo,
}: {
  modelo: Modelo | null
  formActionNovo: (formData: FormData) => void
  isPendingNovo: boolean
  erroNovo: string | null
  onClose: () => void
  onSalvo: (m: Modelo) => void
}) {
  const [nome, setNome]   = useState(modelo?.nome ?? '')
  const [corpo, setCorpo] = useState(modelo?.corpo ?? '')
  const [salvandoEdicao, setSalvandoEdicao] = useState(false)
  const [erroEdicao, setErroEdicao]         = useState<string | null>(null)

  async function salvarEdicao() {
    if (!modelo) return
    if (!nome.trim())  { setErroEdicao('Informe o nome do modelo.'); return }
    if (!corpo.trim()) { setErroEdicao('O texto da mensagem é obrigatório.'); return }
    setSalvandoEdicao(true)
    setErroEdicao(null)
    const r = await atualizarModeloAction(modelo.id, { nome: nome.trim(), corpo: corpo.trim() })
    setSalvandoEdicao(false)
    if (r.error) { setErroEdicao(r.error); return }
    onSalvo({ ...modelo, nome: nome.trim(), corpo: corpo.trim() })
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{modelo ? 'Editar modelo' : 'Novo modelo'}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {modelo ? (
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div>
              <label className={LABEL}>Nome do modelo</label>
              <input value={nome} onChange={e => setNome(e.target.value)} className={INPUT} placeholder="Promoção de setembro" />
            </div>
            <div>
              <label className={LABEL}>Mensagem</label>
              <textarea value={corpo} onChange={e => setCorpo(e.target.value)} rows={8} className={TEXTAREA} placeholder="Escreva o texto que será enviado…" />
            </div>
            {erroEdicao && <p className="text-sm text-destructive">{erroEdicao}</p>}
          </div>
        ) : (
          <form id="form-novo-modelo" action={formActionNovo} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div>
              <label className={LABEL}>Nome do modelo</label>
              <input name="nome" className={INPUT} placeholder="Promoção de setembro" />
            </div>
            <div>
              <label className={LABEL}>Mensagem</label>
              <textarea name="corpo" rows={8} className={TEXTAREA} placeholder="Escreva o texto que será enviado…" />
            </div>
            {erroNovo && <p className="text-sm text-destructive">{erroNovo}</p>}
          </form>
        )}

        <div className="flex items-center gap-3 border-t border-border px-6 py-4">
          {modelo ? (
            <button
              onClick={salvarEdicao}
              disabled={salvandoEdicao}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {salvandoEdicao && <Loader2 className="h-4 w-4 animate-spin" />}
              {salvandoEdicao ? 'Salvando...' : 'Salvar'}
            </button>
          ) : (
            <button
              type="submit" form="form-novo-modelo" disabled={isPendingNovo}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {isPendingNovo && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPendingNovo ? 'Criando...' : 'Criar'}
            </button>
          )}
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground">
            Cancelar
          </button>
        </div>
      </div>
    </>
  )
}
