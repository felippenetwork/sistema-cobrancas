'use client'

import {
  useEffect, useRef, useState, useActionState, useCallback, useMemo,
} from 'react'
import {
  ArrowLeft, Send, MessageSquare, Clock, CheckCircle, XCircle,
  ArrowRightLeft, Inbox, History, Plus, Search, User, Pencil,
  ChevronRight, Phone, Mail, X, Loader2, RefreshCw, ExternalLink,
  CreditCard,
} from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  enviarRespostaAction, marcarLidaAction, enviarTemplateAction,
  iniciarConversaAction, atualizarClienteAction,
} from './_actions/mensagens'
import {
  aceitarAtendimentoAction, finalizarAtendimentoAction,
  transferirAtendimentoAction, buscarDepartamentosEMembrosAction,
} from './_actions/atendimentos'
import {
  buscarParcelaClienteAction, renovarParcelaAction,
} from './_actions/renovar'

// ── Tipos ─────────────────────────────────────────────────────────────────────

type AtendimentoStatus = 'aguardando' | 'em_atendimento' | 'finalizado'

type Atendimento = {
  id: string
  numero: number
  conta_id: string
  celular: string
  status: AtendimentoStatus
  atendente_id: string | null
  ultima_mensagem: string | null
  ultima_msg_em: string | null
  criado_em: string
  aceito_em: string | null
  finalizado_em: string | null
  departamento_id: string | null
  cliente_id: string | null
  clientes: { nome: string | null; sobrenome: string | null; email: string | null } | null
  departamentos: { nome: string; cor: string } | null
}

type Mensagem = {
  id: string
  celular: string
  direcao: 'in' | 'out'
  texto: string
  recebido_em: string
  lida: boolean
}

type Membro      = { id: string; user_id: string; nome: string }
type Departamento = { id: string; nome: string; cor: string }
type MetaTemplate = { id: string; name: string; language: string; body: string; category: string }

type ClienteBusca = {
  id: string
  nome: string
  sobrenome: string | null
  celular: string
  email: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TAB_CONFIG: {
  status: AtendimentoStatus
  label: string
  labelCurto: string
  Icon: React.ComponentType<{ className?: string }>
}[] = [
  { status: 'em_atendimento', label: 'Em Atendimento', labelCurto: 'Ativos',    Icon: MessageSquare },
  { status: 'aguardando',     label: 'Pendentes',       labelCurto: 'Pendentes', Icon: Inbox },
  { status: 'finalizado',     label: 'Finalizados',     labelCurto: 'Histórico', Icon: History },
]

function nomeAtendimento(at: Atendimento): string {
  if (at.clientes?.nome) {
    return [at.clientes.nome, at.clientes.sobrenome].filter(Boolean).join(' ')
  }
  return at.celular
}

function nomeCliente(c: ClienteBusca): string {
  return [c.nome, c.sobrenome].filter(Boolean).join(' ')
}

function iniciais(nome: string): string {
  const parts = nome.trim().split(' ').filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return nome.slice(0, 2).toUpperCase()
}

function formatarTempo(iso: string): string {
  const d   = new Date(iso)
  const ago = Date.now() - d.getTime()
  if (ago < 60_000)     return 'agora'
  if (ago < 3_600_000)  return `${Math.floor(ago / 60_000)}m`
  if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)}h`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}

function formatarHora(iso: string): string {
  const d   = new Date(iso)
  const ago = Date.now() - d.getTime()
  if (ago < 86_400_000) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}

function calcularJanela(ultimaMsgIn: Date | null): { label: string; aberta: boolean } {
  if (!ultimaMsgIn) return { label: 'Sem msg do cliente', aberta: false }
  const restante = ultimaMsgIn.getTime() + 86_400_000 - Date.now()
  if (restante <= 0) return { label: 'Janela expirada', aberta: false }
  const h = Math.floor(restante / 3_600_000)
  const m = Math.floor((restante % 3_600_000) / 60_000)
  return { label: `Janela: ${h}h ${m}m`, aberta: true }
}

// ── JanelaTimer ───────────────────────────────────────────────────────────────

function JanelaTimer({ ultimaMsgIn }: { ultimaMsgIn: Date | null }) {
  const [janela, setJanela] = useState(() => calcularJanela(ultimaMsgIn))
  useEffect(() => {
    setJanela(calcularJanela(ultimaMsgIn))
    const id = setInterval(() => setJanela(calcularJanela(ultimaMsgIn)), 60_000)
    return () => clearInterval(id)
  }, [ultimaMsgIn])
  return (
    <span className={[
      'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
      janela.aberta
        ? 'bg-green-500/15 text-green-400'
        : 'bg-amber-500/15 text-amber-500',
    ].join(' ')}>
      <Clock className="h-2.5 w-2.5" />
      {janela.label}
    </span>
  )
}

// ── ModalTransferir ───────────────────────────────────────────────────────────

function ModalTransferir({
  departamentos, membros, onConfirmar, onFechar, carregando,
}: {
  departamentos: Departamento[]
  membros: Membro[]
  onConfirmar: (depId: string, atendenteId?: string) => void
  onFechar: () => void
  carregando: boolean
}) {
  const [depId, setDepId] = useState('')
  const [memId, setMemId] = useState('')

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/60 md:items-center md:justify-center md:p-4"
      onClick={e => e.target === e.currentTarget && onFechar()}
    >
      <div className="w-full rounded-t-2xl border border-border bg-card shadow-2xl md:max-w-sm md:rounded-xl">
        <div className="flex justify-center pt-3 md:hidden">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Transferir Atendimento</h2>
          <button onClick={onFechar} className="rounded p-1.5 text-muted-foreground hover:text-foreground">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Departamento</label>
            <select
              value={depId} onChange={e => setDepId(e.target.value)}
              className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">Selecionar departamento…</option>
              {departamentos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Atribuir a (opcional)</label>
            <select
              value={memId} onChange={e => setMemId(e.target.value)}
              className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">Qualquer atendente</option>
              {membros.map(m => <option key={m.id} value={m.user_id}>{m.nome}</option>)}
            </select>
          </div>
        </div>
        <div
          className="flex gap-2 border-t border-border px-5 py-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            onClick={onFechar}
            className="flex-1 rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground transition hover:bg-accent"
          >Cancelar</button>
          <button
            onClick={() => depId && onConfirmar(depId, memId || undefined)}
            disabled={!depId || carregando}
            className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >{carregando ? 'Transferindo…' : 'Transferir'}</button>
        </div>
      </div>
    </div>
  )
}

// ── ModalTemplatePicker (janela expirada) ─────────────────────────────────────

function ModalTemplatePicker({
  templates, carregandoTemplates, erroTemplates,
  onEnviar, onFechar, onAtualizar, carregandoEnvio, erroEnvio,
}: {
  templates: MetaTemplate[]
  carregandoTemplates: boolean
  erroTemplates: string | null
  onEnviar: (tmpl: MetaTemplate) => void
  onFechar: () => void
  onAtualizar: () => void
  carregandoEnvio: boolean
  erroEnvio: string | null
}) {
  const [sel, setSel] = useState<MetaTemplate | null>(null)

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/60 md:items-center md:justify-center md:p-4"
      onClick={e => e.target === e.currentTarget && onFechar()}
    >
      <div className="w-full rounded-t-2xl border border-border bg-card shadow-2xl md:max-w-sm md:rounded-xl">
        <div className="flex justify-center pt-3 md:hidden">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Iniciar conversa</h2>
            <p className="text-xs text-muted-foreground">Cobrado pela Meta por conversa iniciada</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onAtualizar}
              disabled={carregandoTemplates}
              title="Atualizar templates da Meta"
              className="rounded p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${carregandoTemplates ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onFechar} className="rounded p-1.5 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto space-y-1 p-3">
          {carregandoTemplates ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando templates…
            </div>
          ) : erroTemplates ? (
            <div className="py-4 text-center">
              <p className="text-xs text-destructive">{erroTemplates}</p>
              <button
                onClick={onAtualizar}
                className="mt-3 flex items-center gap-1.5 mx-auto rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
              >
                <RefreshCw className="h-3 w-3" /> Tentar novamente
              </button>
            </div>
          ) : templates.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Nenhum template aprovado encontrado.
            </p>
          ) : (
            templates.map(t => (
              <button
                key={t.id}
                onClick={() => setSel(t)}
                className={[
                  'flex w-full items-start gap-3 rounded-xl p-3 text-left transition',
                  sel?.id === t.id ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-accent',
                ].join(' ')}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                      {t.language}
                    </span>
                    <span className={[
                      'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                      t.category === 'UTILITY' ? 'bg-blue-500/15 text-blue-400' : 'bg-orange-500/15 text-orange-400',
                    ].join(' ')}>
                      {t.category === 'UTILITY' ? 'utility' : 'marketing'}
                    </span>
                  </div>
                  {t.body && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.body}</p>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {erroEnvio && <p className="px-5 pb-1 text-xs text-destructive">{erroEnvio}</p>}

        <div
          className="flex gap-2 border-t border-border px-5 py-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            onClick={onFechar}
            className="flex-1 rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground transition hover:bg-accent"
          >Cancelar</button>
          <button
            onClick={() => sel && onEnviar(sel)}
            disabled={!sel || carregandoEnvio || carregandoTemplates}
            className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >{carregandoEnvio ? 'Enviando…' : 'Enviar template'}</button>
        </div>
      </div>
    </div>
  )
}

// ── ModalNovaConversa — pesquisa cliente + template picker ────────────────────

function ModalNovaConversa({
  contaId,
  templates,
  carregandoTemplates,
  onEnviar,
  onFechar,
  onAtualizar,
}: {
  contaId: string
  templates: MetaTemplate[]
  carregandoTemplates: boolean
  onEnviar: (celular: string, clienteId: string | null, tmpl: MetaTemplate) => void
  onFechar: () => void
  onAtualizar: () => void
}) {
  const sb = createClient()

  // Etapa 1: busca de cliente; Etapa 2: seleção de template
  const [step, setStep]             = useState<1 | 2>(1)
  const [query, setQuery]           = useState('')
  const [resultados, setResultados] = useState<ClienteBusca[]>([])
  const [buscando, setBuscando]     = useState(false)
  const [clienteSel, setClienteSel] = useState<ClienteBusca | null>(null)
  const [celularManual, setCelularManual] = useState('')
  const [tmplSel, setTmplSel]       = useState<MetaTemplate | null>(null)

  // Busca debounced
  useEffect(() => {
    if (query.trim().length < 2) { setResultados([]); return }
    const timer = setTimeout(async () => {
      setBuscando(true)
      const { data } = await sb
        .from('clientes')
        .select('id, nome, sobrenome, celular, email')
        .eq('conta_id', contaId)
        .is('deleted_at', null)
        .or(`nome.ilike.%${query}%,celular.ilike.%${query}%`)
        .order('nome')
        .limit(8)
      setResultados((data ?? []) as ClienteBusca[])
      setBuscando(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, contaId, sb])

  function selecionarCliente(c: ClienteBusca) {
    setClienteSel(c)
    setStep(2)
  }

  function usarCelularManual() {
    const cel = query.replace(/\D/g, '')
    if (cel.length < 10) return
    setCelularManual(cel)
    setClienteSel(null)
    setStep(2)
  }

  const celularFinal  = clienteSel?.celular ?? celularManual
  const clienteIdFinal = clienteSel?.id ?? null
  const nomeFinal     = clienteSel ? nomeCliente(clienteSel) : celularManual

  // Detecta se o query parece um número de celular
  const pareceNumero = /^\d[\d\s()-]{8,}$/.test(query.trim())

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/60 md:items-center md:justify-center md:p-4"
      onClick={e => e.target === e.currentTarget && onFechar()}
    >
      <div className="w-full rounded-t-2xl border border-border bg-card shadow-2xl md:max-w-md md:rounded-xl">
        <div className="flex justify-center pt-3 md:hidden">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            {step === 2 && (
              <button
                onClick={() => { setStep(1); setTmplSel(null) }}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {step === 1 ? 'Nova conversa' : 'Escolher template'}
              </h2>
              {step === 2 && (
                <p className="text-xs text-muted-foreground">
                  Enviando para: <span className="text-foreground font-medium">{nomeFinal}</span>
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {step === 2 && (
              <button
                onClick={onAtualizar}
                disabled={carregandoTemplates}
                title="Atualizar templates da Meta"
                className="rounded p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${carregandoTemplates ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button onClick={onFechar} className="rounded p-1.5 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Etapa 1: Busca */}
        {step === 1 && (
          <>
            <div className="px-5 pt-4 pb-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Nome ou número de celular…"
                  className="w-full rounded-xl border border-border bg-input py-2.5 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                {buscando && (
                  <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto px-3 pb-3">
              {resultados.map(c => (
                <button
                  key={c.id}
                  onClick={() => selecionarCliente(c)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-accent"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {iniciais(nomeCliente(c))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{nomeCliente(c)}</p>
                    <p className="text-xs text-muted-foreground">{c.celular}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}

              {/* Opção de usar celular direto */}
              {pareceNumero && (
                <button
                  onClick={usarCelularManual}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-accent"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Phone className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Usar número: {query.replace(/\D/g, '')}</p>
                    <p className="text-xs text-muted-foreground">Enviar template direto para este número</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              )}

              {query.trim().length >= 2 && !buscando && resultados.length === 0 && !pareceNumero && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Nenhum cliente encontrado. Tente um número de celular.
                </p>
              )}

              {query.trim().length < 2 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Digite o nome ou número do cliente para buscar.
                </p>
              )}
            </div>
          </>
        )}

        {/* Etapa 2: Seleção de template */}
        {step === 2 && (
          <>
            <div className="max-h-64 overflow-y-auto space-y-1 p-3">
              {carregandoTemplates ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Carregando templates…
                </div>
              ) : templates.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Nenhum template aprovado. Configure os templates no Meta Business.
                </p>
              ) : (
                templates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTmplSel(t)}
                    className={[
                      'flex w-full items-start gap-3 rounded-xl p-3 text-left transition',
                      tmplSel?.id === t.id ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-accent',
                    ].join(' ')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-medium text-foreground">{t.name}</p>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                          {t.language}
                        </span>
                        <span className={[
                          'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                          t.category === 'UTILITY' ? 'bg-blue-500/15 text-blue-400' : 'bg-orange-500/15 text-orange-400',
                        ].join(' ')}>
                          {t.category === 'UTILITY' ? 'utility' : 'marketing'}
                        </span>
                      </div>
                      {t.body && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.body}</p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div
              className="flex gap-2 border-t border-border px-5 py-4"
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
            >
              <button
                onClick={onFechar}
                className="flex-1 rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground transition hover:bg-accent"
              >Cancelar</button>
              <button
                onClick={() => tmplSel && onEnviar(celularFinal, clienteIdFinal, tmplSel)}
                disabled={!tmplSel || !celularFinal}
                className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >Iniciar conversa</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── PainelCliente — painel direito com info editável do cliente ───────────────

function PainelCliente({
  atendimento,
  onFechar,
  onClienteAtualizado,
}: {
  atendimento: Atendimento
  onFechar: () => void
  onClienteAtualizado: () => void
}) {
  const [editando, setEditando]     = useState(false)
  const [nome, setNome]             = useState(atendimento.clientes?.nome ?? '')
  const [sobrenome, setSobrenome]   = useState(atendimento.clientes?.sobrenome ?? '')
  const [salvando, setSalvando]     = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  // Parcela + renovar
  const [cobrancaId, setCobrancaId]               = useState<string | null>(null)
  const [parcelaAberta, setParcelaAberta]         = useState<{ id: string; valor: number; dataVencimento: string } | null>(null)
  const [carregandoParcela, setCarregandoParcela] = useState(false)
  const [mostrarModalRenovar, setMostrarModalRenovar] = useState(false)
  const [renovando, setRenovando]                 = useState(false)
  const [erroRenovar, setErroRenovar]             = useState<string | null>(null)
  const [renovadoOk, setRenovadoOk]               = useState(false)

  // Sincroniza quando atendimento muda
  useEffect(() => {
    setNome(atendimento.clientes?.nome ?? '')
    setSobrenome(atendimento.clientes?.sobrenome ?? '')
    setEditando(false)
    setErroSalvar(null)
    setRenovadoOk(false)
    setMostrarModalRenovar(false)
  }, [atendimento.id, atendimento.clientes])

  // Carrega parcela aberta do cliente
  useEffect(() => {
    if (!atendimento.cliente_id) return
    setCarregandoParcela(true)
    buscarParcelaClienteAction(atendimento.cliente_id).then(data => {
      setCobrancaId(data?.cobrancaId ?? null)
      setParcelaAberta(data?.parcela ?? null)
      setCarregandoParcela(false)
    })
  }, [atendimento.cliente_id])

  async function salvar() {
    if (!atendimento.cliente_id) return
    setSalvando(true)
    setErroSalvar(null)
    const r = await atualizarClienteAction(atendimento.cliente_id, nome, sobrenome)
    setSalvando(false)
    if (r.error) { setErroSalvar(r.error) } else { setEditando(false); onClienteAtualizado() }
  }

  async function handleRenovar() {
    if (!parcelaAberta || !cobrancaId) return
    setRenovando(true)
    setErroRenovar(null)
    const r = await renovarParcelaAction(parcelaAberta.id, cobrancaId)
    setRenovando(false)
    if (r.error) {
      setErroRenovar(r.error)
    } else {
      setRenovadoOk(true)
      setMostrarModalRenovar(false)
      // Recarrega parcela (próxima pode ter sido gerada)
      if (atendimento.cliente_id) {
        buscarParcelaClienteAction(atendimento.cliente_id).then(data => {
          setCobrancaId(data?.cobrancaId ?? null)
          setParcelaAberta(data?.parcela ?? null)
          setRenovadoOk(false)
        })
      }
      onClienteAtualizado()
    }
  }

  const nomeExibido = [
    atendimento.clientes?.nome, atendimento.clientes?.sobrenome,
  ].filter(Boolean).join(' ') || atendimento.celular

  const statusConfig: Record<AtendimentoStatus, { label: string; cls: string }> = {
    aguardando:     { label: 'Aguardando',     cls: 'bg-amber-500/15 text-amber-500' },
    em_atendimento: { label: 'Em Atendimento', cls: 'bg-green-500/15 text-green-400' },
    finalizado:     { label: 'Finalizado',     cls: 'bg-muted text-muted-foreground' },
  }
  const st = statusConfig[atendimento.status]

  const formatarMoeda = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Perfil</h2>
        <button
          onClick={onFechar}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Avatar + nome */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
            {iniciais(nomeExibido)}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{nomeExibido}</p>
            <p className="text-xs text-muted-foreground">{atendimento.celular}</p>
          </div>
        </div>

        {/* Atalhos: cadastro + cobranças */}
        {atendimento.cliente_id && (
          <div className="grid grid-cols-2 gap-2">
            <Link
              href={`/clientes/${atendimento.cliente_id}`}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
            >
              <User className="h-3.5 w-3.5" />
              Ver cadastro
            </Link>
            {cobrancaId ? (
              <Link
                href={`/cobrancas/${cobrancaId}`}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Ver cobrança
              </Link>
            ) : (
              <Link
                href="/cobrancas/nova"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Nova cobrança
              </Link>
            )}
          </div>
        )}

        {/* Renovação */}
        {atendimento.cliente_id && (
          <div className="rounded-xl border border-border p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Renovação rápida
            </p>

            {carregandoParcela ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Buscando parcela…
              </div>
            ) : renovadoOk ? (
              <div className="flex items-center gap-2 rounded-xl bg-green-500/10 px-3 py-2.5 text-xs font-medium text-green-600 dark:text-green-400">
                <CheckCircle className="h-3.5 w-3.5" />
                Renovado com sucesso! WhatsApp enviado.
              </div>
            ) : parcelaAberta ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Valor</span>
                    <span className="font-semibold text-foreground">{formatarMoeda(parcelaAberta.valor)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Vencimento</span>
                    <span className="text-foreground">
                      {parcelaAberta.dataVencimento.split('-').reverse().join('/')}
                    </span>
                  </div>
                </div>
                {erroRenovar && <p className="text-xs text-destructive">{erroRenovar}</p>}
                <button
                  onClick={() => { setMostrarModalRenovar(true); setErroRenovar(null) }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-medium text-primary-foreground transition hover:opacity-90"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Renovar mensalidade
                </button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhuma parcela em aberto.{' '}
                {cobrancaId && (
                  <Link href={`/cobrancas/${cobrancaId}`} className="text-primary underline-offset-2 hover:underline">
                    Ver cobranças
                  </Link>
                )}
              </p>
            )}
          </div>
        )}

        {/* Número + status */}
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Atendimento</span>
            <span className="font-mono font-semibold text-foreground">
              #{String(atendimento.numero).padStart(4, '0')}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Status</span>
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>
              {st.label}
            </span>
          </div>
          {atendimento.departamentos && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Departamento</span>
              <span
                className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-white"
                style={{ backgroundColor: atendimento.departamentos.cor }}
              >
                {atendimento.departamentos.nome}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Criado em</span>
            <span className="text-foreground">
              {new Date(atendimento.criado_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
            </span>
          </div>
        </div>

        {/* Edição dos dados do cliente */}
        {atendimento.cliente_id && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Dados do cliente
              </p>
              {!editando && (
                <button
                  onClick={() => setEditando(true)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                  Editar
                </button>
              )}
            </div>

            {editando ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome</label>
                  <input
                    value={nome}
                    onChange={e => setNome(e.target.value)}
                    className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Sobrenome</label>
                  <input
                    value={sobrenome}
                    onChange={e => setSobrenome(e.target.value)}
                    className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                {erroSalvar && <p className="text-xs text-destructive">{erroSalvar}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEditando(false); setErroSalvar(null) }}
                    className="flex-1 rounded-xl border border-border py-2 text-xs text-muted-foreground transition hover:bg-accent"
                  >Cancelar</button>
                  <button
                    onClick={salvar}
                    disabled={salvando || !nome.trim()}
                    className="flex-1 rounded-xl bg-primary py-2 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >{salvando ? 'Salvando…' : 'Salvar'}</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2.5">
                  <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm text-foreground">
                    {[atendimento.clientes?.nome, atendimento.clientes?.sobrenome].filter(Boolean).join(' ') || '—'}
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2.5">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm text-foreground">{atendimento.celular}</span>
                </div>
                {atendimento.clientes?.email && (
                  <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2.5">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm text-foreground">{atendimento.clientes.email}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal confirmação de renovação */}
      {mostrarModalRenovar && parcelaAberta && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-4"
          onClick={e => e.target === e.currentTarget && setMostrarModalRenovar(false)}
        >
          <div className="w-full max-w-xs rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Confirmar Renovação</h3>
            <div className="rounded-xl bg-muted/30 p-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Cliente</span>
                <span className="font-medium text-foreground truncate max-w-[160px]">{nomeExibido}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Valor</span>
                <span className="font-semibold text-foreground">{formatarMoeda(parcelaAberta.valor)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Vencimento</span>
                <span className="text-foreground">{parcelaAberta.dataVencimento.split('-').reverse().join('/')}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              A mensagem de confirmação de pagamento será enviada automaticamente via WhatsApp.
            </p>
            {erroRenovar && <p className="text-xs text-destructive">{erroRenovar}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setMostrarModalRenovar(false)}
                disabled={renovando}
                className="flex-1 rounded-xl border border-border py-2.5 text-xs text-muted-foreground transition hover:bg-accent disabled:opacity-50"
              >Cancelar</button>
              <button
                onClick={handleRenovar}
                disabled={renovando}
                className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >{renovando ? 'Renovando…' : 'Confirmar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Página Principal ──────────────────────────────────────────────────────────

export default function AtendimentoPage() {
  const sb = createClient()

  // Estado global
  const [contaId, setContaId]         = useState<string | null>(null)
  const [tab, setTab]                 = useState<AtendimentoStatus>('aguardando')
  const [atendimentos, setAtendimentos] = useState<Atendimento[]>([])
  const [selecionado, setSelecionado] = useState<Atendimento | null>(null)
  const [mensagens, setMensagens]     = useState<Mensagem[]>([])
  const [ultimaMsgIn, setUltimaMsgIn] = useState<Date | null>(null)
  const [busca, setBusca]             = useState('')
  const [contadorPendentes, setContadorPendentes] = useState(0)

  // Painéis mobile
  const [mostrarChat, setMostrarChat] = useState(false)
  const [mostrarPerfil, setMostrarPerfil] = useState(false)

  // Modal transferir
  const [mostrarTransferir, setMostrarTransferir] = useState(false)
  const [departamentos, setDepartamentos] = useState<Departamento[]>([])
  const [membros, setMembros]           = useState<Membro[]>([])
  const [acao, setAcao]                 = useState<string | null>(null)

  // Template picker (janela expirada)
  const [mostrarTemplatePicker, setMostrarTemplatePicker] = useState(false)
  const [enviandoTemplate, setEnviandoTemplate]           = useState(false)
  const [templateErro, setTemplateErro]                   = useState<string | null>(null)

  // Modal nova conversa
  const [mostrarNovaConversa, setMostrarNovaConversa] = useState(false)
  const [iniciandoConversa, setIniciandoConversa]     = useState(false)

  // Templates Meta (carregados uma vez)
  const [metaTemplates, setMetaTemplates]       = useState<MetaTemplate[]>([])
  const [carregandoTemplates, setCarregandoTemplates] = useState(false)
  const [erroTemplates, setErroTemplates]       = useState<string | null>(null)

  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const buscaRef    = useRef<HTMLInputElement>(null)

  const [sendState, formAction, isSending] = useActionState(enviarRespostaAction, { error: null })

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const janelaAberta = useMemo(
    () => ultimaMsgIn ? ultimaMsgIn.getTime() + 86_400_000 > Date.now() : false,
    [ultimaMsgIn],
  )

  // Filtra lista pela busca
  const listaFiltrada = useMemo(() => {
    if (!busca.trim()) return atendimentos
    const q = busca.toLowerCase()
    return atendimentos.filter(at =>
      nomeAtendimento(at).toLowerCase().includes(q) ||
      at.celular.includes(q),
    )
  }, [atendimentos, busca])

  // ── Carregar templates da Meta ────────────────────────────────────────────────

  async function carregarTemplates(force = false) {
    if (!force && metaTemplates.length > 0) return  // já carregados
    setCarregandoTemplates(true)
    setErroTemplates(null)
    try {
      const res  = await fetch('/api/meta/templates?status=APPROVED', { cache: 'no-store' })
      const json = await res.json()
      if (json.templates) setMetaTemplates(json.templates)
      else setErroTemplates(json.error ?? 'Erro ao carregar templates.')
    } catch {
      setErroTemplates('Erro de conexão ao carregar templates.')
    } finally {
      setCarregandoTemplates(false)
    }
  }

  // ── Carregar contaId ──────────────────────────────────────────────────────────

  useEffect(() => {
    sb.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      sb.from('contas').select('id').eq('owner_user_id', user.id).maybeSingle()
        .then(({ data: c }) => {
          if (c) { setContaId(c.id as string); return }
          sb.from('membros_conta').select('conta_id').eq('user_id', user.id).eq('ativo', true).maybeSingle()
            .then(({ data: m }) => { if (m) setContaId(m.conta_id as string) })
        })
    })
  }, [])

  // ── Carregar atendimentos ─────────────────────────────────────────────────────

  const carregarContadorPendentes = useCallback(async (cid: string) => {
    const { count } = await sb
      .from('atendimentos')
      .select('*', { count: 'exact', head: true })
      .eq('conta_id', cid)
      .eq('status', 'aguardando')
    setContadorPendentes(count ?? 0)
  }, [sb])

  const carregarAtendimentos = useCallback(async (cid: string, status: AtendimentoStatus) => {
    const { data } = await sb
      .from('atendimentos')
      .select(`
        id, numero, conta_id, celular, status, atendente_id,
        ultima_mensagem, ultima_msg_em, criado_em, aceito_em, finalizado_em,
        departamento_id, cliente_id,
        clientes(nome, sobrenome, email),
        departamentos(nome, cor)
      `)
      .eq('conta_id', cid)
      .eq('status', status)
      .order('ultima_msg_em', { ascending: false, nullsFirst: false })
      .limit(200)

    setAtendimentos((data as unknown as Atendimento[]) ?? [])
  }, [sb])

  useEffect(() => {
    if (!contaId) return
    carregarAtendimentos(contaId, tab)
    carregarContadorPendentes(contaId)
    setSelecionado(null)
    setMostrarChat(false)
    setMostrarPerfil(false)
  }, [contaId, tab, carregarAtendimentos, carregarContadorPendentes])

  // ── Carregar mensagens ────────────────────────────────────────────────────────

  const carregarMensagens = useCallback(async (celular: string, cid: string) => {
    const { data } = await sb
      .from('mensagens_wa')
      .select('id, celular, direcao, texto, recebido_em, lida')
      .eq('conta_id', cid)
      .eq('celular', celular)
      .order('recebido_em', { ascending: true })
      .limit(300)

    const lista = (data as Mensagem[]) ?? []
    setMensagens(lista)
    const inbound = lista.filter(m => m.direcao === 'in')
    setUltimaMsgIn(inbound.length ? new Date(inbound[inbound.length - 1].recebido_em) : null)
  }, [sb])

  useEffect(() => {
    if (!selecionado || !contaId) return
    carregarMensagens(selecionado.celular, contaId)
    marcarLidaAction(selecionado.celular)
  }, [selecionado, contaId, carregarMensagens])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [mensagens])

  // ── Limpar textarea após envio ────────────────────────────────────────────────

  useEffect(() => {
    if (!sendState.error && !isSending && textareaRef.current) {
      textareaRef.current.value = ''
      textareaRef.current.style.height = 'auto'
    }
  }, [sendState, isSending])

  // ── Realtime ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!contaId) return
    const ch = sb
      .channel('atendimento-realtime')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'atendimentos',
        filter: `conta_id=eq.${contaId}`,
      }, () => { carregarAtendimentos(contaId, tab); carregarContadorPendentes(contaId) })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'mensagens_wa',
        filter: `conta_id=eq.${contaId}`,
      }, (payload) => {
        const nova = payload.new as Mensagem
        if (selecionado && nova.celular === selecionado.celular) {
          setMensagens(prev => [...prev, nova])
          if (nova.direcao === 'in') {
            setUltimaMsgIn(new Date(nova.recebido_em))
            marcarLidaAction(nova.celular)
          }
        }
        carregarAtendimentos(contaId, tab)
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [contaId, tab, selecionado, sb, carregarAtendimentos, carregarContadorPendentes])

  // ── Ações ─────────────────────────────────────────────────────────────────────

  async function handleAceitar() {
    if (!selecionado || !contaId) return
    setAcao('aceitar')
    const r = await aceitarAtendimentoAction(selecionado.id)
    setAcao(null)
    if (!r.error) {
      setSelecionado(prev => prev ? { ...prev, status: 'em_atendimento' } : null)
      carregarAtendimentos(contaId, tab)
    }
  }

  async function handleFinalizar() {
    if (!selecionado || !contaId) return
    setAcao('finalizar')
    const r = await finalizarAtendimentoAction(selecionado.id)
    setAcao(null)
    if (!r.error) {
      setSelecionado(null)
      setMostrarChat(false)
      setMostrarPerfil(false)
      carregarAtendimentos(contaId, tab)
    }
  }

  async function handleAbrirTransferir() {
    if (departamentos.length === 0) {
      const r = await buscarDepartamentosEMembrosAction()
      if (!r.error) {
        setDepartamentos(r.departamentos ?? [])
        setMembros(r.membros ?? [])
      }
    }
    setMostrarTransferir(true)
  }

  async function handleTransferir(depId: string, atendenteId?: string) {
    if (!selecionado || !contaId) return
    setAcao('transferir')
    const r = await transferirAtendimentoAction(selecionado.id, depId, atendenteId)
    setAcao(null)
    if (!r.error) {
      setMostrarTransferir(false)
      setSelecionado(null)
      setMostrarChat(false)
      setMostrarPerfil(false)
      carregarAtendimentos(contaId, tab)
    }
  }

  function abrirAtendimento(at: Atendimento) {
    setSelecionado(at)
    setMostrarChat(true)
    setMostrarPerfil(false)
  }

  // Template picker (janela expirada)
  async function abrirTemplatePicker() {
    setMostrarTemplatePicker(true)
    setTemplateErro(null)
    await carregarTemplates()
  }

  async function handleEnviarTemplate(tmpl: MetaTemplate) {
    if (!selecionado || !contaId) return
    setEnviandoTemplate(true)
    setTemplateErro(null)
    const r = await enviarTemplateAction(
      selecionado.id, selecionado.celular, selecionado.cliente_id,
      tmpl.name, tmpl.language, tmpl.body,
    )
    setEnviandoTemplate(false)
    if (r.error) {
      setTemplateErro(r.error)
    } else {
      setMostrarTemplatePicker(false)
      carregarMensagens(selecionado.celular, contaId)
    }
  }

  // Nova conversa
  async function abrirNovaConversa() {
    setMostrarNovaConversa(true)
    await carregarTemplates()
  }

  async function handleIniciarConversa(
    celular: string,
    clienteId: string | null,
    tmpl: MetaTemplate,
  ) {
    if (!contaId) return
    setIniciandoConversa(true)
    const r = await iniciarConversaAction(celular, clienteId, tmpl.name, tmpl.language, tmpl.body)
    setIniciandoConversa(false)
    if (r.error) {
      alert(r.error)
      return
    }
    setMostrarNovaConversa(false)
    // Recarrega a lista; o atendimento criado pode estar em qualquer tab
    await carregarAtendimentos(contaId, tab)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Modais globais */}
      {mostrarTemplatePicker && selecionado && (
        <ModalTemplatePicker
          templates={metaTemplates}
          carregandoTemplates={carregandoTemplates}
          erroTemplates={erroTemplates}
          onEnviar={handleEnviarTemplate}
          onFechar={() => { setMostrarTemplatePicker(false); setTemplateErro(null) }}
          onAtualizar={() => { setMetaTemplates([]); carregarTemplates(true) }}
          carregandoEnvio={enviandoTemplate}
          erroEnvio={templateErro}
        />
      )}

      {mostrarTransferir && selecionado && (
        <ModalTransferir
          departamentos={departamentos}
          membros={membros}
          onConfirmar={handleTransferir}
          onFechar={() => setMostrarTransferir(false)}
          carregando={acao === 'transferir'}
        />
      )}

      {mostrarNovaConversa && contaId && (
        <ModalNovaConversa
          contaId={contaId}
          templates={metaTemplates}
          carregandoTemplates={carregandoTemplates || iniciandoConversa}
          onEnviar={handleIniciarConversa}
          onFechar={() => setMostrarNovaConversa(false)}
          onAtualizar={() => { setMetaTemplates([]); carregarTemplates(true) }}
        />
      )}

      {/* Layout 3 painéis */}
      <div className="flex h-[calc(100dvh-4rem)] overflow-hidden md:h-screen">

        {/* ── Painel esquerdo: lista ── */}
        <div className={[
          'flex w-full flex-col border-r border-border bg-card md:w-[300px] md:shrink-0',
          // Mobile: esconde quando chat aberto
          mostrarChat ? 'hidden md:flex' : 'flex',
        ].join(' ')}>

          {/* Header + busca */}
          <div className="border-b border-border px-4 pb-0 pt-4">
            <div className="mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h1 className="flex-1 text-sm font-semibold text-foreground">Atendimento</h1>
              <button
                onClick={abrirNovaConversa}
                title="Nova conversa"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Busca */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={buscaRef}
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar por nome ou número…"
                className="w-full rounded-xl border border-border bg-input py-2 pl-9 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
              />
              {busca && (
                <button
                  onClick={() => setBusca('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Tabs */}
            <div className="flex">
              {TAB_CONFIG.map(({ status, labelCurto, Icon }) => (
                <button
                  key={status}
                  onClick={() => setTab(status)}
                  className={[
                    'flex flex-1 flex-col items-center gap-0.5 border-b-2 py-2.5 text-[10px] font-medium transition-colors',
                    tab === status
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  <Icon className="h-4 w-4" />
                  <span>{labelCurto}</span>
                  {status === 'aguardando' && contadorPendentes > 0 && (
                    <span className="rounded-full bg-amber-500 px-1.5 text-[9px] font-bold text-white leading-4">
                      {contadorPendentes}
                    </span>
                  )}
                  {status === 'em_atendimento' && tab === status && atendimentos.length > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-[9px] font-bold text-primary-foreground leading-4">
                      {atendimentos.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto">
            {listaFiltrada.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  {busca
                    ? 'Nenhum resultado para a busca.'
                    : tab === 'aguardando'
                      ? 'Nenhuma conversa aguardando.'
                      : tab === 'em_atendimento'
                        ? 'Nenhum atendimento ativo.'
                        : 'Nenhum atendimento finalizado.'}
                </p>
              </div>
            ) : (
              listaFiltrada.map(at => (
                <div
                  key={at.id}
                  className={[
                    'flex w-full items-center border-b border-border/40 transition-colors',
                    selecionado?.id === at.id ? 'bg-accent' : 'hover:bg-accent/50',
                  ].join(' ')}
                >
                  {/* Área principal → abre chat */}
                  <button
                    onClick={() => abrirAtendimento(at)}
                    className="flex flex-1 min-w-0 items-start gap-3 px-4 py-3.5 text-left"
                  >
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {iniciais(nomeAtendimento(at))}
                      </div>
                      {at.status === 'aguardando' && (
                        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-amber-500 ring-2 ring-card" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-sm font-medium text-foreground">
                          {nomeAtendimento(at)}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {at.ultima_msg_em ? formatarTempo(at.ultima_msg_em) : ''}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {at.ultima_mensagem ?? at.celular}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="font-mono text-[9px] text-muted-foreground/60">
                          #{String(at.numero).padStart(4, '0')}
                        </span>
                        {at.departamentos && (
                          <span
                            className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-white"
                            style={{ backgroundColor: at.departamentos.cor }}
                          >
                            {at.departamentos.nome}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Ícone de cadastro → abre página do cliente */}
                  {at.cliente_id && (
                    <Link
                      href={`/clientes/${at.cliente_id}`}
                      title="Ver cadastro do cliente"
                      className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/40 transition hover:bg-accent hover:text-foreground"
                      onClick={e => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Painel central + direito (desktop) ── */}
        {/* Desktop: placeholder quando nada selecionado */}
        {!selecionado && (
          <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-center md:flex">
            <MessageSquare className="h-10 w-10 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">Selecione um atendimento</p>
            <button
              onClick={abrirNovaConversa}
              className="flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground transition hover:border-primary hover:text-primary"
            >
              <Plus className="h-4 w-4" />
              Nova conversa
            </button>
          </div>
        )}

        {/* Chat: mobile = fixed overlay; desktop = coluna */}
        {selecionado && (
          <div className={[
            'fixed inset-0 z-[60] flex flex-col bg-background',
            'transition-transform duration-300 ease-out',
            mostrarChat ? 'translate-x-0' : 'translate-x-full',
            'md:relative md:inset-auto md:z-auto md:flex md:flex-1 md:translate-x-0 md:min-w-0',
          ].join(' ')}>

            {/* Header do chat */}
            <div
              className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3"
              style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
            >
              <button
                onClick={() => { setMostrarChat(false); setSelecionado(null) }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-foreground md:hidden"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              {/* Avatar */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {iniciais(nomeAtendimento(selecionado))}
              </div>

              {/* Info — clicável para abrir perfil */}
              <button
                onClick={() => setMostrarPerfil(p => !p)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium text-foreground hover:underline">
                  {nomeAtendimento(selecionado)}
                </p>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">{selecionado.celular}</p>
                  <JanelaTimer ultimaMsgIn={ultimaMsgIn} />
                </div>
              </button>

              {/* Ações */}
              <div className="flex shrink-0 items-center gap-1.5">
                {selecionado.status === 'aguardando' && (
                  <button
                    onClick={handleAceitar}
                    disabled={!!acao}
                    className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    {acao === 'aceitar' ? 'Aceitando…' : 'Aceitar'}
                  </button>
                )}

                {selecionado.status === 'em_atendimento' && (
                  <>
                    <button
                      onClick={handleAbrirTransferir}
                      disabled={!!acao}
                      title="Transferir"
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition hover:bg-accent disabled:opacity-50"
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={handleFinalizar}
                      disabled={!!acao}
                      className="flex h-9 items-center gap-1.5 rounded-xl border border-border px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-accent disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      {acao === 'finalizar' ? '…' : 'Finalizar'}
                    </button>
                  </>
                )}

                {selecionado.status === 'finalizado' && (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                    Finalizado
                  </span>
                )}

                {/* Botão perfil (desktop) */}
                <button
                  onClick={() => setMostrarPerfil(p => !p)}
                  title="Ver perfil"
                  className={[
                    'hidden h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition hover:bg-accent md:flex',
                    mostrarPerfil ? 'bg-accent text-foreground' : '',
                  ].join(' ')}
                >
                  <User className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto space-y-2 px-4 py-4">
              {mensagens.length === 0 && (
                <div className="flex justify-center py-8">
                  <p className="text-xs text-muted-foreground">Nenhuma mensagem ainda.</p>
                </div>
              )}
              {mensagens.map(msg => (
                <div
                  key={msg.id}
                  className={['flex', msg.direcao === 'out' ? 'justify-end' : 'justify-start'].join(' ')}
                >
                  <div className={[
                    'max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                    msg.direcao === 'out'
                      ? 'rounded-br-sm bg-primary text-primary-foreground'
                      : 'rounded-bl-sm border border-border bg-card text-foreground',
                  ].join(' ')}>
                    <p className="whitespace-pre-wrap break-words">{msg.texto}</p>
                    <p className={[
                      'mt-1 text-[10px]',
                      msg.direcao === 'out' ? 'text-right text-primary-foreground/70' : 'text-muted-foreground',
                    ].join(' ')}>
                      {formatarHora(msg.recebido_em)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Campo de resposta */}
            <div
              className="shrink-0 border-t border-border bg-card px-4 py-3"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
            >
              {selecionado.status === 'finalizado' ? (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  Atendimento finalizado.
                </p>
              ) : selecionado.status === 'aguardando' ? (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  Aceite o atendimento para responder.
                </p>
              ) : !janelaAberta ? (
                <div className="flex flex-col items-center gap-2 py-2">
                  <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <Clock className="h-3 w-3" />
                    Janela de 24h expirada
                  </div>
                  <p className="px-4 text-center text-xs text-muted-foreground">
                    Para enviar mensagens use um template aprovado.{' '}
                    <span className="text-amber-600/80 dark:text-amber-400/80">Cobrado pela Meta.</span>
                  </p>
                  <button
                    onClick={abrirTemplatePicker}
                    className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                  >
                    <MessageSquare className="h-4 w-4" />
                    Iniciar conversa com template
                  </button>
                </div>
              ) : (
                <>
                  {sendState.error && (
                    <p className="mb-2 text-xs text-destructive">{sendState.error}</p>
                  )}
                  <form action={formAction} className="flex items-end gap-2">
                    <input type="hidden" name="celular" value={selecionado.celular} />
                    <input type="hidden" name="atendimento_id" value={selecionado.id} />
                    <textarea
                      ref={textareaRef}
                      name="texto"
                      rows={1}
                      placeholder="Mensagem… (Enter envia)"
                      className="flex-1 resize-none rounded-2xl border border-border bg-input px-4 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                      style={{ maxHeight: '8rem' }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          e.currentTarget.form?.requestSubmit()
                        }
                      }}
                      onInput={e => {
                        const el = e.currentTarget
                        el.style.height = 'auto'
                        el.style.height = Math.min(el.scrollHeight, 128) + 'px'
                      }}
                    />
                    <button
                      type="submit"
                      disabled={isSending}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Painel direito: perfil do cliente (desktop) ── */}
        {selecionado && mostrarPerfil && (
          <div className={[
            // Mobile: tela cheia sobre o chat
            'fixed inset-0 z-[65] bg-card overflow-hidden',
            // Desktop: painel lateral fixo
            'md:relative md:inset-auto md:z-auto md:w-[280px] md:shrink-0 md:border-l md:border-border md:shadow-none md:overflow-hidden',
          ].join(' ')}>
            <PainelCliente
              atendimento={selecionado}
              onFechar={() => setMostrarPerfil(false)}
              onClienteAtualizado={() => {
                if (contaId) carregarAtendimentos(contaId, tab)
              }}
            />
          </div>
        )}
      </div>
    </>
  )
}
