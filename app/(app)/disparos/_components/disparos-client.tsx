'use client'

import { useState } from 'react'
import { Send, Plus, XCircle, CheckCircle, Clock, AlertCircle, Users, Loader2 } from 'lucide-react'
import { criarCampanhaAction, adicionarDestinatariosAction, enviarCampanhaAction, cancelarCampanhaAction } from '../_actions'

type Modelo  = { id: string; nome: string; status: string }
type Cliente = { id: string; nome: string | null; sobrenome: string | null; celular: string }

type Campanha = {
  id: string
  nome: string
  status: string
  total_destinatarios: number
  total_enviados: number
  total_falhas: number
  agendado_para: string | null
  iniciado_em: string | null
  concluido_em: string | null
  criado_em: string
  modelos_wa: { nome: string; status: string } | null
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  rascunho:  { label: 'Rascunho',  icon: <Clock className="h-3 w-3" />,                      cls: 'bg-muted text-muted-foreground' },
  agendada:  { label: 'Agendada',  icon: <Clock className="h-3 w-3" />,                      cls: 'bg-blue-500/15 text-blue-500' },
  enviando:  { label: 'Enviando',  icon: <Loader2 className="h-3 w-3 animate-spin" />,       cls: 'bg-amber-500/15 text-amber-500' },
  concluida: { label: 'Concluída', icon: <CheckCircle className="h-3 w-3" />,                cls: 'bg-green-500/15 text-green-500' },
  cancelada: { label: 'Cancelada', icon: <AlertCircle className="h-3 w-3" />,               cls: 'bg-muted text-muted-foreground' },
}

// ── Modal nova campanha (bottom sheet no mobile) ───────────────────────────────

function ModalNovaCampanha({
  modelos,
  clientes,
  onFechar,
}: {
  modelos: Modelo[]
  clientes: Cliente[]
  onFechar: () => void
}) {
  const [step, setStep]                 = useState<1 | 2>(1)
  const [campanhaId, setCampanhaId]     = useState<string | null>(null)
  const [criandoErr, setCriandoErr]     = useState<string | null>(null)
  const [criando, setCriando]           = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [busca, setBusca]               = useState('')
  const [enviando, setEnviando]         = useState(false)
  const [resultado, setResultado]       = useState<{ enviados: number; falhas: number } | null>(null)

  const clientesFiltrados = clientes.filter(c => {
    const nome = [c.nome, c.sobrenome].filter(Boolean).join(' ').toLowerCase()
    return nome.includes(busca.toLowerCase()) || c.celular.includes(busca)
  })

  function toggleCliente(cel: string) {
    setSelecionados(prev => {
      const next = new Set(prev)
      if (next.has(cel)) next.delete(cel)
      else next.add(cel)
      return next
    })
  }

  async function handleCriar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCriandoErr(null)
    setCriando(true)
    const fd = new FormData(e.currentTarget)
    const r  = await criarCampanhaAction({ error: null }, fd)
    setCriando(false)
    if (r.error) { setCriandoErr(r.error); return }
    if (r.id) { setCampanhaId(r.id); setStep(2) }
  }

  async function handleEnviar() {
    if (!campanhaId || selecionados.size === 0) return
    setEnviando(true)
    const r1 = await adicionarDestinatariosAction(campanhaId, [...selecionados])
    if (r1.error) { setEnviando(false); setCriandoErr(r1.error); return }
    const r2 = await enviarCampanhaAction(campanhaId)
    setEnviando(false)
    if (r2.error) { setCriandoErr(r2.error); return }
    setResultado({ enviados: r2.enviados ?? 0, falhas: r2.falhas ?? 0 })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 md:items-center md:justify-center md:p-4"
      onClick={e => e.target === e.currentTarget && onFechar()}
    >
      <div className="w-full rounded-t-2xl border border-border bg-card shadow-2xl md:max-w-xl md:rounded-xl">
        {/* Handle visual mobile */}
        <div className="flex justify-center pt-3 md:hidden">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            {resultado ? 'Campanha enviada!' : step === 1 ? 'Nova Campanha' : 'Selecionar Destinatários'}
          </h2>
          <button onClick={onFechar} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground">
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        {resultado ? (
          <div className="space-y-4 p-8 text-center" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 0px))' }}>
            <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
            <div>
              <p className="text-lg font-semibold text-foreground">{resultado.enviados} mensagens enviadas</p>
              {resultado.falhas > 0 && (
                <p className="text-sm text-muted-foreground">{resultado.falhas} falha{resultado.falhas !== 1 ? 's' : ''}</p>
              )}
            </div>
            <button
              onClick={onFechar}
              className="rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Fechar
            </button>
          </div>
        ) : step === 1 ? (
          <form onSubmit={handleCriar} className="space-y-4 p-5">
            {criandoErr && (
              <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{criandoErr}</p>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome da campanha</label>
              <input
                name="nome"
                required
                placeholder="Lembrete julho 2026"
                className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Template de mensagem</label>
              <select
                name="modelo_id"
                className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">Mensagem livre (sem template)</option>
                {modelos.map(m => (
                  <option key={m.id} value={m.id}>{m.nome} ({m.status})</option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Para uazapiGO use mensagem livre. API Meta requer template aprovado.
              </p>
            </div>
            <div
              className="flex gap-3 pt-1"
              style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom, 0px))' }}
            >
              <button
                type="button"
                onClick={onFechar}
                className="flex-1 rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground transition hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={criando}
                className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {criando ? 'Criando…' : 'Próximo →'}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4 p-5" style={{ maxHeight: '70dvh' }}>
            {criandoErr && (
              <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{criandoErr}</p>
            )}
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar cliente ou celular…"
              className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
            />
            <p className="text-xs text-muted-foreground">
              {selecionados.size} selecionado{selecionados.size !== 1 ? 's' : ''}
            </p>
            <div className="flex-1 overflow-y-auto space-y-1" style={{ maxHeight: '40dvh' }}>
              {clientesFiltrados.map(c => {
                const nome = [c.nome, c.sobrenome].filter(Boolean).join(' ') || c.celular
                const sel  = selecionados.has(c.celular)
                return (
                  <button
                    key={c.celular}
                    onClick={() => toggleCliente(c.celular)}
                    className={[
                      'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition',
                      sel ? 'bg-primary/10 text-foreground' : 'hover:bg-accent text-muted-foreground',
                    ].join(' ')}
                  >
                    <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${sel ? 'border-primary bg-primary' : 'border-border'}`}>
                      {sel && <CheckCircle className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <span className="truncate">{nome}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{c.celular}</span>
                  </button>
                )
              })}
            </div>
            <div
              className="flex gap-3 border-t border-border pt-4"
              style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom, 0px))' }}
            >
              <button
                onClick={() => setStep(1)}
                className="rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground transition hover:bg-accent"
              >
                ← Voltar
              </button>
              <button
                onClick={handleEnviar}
                disabled={selecionados.size === 0 || enviando}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {enviando ? `Enviando para ${selecionados.size}…` : `Enviar para ${selecionados.size}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────

export function DisparosClient({
  campanhas,
  modelos,
  clientes,
}: {
  campanhas: Campanha[]
  modelos: Modelo[]
  clientes: Cliente[]
}) {
  const [modalNovo, setModalNovo]   = useState(false)
  const [cancelando, setCancelando] = useState<string | null>(null)

  async function handleCancelar(id: string) {
    if (!confirm('Cancelar esta campanha?')) return
    setCancelando(id)
    await cancelarCampanhaAction(id)
    setCancelando(null)
  }

  return (
    <>
      {modalNovo && (
        <ModalNovaCampanha
          modelos={modelos}
          clientes={clientes}
          onFechar={() => setModalNovo(false)}
        />
      )}

      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold text-foreground">Disparos</h1>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Envie mensagens em massa para seus clientes.
            </p>
          </div>
          <button
            onClick={() => setModalNovo(true)}
            className="shrink-0 flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 active:opacity-80"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nova campanha</span>
            <span className="sm:hidden">Nova</span>
          </button>
        </div>

        {/* Lista */}
        {campanhas.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-14 text-center">
            <Send className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Nenhuma campanha ainda.</p>
            <button
              onClick={() => setModalNovo(true)}
              className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Criar primeira campanha
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {campanhas.map(c => {
              const st      = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.rascunho
              const enviados = c.total_enviados
              const total    = c.total_destinatarios
              const pct      = total > 0 ? Math.round((enviados / total) * 100) : 0

              return (
                <div key={c.id} className="rounded-2xl border border-border bg-card p-4 md:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{c.nome}</p>
                        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${st.cls}`}>
                          {st.icon}
                          {st.label}
                        </span>
                      </div>
                      {c.modelos_wa && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Template: {c.modelos_wa.nome}
                        </p>
                      )}

                      {/* Estatísticas */}
                      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {c.total_destinatarios}
                        </span>
                        <span className="flex items-center gap-1 text-green-500">
                          <CheckCircle className="h-3.5 w-3.5" />
                          {c.total_enviados}
                        </span>
                        {c.total_falhas > 0 && (
                          <span className="flex items-center gap-1 text-destructive">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {c.total_falhas}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Ação */}
                    {['rascunho', 'agendada'].includes(c.status) && (
                      <button
                        onClick={() => handleCancelar(c.id)}
                        disabled={cancelando === c.id}
                        className="shrink-0 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground transition hover:border-destructive hover:text-destructive disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>

                  {/* Barra de progresso */}
                  {total > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                        <span>Progresso</span>
                        <span>{pct}% ({enviados}/{total})</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
