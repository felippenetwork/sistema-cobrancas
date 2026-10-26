'use client'

import { useState } from 'react'
import { Send, Plus, XCircle, CheckCircle, Clock, AlertCircle, Users, Loader2, Pause, Play, SkipForward, TrendingUp } from 'lucide-react'
import {
  criarCampanhaAction, adicionarDestinatariosAction, enviarCampanhaAction,
  cancelarCampanhaAction, pausarCampanhaAction, retomarCampanhaAction,
} from '../_actions'
import { quotaDoDia } from '@/lib/disparo/progressivo'
import { ProgressivoForm } from './progressivo-form'
import { AcoesEditor } from './acoes-editor'
import { acoesLegadas, descreverAcao, lerAcoes, type Acao } from '@/lib/disparo/acoes'
import { ModeloEscolha, type ModeloDisparo as Modelo } from './modelo-escolha'
import { FluxoEscolha, type FluxoDisparo } from './fluxo-escolha'

type Cliente = { id: string; nome: string | null; sobrenome: string | null; celular: string }

type Campanha = {
  id: string
  nome: string
  status: string
  tipo: 'normal' | 'progressivo'
  total_destinatarios: number
  total_enviados: number
  total_falhas: number
  total_pulados: number
  agendado_para: string | null
  iniciado_em: string | null
  concluido_em: string | null
  criado_em: string
  janela_inicio: string | null
  janela_fim: string | null
  prog_inicio: number | null
  prog_maximo: number | null
  prog_dia: number
  prog_planejado_em: string | null
  registrar_enviados: boolean
  excluir_ja_enviados: boolean
  passos: unknown[] | null
  etiqueta_adicionar_nome: string | null
  etiqueta_remover_nome: string | null
  acoes: unknown
  modelos_wa: { nome: string; status: string } | null
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  rascunho:  { label: 'Rascunho',  icon: <Clock className="h-3 w-3" />,                      cls: 'bg-muted text-muted-foreground' },
  agendada:  { label: 'Agendada',  icon: <Clock className="h-3 w-3" />,                      cls: 'bg-blue-500/15 text-blue-500' },
  enviando:  { label: 'Enviando',  icon: <Loader2 className="h-3 w-3 animate-spin" />,       cls: 'bg-amber-500/15 text-amber-500' },
  pausada:   { label: 'Pausada',   icon: <Pause className="h-3 w-3" />,                      cls: 'bg-muted text-muted-foreground' },
  concluida: { label: 'Concluída', icon: <CheckCircle className="h-3 w-3" />,                cls: 'bg-green-500/15 text-green-500' },
  cancelada: { label: 'Cancelada', icon: <AlertCircle className="h-3 w-3" />,               cls: 'bg-muted text-muted-foreground' },
}

const hhmm = (h: string | null) => (h ?? '').slice(0, 5)

/** "Dia 3 · 3 envios hoje (ciclo 1→20) · 09:00–18:00" */
function resumoProgressivo(c: Campanha): string {
  const ini = c.prog_inicio ?? 1
  const max = c.prog_maximo ?? ini
  const janela = `${hhmm(c.janela_inicio)}–${hhmm(c.janela_fim)}`
  if (c.prog_dia === 0) return `Começa com ${ini} por dia · ciclo ${ini}→${max} · ${janela}`
  const hoje = quotaDoDia(c.prog_dia - 1, ini, max)
  return `Dia ${c.prog_dia} · ${hoje} envio${hoje === 1 ? '' : 's'} no dia · ciclo ${ini}→${max} · ${janela}`
}

// ── Opções de registro (modo normal) ───────────────────────────────────────────

function OpcaoRegistro({ name, defaultChecked, titulo, descricao }: {
  name: string; defaultChecked?: boolean; titulo: string; descricao: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 accent-primary" />
      <span>
        <span className="block text-sm font-medium text-foreground">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{descricao}</span>
      </span>
    </label>
  )
}

// ── Modal novo disparo (bottom sheet no mobile) ───────────────────────────────

function ModalNovaCampanha({
  modelos,
  clientes,
  fluxos,
  onFechar,
}: {
  modelos: Modelo[]
  clientes: Cliente[]
  fluxos: FluxoDisparo[]
  onFechar: () => void
}) {
  const [step, setStep]                 = useState<'tipo' | 1 | 2 | 'progressivo'>('tipo')
  const [campanhaId, setCampanhaId]     = useState<string | null>(null)
  const [criandoErr, setCriandoErr]     = useState<string | null>(null)
  const [criando, setCriando]           = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [busca, setBusca]               = useState('')
  const [enviando, setEnviando]         = useState(false)
  const [enviada, setEnviada]           = useState(false)
  const [pulados, setPulados]           = useState(0)
  const [acoes, setAcoes]               = useState<Acao[]>(modelos.length === 1 ? modelos[0].acoes : [])
  const [modeloId, setModeloIdBruto]    = useState(modelos.length === 1 ? modelos[0].id : '')
  const setModeloId = (id: string) => { setModeloIdBruto(id); setAcoes(modelos.find(m => m.id === id)?.acoes ?? []) }
  const [fluxoId, setFluxoId]           = useState('')

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
    setEnviada(true)
  }

  const titulo = enviada ? 'Disparo iniciado'
    : step === 'tipo' ? 'Novo disparo'
    : step === 'progressivo' ? 'Disparo progressivo'
    : step === 1 ? 'Nova campanha' : 'Selecionar destinatários'

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 md:items-center md:justify-center md:p-4"
      onClick={e => e.target === e.currentTarget && onFechar()}
    >
      <div className="w-full rounded-t-2xl border border-border bg-card shadow-sm md:max-w-xl md:rounded-xl">
        {/* Handle visual mobile */}
        <div className="flex justify-center pt-3 md:hidden">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
          <button onClick={onFechar} aria-label="Fechar" className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground">
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        {enviada ? (
          <div className="space-y-4 p-8 text-center" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 0px))' }}>
            <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
            <div>
              <p className="text-lg font-semibold text-foreground">Disparo na fila de envio</p>
              <p className="mt-1 text-sm text-muted-foreground">
                As mensagens saem aos poucos, no ritmo seguro — acompanhe o progresso na lista de disparos.
              </p>
              {pulados > 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  <span className="tabular-nums">{pulados}</span> número{pulados === 1 ? '' : 's'} já tinha{pulados === 1 ? '' : 'm'} recebido antes e {pulados === 1 ? 'foi pulado' : 'foram pulados'}.
                </p>
              )}
            </div>
            <button
              onClick={onFechar}
              className="rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Fechar
            </button>
          </div>
        ) : step === 'tipo' ? (
          <div className="space-y-3 p-5" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom, 0px))' }}>
            <button
              onClick={() => setStep(1)}
              className="flex w-full items-start gap-3 rounded-xl border border-border p-4 text-left transition hover:border-primary focus-visible:border-primary focus-visible:outline-none"
            >
              <Send className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-medium text-foreground">Normal</span>
                <span className="block text-xs text-muted-foreground">Escolha clientes e um modelo. As mensagens saem uma após a outra, no ritmo seguro.</span>
              </span>
            </button>
            <button
              onClick={() => setStep('progressivo')}
              className="flex w-full items-start gap-3 rounded-xl border border-border p-4 text-left transition hover:border-primary focus-visible:border-primary focus-visible:outline-none"
            >
              <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-medium text-foreground">Progressivo</span>
                <span className="block text-xs text-muted-foreground">Cole uma lista de números. Começa com poucos envios por dia e aumenta um por dia até o limite, em horários aleatórios da janela.</span>
              </span>
            </button>
          </div>
        ) : step === 'progressivo' ? (
          <ProgressivoForm
            modelos={modelos}
            fluxos={fluxos}
            onVoltar={() => setStep('tipo')}
            onConcluido={n => { setPulados(n); setEnviada(true) }}
          />
        ) : step === 1 ? (
          <form onSubmit={handleCriar} className="space-y-4 p-5">
            {criandoErr && (
              <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{criandoErr}</p>
            )}
            <div>
              <label htmlFor="camp-nome" className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome da campanha</label>
              <input
                id="camp-nome"
                name="nome"
                required
                placeholder="Lembrete julho 2026"
                className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="camp-modelo" className="mb-1.5 block text-xs font-medium text-muted-foreground">Modelo (as mensagens que cada cliente recebe)</label>
              <ModeloEscolha id="camp-modelo" name="modelo_id" modelos={modelos} valor={modeloId} onChange={setModeloId} />
            </div>
            <div className="space-y-2">
              <FluxoEscolha id="camp-fluxo" name="fluxo_id" fluxos={fluxos} valor={fluxoId} onChange={setFluxoId} />
              <AcoesEditor name="acoes" acoes={acoes} onChange={setAcoes} ajuda="O que fazer na conversa de cada cliente depois que as mensagens saem, nesta ordem. Vem do modelo; mudar aqui vale só para este disparo." />
              <OpcaoRegistro name="registrar_enviados" defaultChecked titulo="Registrar quem receber"
                descricao="Guarda cada número que recebeu, para os próximos disparos poderem pular." />
              <OpcaoRegistro name="excluir_ja_enviados" titulo="Não enviar para quem já recebeu"
                descricao="Pula os números registrados em disparos anteriores." />
            </div>
            <div
              className="flex gap-3 pt-1"
              style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom, 0px))' }}
            >
              <button
                type="button"
                onClick={() => setStep('tipo')}
                className="flex-1 rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground transition hover:bg-accent"
              >
                ← Voltar
              </button>
              <button
                type="submit"
                disabled={criando || !modeloId}
                className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {criando ? 'Criando…' : 'Próximo →'}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4 p-5" style={{ maxHeight: '70dvh' }}>
            {criandoErr && (
              <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{criandoErr}</p>
            )}
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar cliente ou celular…"
              aria-label="Buscar cliente ou celular"
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
  fluxos,
}: {
  campanhas: Campanha[]
  modelos: Modelo[]
  clientes: Cliente[]
  fluxos: FluxoDisparo[]
}) {
  const [modalNovo, setModalNovo] = useState(false)
  const [ocupado, setOcupado]     = useState<string | null>(null)
  const [erro, setErro]           = useState<string | null>(null)

  async function executar(id: string, acao: (id: string) => Promise<{ error: string | null }>, confirmar?: string) {
    if (confirmar && !confirm(confirmar)) return
    setErro(null)
    setOcupado(id)
    const r = await acao(id)
    setOcupado(null)
    if (r.error) setErro(r.error)
  }

  return (
    <>
      {modalNovo && (
        <ModalNovaCampanha
          modelos={modelos}
          clientes={clientes}
          fluxos={fluxos}
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
              Envie mensagens em massa, de uma vez ou aos poucos.
            </p>
          </div>
          <button
            onClick={() => setModalNovo(true)}
            className="shrink-0 flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 active:opacity-80"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo disparo</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </div>

        {erro && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}

        {/* Lista */}
        {campanhas.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-14 text-center">
            <Send className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Nenhum disparo ainda.</p>
            <button
              onClick={() => setModalNovo(true)}
              className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Criar primeiro disparo
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {campanhas.map(c => {
              const st       = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.rascunho
              const enviados = c.total_enviados
              const total    = c.total_destinatarios
              const feitos   = c.total_enviados + c.total_falhas + (c.total_pulados ?? 0)
              const pct      = total > 0 ? Math.round((feitos / total) * 100) : 0
              const emAndamento = c.status === 'enviando' || c.status === 'pausada'

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
                        {c.tipo === 'progressivo' && (
                          <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            <TrendingUp className="h-3 w-3" />
                            Progressivo
                          </span>
                        )}
                      </div>
                      {c.tipo === 'progressivo' && (
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{resumoProgressivo(c)}</p>
                      )}
                      {(c.modelos_wa || (c.passos && c.passos.length > 1)) && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {c.modelos_wa && `Modelo: ${c.modelos_wa.nome}`}
                          {c.modelos_wa && c.passos && c.passos.length > 1 && ' · '}
                          {c.passos && c.passos.length > 1 && `${c.passos.length} mensagens por contato`}
                        </p>
                      )}
                      {(() => {
                        const lista = lerAcoes(c.acoes)
                        const acoesCard = lista.length ? lista : acoesLegadas({ etiqueta_adicionar: c.etiqueta_adicionar_nome, etiqueta_remover: c.etiqueta_remover_nome })
                        return acoesCard.length > 0 && (
                          <p className="mt-0.5 text-xs text-muted-foreground">Depois de enviar: {acoesCard.map(descreverAcao).join(' → ')}</p>
                        )
                      })()}

                      {/* Estatísticas */}
                      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1" title="Na lista">
                          <Users className="h-3.5 w-3.5" />
                          <span className="tabular-nums">{c.total_destinatarios}</span>
                        </span>
                        <span className="flex items-center gap-1 text-green-500" title="Enviados">
                          <CheckCircle className="h-3.5 w-3.5" />
                          <span className="tabular-nums">{c.total_enviados}</span>
                        </span>
                        {(c.total_pulados ?? 0) > 0 && (
                          <span className="flex items-center gap-1" title="Pulados — já tinham recebido antes">
                            <SkipForward className="h-3.5 w-3.5" />
                            <span className="tabular-nums">{c.total_pulados}</span>
                          </span>
                        )}
                        {c.total_falhas > 0 && (
                          <span className="flex items-center gap-1 text-destructive" title="Falharam">
                            <AlertCircle className="h-3.5 w-3.5" />
                            <span className="tabular-nums">{c.total_falhas}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="flex shrink-0 gap-2">
                      {c.status === 'enviando' && (
                        <button
                          onClick={() => executar(c.id, pausarCampanhaAction)}
                          disabled={ocupado === c.id}
                          aria-label={`Pausar ${c.nome}`}
                          className="flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                        >
                          <Pause className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Pausar</span>
                        </button>
                      )}
                      {c.status === 'pausada' && (
                        <button
                          onClick={() => executar(c.id, retomarCampanhaAction)}
                          disabled={ocupado === c.id}
                          aria-label={`Retomar ${c.nome}`}
                          className="flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                        >
                          <Play className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Retomar</span>
                        </button>
                      )}
                      {(['rascunho', 'agendada'].includes(c.status) || emAndamento) && (
                        <button
                          onClick={() => executar(c.id, cancelarCampanhaAction, 'Cancelar este disparo? Quem ainda não recebeu não vai receber.')}
                          disabled={ocupado === c.id}
                          className="rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground transition hover:border-destructive hover:text-destructive disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Barra de progresso */}
                  {total > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                        <span>Progresso</span>
                        <span className="tabular-nums">{pct}% ({enviados}/{total})</span>
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
