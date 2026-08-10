'use client'

import { useEffect, useState, useActionState, useTransition, useRef } from 'react'
import { Pencil, Trash2, Plus, Zap, X, Check } from 'lucide-react'
import {
  listarMensagensRapidasAction,
  criarMensagemRapidaAction,
  atualizarMensagemRapidaAction,
  excluirMensagemRapidaAction,
  type MensagemRapida,
} from './_actions'

// ── Estado inicial ────────────────────────────────────────────────────────────

const initResult = { error: null }

// ── Componente principal ──────────────────────────────────────────────────────

export default function MensagensRapidasPage() {
  const [mensagens, setMensagens]   = useState<MensagemRapida[]>([])
  const [carregando, setCarregando] = useState(true)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [editTitulo, setEditTitulo] = useState('')
  const [editTexto,  setEditTexto]  = useState('')
  const [editErro,   setEditErro]   = useState<string | null>(null)
  const [salvando,   startSalvar]   = useTransition()
  const [excluindo,  startExcluir]  = useTransition()
  const [mostrarForm, setMostrarForm] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const [createState, createAction, isCreating] = useActionState(criarMensagemRapidaAction, initResult)

  async function carregar() {
    setCarregando(true)
    const { data } = await listarMensagensRapidasAction()
    setMensagens(data)
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [])

  useEffect(() => {
    if (!createState.error && !isCreating && mostrarForm) {
      formRef.current?.reset()
      setMostrarForm(false)
      carregar()
    }
  }, [createState, isCreating])

  function iniciarEdicao(m: MensagemRapida) {
    setEditandoId(m.id)
    setEditTitulo(m.titulo)
    setEditTexto(m.texto)
    setEditErro(null)
  }

  function cancelarEdicao() {
    setEditandoId(null)
    setEditErro(null)
  }

  function salvarEdicao(id: string) {
    if (!editTitulo.trim()) { setEditErro('Título não pode estar vazio.'); return }
    if (!editTexto.trim())  { setEditErro('Texto não pode estar vazio.'); return }
    startSalvar(async () => {
      const res = await atualizarMensagemRapidaAction(id, { titulo: editTitulo, texto: editTexto })
      if (res.error) { setEditErro(res.error); return }
      setEditandoId(null)
      carregar()
    })
  }

  function excluir(id: string) {
    startExcluir(async () => {
      await excluirMensagemRapidaAction(id)
      carregar()
    })
  }

  return (
    <div className="p-6 max-w-3xl">
      {/* Cabeçalho */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Mensagens Rápidas</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Digite <span className="font-mono font-medium">/</span> no chat para inserir uma mensagem predefinida.
          </p>
        </div>
        <button
          onClick={() => setMostrarForm(v => !v)}
          className="flex items-center gap-1.5 rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nova mensagem
        </button>
      </div>

      {/* Formulário de criação */}
      {mostrarForm && (
        <div className="mb-4 rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-900">Nova mensagem rápida</h2>
          <form ref={formRef} action={createAction} className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                Título <span className="text-zinc-400 font-normal">(atalho para buscar)</span>
              </label>
              <input
                name="titulo"
                type="text"
                maxLength={100}
                placeholder="Ex: Saudação, Pix, Horário"
                required
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Texto da mensagem</label>
              <textarea
                name="texto"
                rows={3}
                placeholder="Olá! Como posso ajudar?"
                required
                className="w-full resize-none rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            {createState.error && (
              <p className="text-sm text-red-600">{createState.error}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setMostrarForm(false)}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isCreating}
                className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50 transition-colors"
              >
                {isCreating ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista */}
      {carregando ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100" />
          ))}
        </div>
      ) : mensagens.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Zap className="h-8 w-8 text-zinc-300" />
          <p className="text-sm font-medium text-zinc-500">Nenhuma mensagem rápida criada</p>
          <p className="text-xs text-zinc-400">Crie mensagens predefinidas para agilizar o atendimento.</p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
          {mensagens.map(m => (
            <div key={m.id} className="p-4">
              {editandoId === m.id ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={editTitulo}
                    onChange={e => setEditTitulo(e.target.value)}
                    maxLength={100}
                    className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <textarea
                    value={editTexto}
                    onChange={e => setEditTexto(e.target.value)}
                    rows={3}
                    className="w-full resize-none rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  {editErro && <p className="text-sm text-red-600">{editErro}</p>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => salvarEdicao(m.id)}
                      disabled={salvando}
                      className="flex items-center gap-1 rounded-md bg-blue-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50 transition-colors"
                    >
                      <Check className="h-3 w-3" />
                      {salvando ? 'Salvando…' : 'Salvar'}
                    </button>
                    <button
                      onClick={cancelarEdicao}
                      className="flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
                    >
                      <X className="h-3 w-3" />
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900">{m.titulo}</p>
                    <p className="mt-0.5 text-sm text-zinc-500 whitespace-pre-wrap">{m.texto}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => iniciarEdicao(m)}
                      aria-label="Editar mensagem"
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => excluir(m.id)}
                      disabled={excluindo}
                      aria-label="Excluir mensagem"
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
