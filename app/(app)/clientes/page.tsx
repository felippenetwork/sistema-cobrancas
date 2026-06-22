'use client'

import { useActionState, useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  Search, Plus, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, X, Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatarCelular } from '@/lib/validations/celular'
import { criarClienteAction } from './_actions/clientes'
import { criarCobrancaRapidaAction } from '../cobrancas/_actions/cobrancas'

type Filtro = 'todos' | 'ativos' | 'inativos'
type Cliente = {
  id: string
  nome: string
  sobrenome: string
  celular: string
  email: string | null
}

const PER_PAGE_OPTIONS = [10, 25, 50]

function hoje() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

const INPUT =
  'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary'
const LABEL = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'

export default function ClientesPage() {
  const [state,    formAction,    isPending]    = useActionState(criarClienteAction,        { error: null })
  const [stateCob, formActionCob, isPendingCob] = useActionState(criarCobrancaRapidaAction, { error: null })
  const formRef    = useRef<HTMLFormElement>(null)
  const formCobRef = useRef<HTMLFormElement>(null)

  const [clientes, setClientes]     = useState<Cliente[]>([])
  const [total, setTotal]           = useState(0)
  const [loading, setLoading]       = useState(true)
  const [filtro, setFiltro]         = useState<Filtro>('todos')
  const [buscaInput, setBuscaInput] = useState('')
  const [busca, setBusca]           = useState('')
  const [page, setPage]             = useState(1)
  const [perPage, setPerPage]       = useState(10)
  const [sheetAberto, setSheetAberto]       = useState(false)
  const [sheetCob, setSheetCob]             = useState(false)
  const [novoClienteId, setNovoClienteId]   = useState('')
  const [novoClienteNome, setNovoClienteNome] = useState('')
  const [recorrente, setRecorrente]         = useState(false)
  const [excluindoId, setExcluindoId]       = useState<string | null>(null)
  const [refresh, setRefresh]       = useState(0)

  const totalPages = Math.ceil(total / perPage)
  const inicio     = total === 0 ? 0 : (page - 1) * perPage + 1
  const fim        = Math.min(page * perPage, total)

  // ── Buscar clientes ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      const sb = createClient()

      let query = sb
        .from('clientes')
        .select('id, nome, sobrenome, celular, email', { count: 'exact' })
        .is('deleted_at', null)
        .order('nome', { ascending: true })
        .range((page - 1) * perPage, page * perPage - 1)

      if (busca) {
        query = query.or(
          `nome.ilike.%${busca}%,sobrenome.ilike.%${busca}%,email.ilike.%${busca}%,celular.ilike.%${busca}%`,
        )
      }

      const { data, count } = await query
      if (!cancelled) {
        setClientes((data as Cliente[]) ?? [])
        setTotal(count ?? 0)
        setLoading(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, [page, perPage, busca, filtro, refresh])

  // ── Após criar cliente: fecha sheet 1 e abre sheet de cobrança ───────────────
  useEffect(() => {
    if (state.success && state.clienteId) {
      setSheetAberto(false)
      formRef.current?.reset()
      setNovoClienteId(state.clienteId)
      setNovoClienteNome(state.clienteNome ?? '')
      setRecorrente(false)
      setSheetCob(true)
      setRefresh((r) => r + 1)
    }
  }, [state.success])

  // ── Após criar cobrança: fecha sheet 2 ───────────────────────────────────────
  useEffect(() => {
    if (stateCob.success) {
      setSheetCob(false)
      formCobRef.current?.reset()
    }
  }, [stateCob.success])

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function handleBuscar(e: React.FormEvent) {
    e.preventDefault()
    setBusca(buscaInput)
    setPage(1)
  }

  function handleFiltro(f: Filtro) {
    setFiltro(f)
    setPage(1)
  }

  async function handleExcluir(id: string) {
    const sb = createClient()
    await sb
      .from('clientes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    setExcluindoId(null)
    setRefresh((r) => r + 1)
  }

  function handleLimparBusca() {
    setBuscaInput('')
    setBusca('')
    setPage(1)
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="p-8">

      {/* Linha 1 — botão + tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setSheetAberto(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Novo Cliente
        </button>

        <div className="flex overflow-hidden rounded-md border border-border">
          {(['todos', 'ativos', 'inativos'] as Filtro[]).map((f) => (
            <button
              key={f}
              onClick={() => handleFiltro(f)}
              className={`px-4 py-2 text-sm transition ${
                filtro === f
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {f === 'todos' ? 'Todos' : f === 'ativos' ? 'Ativos' : 'Inativos'}
            </button>
          ))}
        </div>
      </div>

      {/* Linha 2 — por página + busca */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Exibir
          <select
            value={perPage}
            onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1) }}
            className="rounded-md border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          resultados por página
        </div>

        <form onSubmit={handleBuscar} className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={buscaInput}
              onChange={(e) => setBuscaInput(e.target.value)}
              placeholder="Buscar registros"
              className="w-56 rounded-md border border-border bg-input py-2 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary"
            />
          </div>
          {busca && (
            <button
              type="button"
              onClick={handleLimparBusca}
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
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Celular</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">E-mail</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : clientes.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                  {busca
                    ? 'Nenhum cliente encontrado para esta busca.'
                    : 'Nenhum cliente cadastrado ainda.'}
                </td>
              </tr>
            ) : (
              clientes.map((c, i) => (
                <tr key={c.id} className="bg-card transition-colors hover:bg-accent/20">
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {(page - 1) * perPage + i + 1}
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {c.nome} {c.sobrenome}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {formatarCelular(c.celular)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.email ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/clientes/${c.id}`}
                        className="text-xs text-primary transition hover:opacity-80"
                      >
                        Editar
                      </Link>

                      {excluindoId === c.id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">Excluir?</span>
                          <button
                            onClick={() => handleExcluir(c.id)}
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
                          onClick={() => setExcluindoId(c.id)}
                          className="text-xs text-destructive transition hover:opacity-70"
                        >
                          Excluir
                        </button>
                      )}
                    </div>
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
          {total === 0
            ? 'Nenhum registro'
            : `Mostrando ${inicio} até ${fim} de ${total} registro${total !== 1 ? 's' : ''}`}
        </span>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
              Primeiro
            </button>
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Anterior
            </button>
            <span className="px-3 py-1.5 text-xs">
              Pág. {page} de {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Próximo
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Último
              <ChevronsRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── Sheet — Criar Cobrança ─────────────────────────────────────────────── */}
      {sheetCob && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setSheetCob(false)} />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Criar Cobrança</h2>
                <p className="text-xs text-muted-foreground">{novoClienteNome}</p>
              </div>
              <button onClick={() => setSheetCob(false)} aria-label="Fechar"
                className="rounded-md p-1 text-muted-foreground transition hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <form id="nova-cobranca-form" ref={formCobRef} action={formActionCob} className="space-y-4">
                <input type="hidden" name="cliente_id" value={novoClienteId} />
                <input type="hidden" name="recorrente"  value={String(recorrente)} />

                <div className="space-y-1.5">
                  <label className={LABEL}>Valor da mensalidade (R$) *</label>
                  <input type="text" name="valor" required placeholder="150,00" className={INPUT} />
                </div>

                <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-3">
                  <input id="rec-cob" type="checkbox" checked={recorrente}
                    onChange={e => setRecorrente(e.target.checked)}
                    className="h-4 w-4 rounded accent-primary" />
                  <label htmlFor="rec-cob" className="cursor-pointer select-none text-sm text-foreground">
                    Recorrente (sem data de término)
                  </label>
                </div>

                {!recorrente && (
                  <div className="space-y-1.5">
                    <label className={LABEL}>Quantidade de meses *</label>
                    <input type="number" name="qtd_meses" min="1" max="360" placeholder="12" className={INPUT} />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className={LABEL}>Primeiro vencimento *</label>
                  <input type="date" name="primeiro_vencimento" required
                    defaultValue={hoje()} min={hoje()} className={INPUT} />
                </div>

                <div className="space-y-1.5">
                  <label className={LABEL}>Observação</label>
                  <textarea name="observacao" rows={2} placeholder="Opcional..."
                    className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary resize-none" />
                </div>

                <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-3">
                  <input id="boas-vindas-cob" type="checkbox" name="enviar_boas_vindas" value="true"
                    className="h-4 w-4 rounded accent-primary" />
                  <label htmlFor="boas-vindas-cob" className="cursor-pointer select-none text-sm text-foreground">
                    Enviar mensagem de boas-vindas no WhatsApp
                  </label>
                </div>

                {stateCob.error && (
                  <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">{stateCob.error}</p>
                )}
              </form>
            </div>

            <div className="flex items-center gap-3 border-t border-border px-6 py-4">
              <button type="submit" form="nova-cobranca-form" disabled={isPendingCob}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
                {isPendingCob && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPendingCob ? 'Salvando...' : 'Criar cobrança'}
              </button>
              <button type="button" onClick={() => setSheetCob(false)}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground">
                Agora não
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Sheet — Cadastro de Cliente ────────────────────────────────────────── */}
      {sheetAberto && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setSheetAberto(false)}
          />

          {/* Painel lateral */}
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-2xl">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-base font-semibold text-foreground">
                Cadastro de Cliente
              </h2>
              <button
                onClick={() => setSheetAberto(false)}
                aria-label="Fechar"
                className="rounded-md p-1 text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Formulário */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <form
                id="novo-cliente-form"
                ref={formRef}
                action={formAction}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className={LABEL}>Nome *</label>
                    <input
                      type="text"
                      name="nome"
                      required
                      placeholder="João"
                      className={INPUT}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className={LABEL}>Sobrenome *</label>
                    <input
                      type="text"
                      name="sobrenome"
                      required
                      placeholder="Silva"
                      className={INPUT}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className={LABEL}>CPF</label>
                  <input
                    type="text"
                    name="cpf"
                    placeholder="000.000.000-00"
                    maxLength={14}
                    className={INPUT}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={LABEL}>Celular / WhatsApp *</label>
                  <input
                    type="text"
                    name="celular"
                    required
                    placeholder="(11) 99999-9999"
                    className={INPUT}
                  />
                  <p className="text-xs text-muted-foreground">Inclua o DDD.</p>
                </div>

                <div className="space-y-1.5">
                  <label className={LABEL}>E-mail</label>
                  <input
                    type="email"
                    name="email"
                    placeholder="joao@email.com"
                    className={INPUT}
                  />
                </div>

                {state.error && (
                  <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">
                    {state.error}
                  </p>
                )}
              </form>
            </div>

            {/* Rodapé */}
            <div className="flex items-center gap-3 border-t border-border px-6 py-4">
              <button
                type="submit"
                form="novo-cliente-form"
                disabled={isPending}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? 'Salvando...' : 'Cadastrar cliente'}
              </button>
              <button
                type="button"
                onClick={() => setSheetAberto(false)}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
              >
                Voltar
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  )
}
