'use client'

import { useActionState, useState, useEffect, useRef } from 'react'
import {
  Loader2, Plus, Search, Star, Pencil, X,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  criarMeioAction,
  editarMeioAction,
  definirPadraoAction,
  excluirMeioAction,
} from './_actions/meios'

type Meio = { id: string; nome: string; mensagem: string; is_padrao: boolean }

const PER_PAGE_OPTIONS = [10, 25, 50]

const INPUT =
  'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary'
const LABEL = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'

export default function TipoPagamentoPage() {
  const [stateNovo, formActionNovo, isPendingNovo] = useActionState(criarMeioAction,  { error: null })
  const [stateEdit, formActionEdit, isPendingEdit] = useActionState(editarMeioAction, { error: null })
  const formNovoRef = useRef<HTMLFormElement>(null)

  const [meios, setMeios]           = useState<Meio[]>([])
  const [loading, setLoading]       = useState(true)
  const [buscaInput, setBuscaInput] = useState('')
  const [busca, setBusca]           = useState('')
  const [perPage, setPerPage]       = useState(10)
  const [page, setPage]             = useState(1)
  const [sheetAberto, setSheetAberto]   = useState(false)
  const [editando, setEditando]         = useState<Meio | null>(null)
  const [editPadrao, setEditPadrao]     = useState(false)
  const [excluindoId, setExcluindoId]   = useState<string | null>(null)
  const [refresh, setRefresh]       = useState(0)

  // ── Buscar meios ─────────────────────────────────────────────────────────────
  async function fetchMeios() {
    setLoading(true)
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const { data: conta } = await sb.from('contas').select('id').eq('owner_user_id', user.id).single()
    if (!conta) return
    const { data } = await sb.from('meios_pagamento').select('*').eq('conta_id', (conta as any).id).order('created_at')
    setMeios((data as Meio[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchMeios() }, [refresh])

  useEffect(() => {
    if (stateNovo.success) {
      setSheetAberto(false)
      formNovoRef.current?.reset()
      setRefresh(r => r + 1)
    }
  }, [stateNovo.success])

  useEffect(() => {
    if (stateEdit.success) {
      setEditando(null)
      setRefresh(r => r + 1)
    }
  }, [stateEdit.success])

  // ── Filtro + paginação client-side ───────────────────────────────────────────
  const filtrados = meios.filter(m =>
    !busca ||
    m.nome.toLowerCase().includes(busca.toLowerCase()) ||
    m.mensagem.toLowerCase().includes(busca.toLowerCase()),
  )
  const totalPages = Math.ceil(filtrados.length / perPage)
  const inicio     = filtrados.length === 0 ? 0 : (page - 1) * perPage + 1
  const fim        = Math.min(page * perPage, filtrados.length)
  const pagina     = filtrados.slice((page - 1) * perPage, page * perPage)

  function handleBuscar(e: React.FormEvent) {
    e.preventDefault()
    setBusca(buscaInput)
    setPage(1)
  }

  function abrirEdicao(m: Meio) {
    setEditando(m)
    setEditPadrao(m.is_padrao)
  }

  async function handleExcluir(id: string) {
    const sb = createClient()
    await sb.from('meios_pagamento').delete().eq('id', id)
    setExcluindoId(null)
    setRefresh(r => r + 1)
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="p-8">

      {/* Linha 1 — botão */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => setSheetAberto(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Novo meio de pagamento
        </button>
      </div>

      {/* Linha 2 — por página + busca */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Exibir
          <select
            value={perPage}
            onChange={e => { setPerPage(Number(e.target.value)); setPage(1) }}
            className="rounded-md border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          >
            {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          resultados por página
        </div>

        <form onSubmit={handleBuscar} className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={buscaInput}
              onChange={e => setBuscaInput(e.target.value)}
              placeholder="Buscar registros"
              className="w-56 rounded-md border border-border bg-input py-2 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary"
            />
          </div>
          {busca && (
            <button
              type="button"
              onClick={() => { setBuscaInput(''); setBusca(''); setPage(1) }}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Limpar
            </button>
          )}
        </form>
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="w-12 px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">#</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Nome</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Texto</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">Editar</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">Deletar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : pagina.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                  {busca ? 'Nenhum resultado para esta busca.' : 'Nenhum meio de pagamento cadastrado ainda.'}
                </td>
              </tr>
            ) : (
              pagina.map((m, i) => (
                <tr key={m.id} className="bg-card transition-colors hover:bg-accent/20">
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {(page - 1) * perPage + i + 1}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{m.nome}</span>
                      {m.is_padrao && (
                        <span className="flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                          <Star className="h-3 w-3 fill-warning" />
                          Padrão
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-muted-foreground">
                    <span className="block truncate">{m.mensagem}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => abrirEdicao(m)}
                      aria-label="Editar"
                      className="inline-flex items-center gap-1.5 rounded-md bg-warning/20 px-3 py-1.5 text-xs font-medium text-warning transition hover:bg-warning/30"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Editar
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {excluindoId === m.id ? (
                      <div className="flex items-center justify-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Confirmar?</span>
                        <button
                          onClick={() => handleExcluir(m.id)}
                          className="text-xs font-medium text-destructive hover:opacity-80"
                        >
                          Sim
                        </button>
                        <button
                          onClick={() => setExcluindoId(null)}
                          className="text-xs text-muted-foreground hover:opacity-80"
                        >
                          Não
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setExcluindoId(m.id)}
                        aria-label="Excluir"
                        className="inline-flex items-center gap-1.5 rounded-md bg-destructive/15 px-3 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/25"
                      >
                        <X className="h-3.5 w-3.5" />
                        Deletar
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {filtrados.length === 0
            ? 'Nenhum registro'
            : `Mostrando de ${inicio} até ${fim} de ${filtrados.length} registro${filtrados.length !== 1 ? 's' : ''}`}
        </span>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
              <ChevronsLeft className="h-3.5 w-3.5" /> Primeiro
            </button>
            <button onClick={() => setPage(p => p - 1)} disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
              <ChevronLeft className="h-3.5 w-3.5" /> Anterior
            </button>
            <span className="px-3 py-1.5 text-xs">Pág. {page} de {totalPages}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
              Próximo <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
              Último <ChevronsRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── Sheet — Editar ──────────────────────────────────────────────────────── */}
      {editando && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setEditando(null)} />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-base font-semibold text-foreground">Editar Pix</h2>
              <button onClick={() => setEditando(null)} aria-label="Fechar"
                className="rounded-md p-1 text-muted-foreground transition hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <form id="edit-meio-form" action={formActionEdit} className="space-y-4">
                <input type="hidden" name="meio_id"   value={editando.id} />
                <input type="hidden" name="is_padrao" value={String(editPadrao)} />

                <div className="space-y-1.5">
                  <label className={LABEL}>Nome *</label>
                  <input type="text" name="nome" required defaultValue={editando.nome} className={INPUT} />
                </div>

                <div className="space-y-1.5">
                  <label className={LABEL}>Chave ou instrução Pix *</label>
                  <textarea name="mensagem" required rows={3} defaultValue={editando.mensagem}
                    className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary resize-none" />
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" id="edit-padrao" checked={editPadrao}
                    onChange={e => setEditPadrao(e.target.checked)} className="h-4 w-4 accent-primary" />
                  <label htmlFor="edit-padrao" className="cursor-pointer text-sm text-foreground">
                    Definir como padrão
                  </label>
                </div>

                {stateEdit.error && (
                  <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">{stateEdit.error}</p>
                )}
              </form>
            </div>

            <div className="flex items-center gap-3 border-t border-border px-6 py-4">
              <button type="submit" form="edit-meio-form" disabled={isPendingEdit}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
                {isPendingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPendingEdit ? 'Salvando...' : 'Salvar alterações'}
              </button>
              <button type="button" onClick={() => setEditando(null)}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground">
                Voltar
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Sheet — Novo meio de pagamento ─────────────────────────────────────── */}
      {sheetAberto && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setSheetAberto(false)} />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-base font-semibold text-foreground">Novo meio de pagamento</h2>
              <button onClick={() => setSheetAberto(false)} aria-label="Fechar"
                className="rounded-md p-1 text-muted-foreground transition hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <form id="novo-meio-form" ref={formNovoRef} action={formActionNovo} className="space-y-4">
                <input type="hidden" name="is_padrao" value={String(meios.length === 0)} />

                <div className="space-y-1.5">
                  <label className={LABEL}>Nome *</label>
                  <input type="text" name="nome" required placeholder="Pix principal" className={INPUT} />
                </div>

                <div className="space-y-1.5">
                  <label className={LABEL}>Chave ou instrução Pix *</label>
                  <textarea name="mensagem" required rows={3} placeholder="Pix: 00.000.000/0001-00"
                    className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary resize-none" />
                  <p className="text-xs text-muted-foreground">
                    Este texto será inserido onde aparecer #PIX# nos templates.
                  </p>
                </div>

                {stateNovo.error && (
                  <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">{stateNovo.error}</p>
                )}
              </form>
            </div>

            <div className="flex items-center gap-3 border-t border-border px-6 py-4">
              <button type="submit" form="novo-meio-form" disabled={isPendingNovo}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
                {isPendingNovo && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPendingNovo ? 'Salvando...' : 'Adicionar'}
              </button>
              <button type="button" onClick={() => setSheetAberto(false)}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground">
                Voltar
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  )
}
