'use client'

import { useActionState, useState, useEffect, useCallback, useRef } from 'react'
import {
  Loader2, Pencil, X, MessageSquare, Mail,
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Search,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { NOTIF_TIPOS } from '@/lib/notificacao/tipos'
import { NOTIF_DEFAULTS } from '@/lib/notificacao/tipos'
import { toggleCanalAction, salvarTemplateAction, seedNotificacoesAction } from './_actions/notificacao'

const TEXTAREA = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary resize-none'
const INPUT    = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary'
const LABEL    = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'

type Config = {
  tipo: string; horario: string
  ativo_whatsapp: boolean; ativo_email: boolean
  template_whatsapp: string | null; assunto_email: string | null; template_email: string | null
}

const PER_PAGE_OPTIONS = [10, 25, 50]

// Badge de cor por tipo
const TIPO_META: Record<string, { label: string; cls: string }> = {
  '5d':                   { label: '5 dias antes',          cls: 'bg-warning/20 text-warning' },
  '3d':                   { label: '3 dias antes',          cls: 'bg-warning/20 text-warning' },
  '2d':                   { label: '2 dias antes',          cls: 'bg-warning/20 text-warning' },
  '1d':                   { label: '1 dia antes',           cls: 'bg-warning/20 text-warning' },
  'dia':                  { label: 'No dia',                cls: 'bg-primary/20 text-primary' },
  'vencido1d':            { label: 'Vencida',               cls: 'bg-destructive/20 text-destructive' },
  'manual':               { label: 'Cobrança manual',       cls: 'bg-primary/20 text-primary' },
  'boasvindas':           { label: 'Boas-vindas',           cls: 'bg-success/20 text-success' },
  'pagamento_confirmado': { label: 'Pagamento confirmado',  cls: 'bg-success/20 text-success' },
}

// ── Formulário de edição (em Sheet) ─────────────────────────────────────────
function EditSheet({
  cfg,
  onClose,
  onSaved,
}: {
  cfg: Config
  onClose: () => void
  onSaved: () => void
}) {
  const [state, formAction, isPending] = useActionState(salvarTemplateAction, { error: null })

  useEffect(() => {
    if (state.success) { onSaved(); onClose() }
  }, [state.success, onSaved, onClose])

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">
            Editar — {TIPO_META[cfg.tipo]?.label ?? cfg.tipo}
          </h2>
          <button onClick={onClose} aria-label="Fechar"
            className="rounded-md p-1 text-muted-foreground transition hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <form id="edit-notif-form" action={formAction} className="space-y-4">
            <input type="hidden" name="tipo" value={cfg.tipo} />

            <div className="space-y-1.5">
              <label className={LABEL}>Horário de envio</label>
              <input type="time" name="horario" defaultValue={cfg.horario} className={INPUT} />
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" /> Template WhatsApp
              </label>
              <textarea name="template_whatsapp" rows={5}
                defaultValue={cfg.template_whatsapp ?? ''} className={TEXTAREA} />
              <p className="text-xs text-muted-foreground">
                Variáveis: #NOME# #NOMECOMPLETO# #VALOR# #VENCIMENTO# #PIX# #SAUDACAO#
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Mail className="h-3.5 w-3.5" /> Assunto do e-mail
              </label>
              <input type="text" name="assunto_email"
                defaultValue={cfg.assunto_email ?? ''} className={INPUT} />
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Mail className="h-3.5 w-3.5" /> Corpo do e-mail
              </label>
              <textarea name="template_email" rows={5}
                defaultValue={cfg.template_email ?? ''} className={TEXTAREA} />
            </div>

            {state.error && (
              <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">{state.error}</p>
            )}
          </form>
        </div>

        <div className="flex items-center gap-3 border-t border-border px-6 py-4">
          <button type="submit" form="edit-notif-form" disabled={isPending}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? 'Salvando...' : 'Salvar'}
          </button>
          <button type="button" onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground">
            Voltar
          </button>
        </div>
      </div>
    </>
  )
}

// ── Página principal ─────────────────────────────────────────────────────────
export default function NotificacaoPage() {
  const [configs, setConfigs]     = useState<Config[]>([])
  const [loading, setLoading]     = useState(true)
  const [editando, setEditando]   = useState<Config | null>(null)
  const [toggling, setToggling]   = useState<string | null>(null)
  const [buscaInput, setBuscaInput] = useState('')
  const [busca, setBusca]         = useState('')
  const [perPage, setPerPage]     = useState(10)
  const [page, setPage]           = useState(1)

  const fetchConfigs = useCallback(async () => {
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const { data: conta } = await sb.from('contas').select('id').eq('owner_user_id', user.id).single()
    if (!conta) return

    let { data } = await sb.from('notificacoes_config')
      .select('*').eq('conta_id', (conta as any).id).order('created_at')

    // Seed se não existir nenhum config, ou se faltar algum tipo (novo tipo adicionado)
    if (!data?.length || data.length < NOTIF_DEFAULTS.length) {
      await seedNotificacoesAction()
      const { data: seeded } = await sb.from('notificacoes_config')
        .select('*').eq('conta_id', (conta as any).id)
      data = seeded
    }
    setConfigs((data as Config[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchConfigs() }, [fetchConfigs])

  async function handleToggleWA(cfg: Config) {
    setToggling(cfg.tipo)
    await toggleCanalAction(cfg.tipo, 'whatsapp', !cfg.ativo_whatsapp)
    await fetchConfigs()
    setToggling(null)
  }

  // Filtro + paginação client-side
  const filtrados = configs.filter(c => {
    if (!busca) return true
    const meta = TIPO_META[c.tipo]
    return meta?.label.toLowerCase().includes(busca.toLowerCase())
  })
  const totalPages = Math.ceil(filtrados.length / perPage)
  const inicio     = filtrados.length === 0 ? 0 : (page - 1) * perPage + 1
  const fim        = Math.min(page * perPage, filtrados.length)
  const pagina     = filtrados.slice((page - 1) * perPage, page * perPage)

  function handleBuscar(e: React.FormEvent) {
    e.preventDefault()
    setBusca(buscaInput)
    setPage(1)
  }

  if (loading) return (
    <div className="flex min-h-[40vh] items-center justify-center p-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )

  return (
    <div className="p-8">

      {/* Linha 1 — por página + busca */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Exibir
          <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1) }}
            className="rounded-md border border-border bg-input px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary">
            {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          resultados por página
        </div>

        <form onSubmit={handleBuscar} className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={buscaInput} onChange={e => setBuscaInput(e.target.value)}
              placeholder="Buscar registros"
              className="w-56 rounded-md border border-border bg-input py-2 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary" />
          </div>
          {busca && (
            <button type="button" onClick={() => { setBuscaInput(''); setBusca(''); setPage(1) }}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground">
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
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Tipo</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Horário</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Prévia</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">Ativo/Inativo</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">Editar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pagina.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  Nenhum resultado.
                </td>
              </tr>
            ) : (
              pagina.map((cfg, i) => {
                const meta    = TIPO_META[cfg.tipo]
                const isAtivo = cfg.ativo_whatsapp
                const preview = cfg.template_whatsapp?.replace(/#\w+#/g, m => m) ?? '—'

                return (
                  <tr key={cfg.tipo} className="bg-card transition-colors hover:bg-accent/20">
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {(page - 1) * perPage + i + 1}
                    </td>

                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${meta?.cls ?? 'bg-muted text-muted-foreground'}`}>
                        {meta?.label ?? cfg.tipo}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        isAtivo
                          ? 'bg-success/15 text-success'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {isAtivo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>

                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {cfg.horario}
                    </td>

                    <td className="max-w-xs px-4 py-3 text-muted-foreground">
                      <span className="block truncate text-xs">{preview}</span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggleWA(cfg)}
                        disabled={toggling === cfg.tipo}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                          isAtivo
                            ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
                            : 'bg-success/15 text-success hover:bg-success/25'
                        }`}
                      >
                        {toggling === cfg.tipo && <Loader2 className="h-3 w-3 animate-spin" />}
                        {isAtivo ? 'Desativar' : 'Ativar'}
                      </button>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setEditando(cfg)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-warning/20 px-3 py-1.5 text-xs font-medium text-warning transition hover:bg-warning/30"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </button>
                    </td>
                  </tr>
                )
              })
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

      {/* Sheet de edição */}
      {editando && (
        <EditSheet
          cfg={editando}
          onClose={() => setEditando(null)}
          onSaved={fetchConfigs}
        />
      )}

    </div>
  )
}
