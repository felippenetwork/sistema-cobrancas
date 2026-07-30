'use client'

import { useEffect, useRef, useState, useActionState, useCallback } from 'react'
import {
  ArrowLeft, Send, MessageSquare, Clock, CheckCircle,
  XCircle, ArrowRightLeft, Inbox, History,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { enviarRespostaAction, marcarLidaAction, enviarTemplateAction } from './_actions/mensagens'
import {
  aceitarAtendimentoAction,
  finalizarAtendimentoAction,
  transferirAtendimentoAction,
  buscarDepartamentosEMembrosAction,
} from './_actions/atendimentos'

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
  clientes: { nome: string | null; sobrenome: string | null } | null
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

type Membro = { id: string; user_id: string; nome: string }
type Departamento = { id: string; nome: string; cor: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

const TAB_CONFIG: { status: AtendimentoStatus; label: string; labelCurto: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { status: 'em_atendimento', label: 'Em Atendimento', labelCurto: 'Em Aten.',   Icon: MessageSquare },
  { status: 'aguardando',     label: 'Pendentes',      labelCurto: 'Pendentes',  Icon: Inbox },
  { status: 'finalizado',     label: 'Finalizados',    labelCurto: 'Finalizados',Icon: History },
]

function nomeAtendimento(at: Atendimento): string {
  if (at.clientes?.nome) {
    return [at.clientes.nome, at.clientes.sobrenome].filter(Boolean).join(' ')
  }
  return at.celular
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
  return { label: `${h}h ${m}m`, aberta: true }
}

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
      janela.aberta ? 'bg-green-500/15 text-green-400' : 'bg-muted text-muted-foreground',
    ].join(' ')}>
      <Clock className="h-2.5 w-2.5" />
      {janela.label}
    </span>
  )
}

// ── Modal de transferência (bottom sheet no mobile, centrado no desktop) ──────

function ModalTransferir({
  departamentos,
  membros,
  onConfirmar,
  onFechar,
  carregando,
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
        {/* Handle visual no mobile */}
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
              value={depId}
              onChange={e => setDepId(e.target.value)}
              className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">Selecionar departamento…</option>
              {departamentos.map(d => (
                <option key={d.id} value={d.id}>{d.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Atribuir a (opcional)</label>
            <select
              value={memId}
              onChange={e => setMemId(e.target.value)}
              className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">Qualquer atendente</option>
              {membros.map(m => (
                <option key={m.id} value={m.user_id}>{m.nome}</option>
              ))}
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
          >
            Cancelar
          </button>
          <button
            onClick={() => depId && onConfirmar(depId, memId || undefined)}
            disabled={!depId || carregando}
            className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {carregando ? 'Transferindo…' : 'Transferir'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: picker de templates para janela expirada ───────────────────────────

const TEMPLATE_OPTIONS = [
  { tipo: '5d',                   emoji: '📅', label: 'Vence em 5 dias',      desc: 'Lembrete de fatura próxima do vencimento' },
  { tipo: '3d',                   emoji: '📅', label: 'Vence em 3 dias',      desc: 'Lembrete de fatura próxima do vencimento' },
  { tipo: '2d',                   emoji: '📅', label: 'Vence em 2 dias',      desc: 'Lembrete urgente de vencimento' },
  { tipo: '1d',                   emoji: '⚠️', label: 'Vence amanhã',         desc: 'Último lembrete antes do vencimento' },
  { tipo: 'dia',                  emoji: '🚨', label: 'Vence hoje',            desc: 'Aviso de vencimento no dia' },
  { tipo: 'vencido1d',            emoji: '🔴', label: 'Venceu ontem',         desc: 'Cobrança de fatura vencida' },
  { tipo: 'pagamento_confirmado', emoji: '✅', label: 'Pagamento confirmado',  desc: 'Confirmação de recebimento' },
  { tipo: 'boasvindas',           emoji: '🎉', label: 'Boas-vindas',          desc: 'Mensagem de ativação do plano' },
]

function ModalTemplatePicker({
  onEnviar,
  onFechar,
  carregando,
  erro,
}: {
  onEnviar: (tipo: string) => void
  onFechar: () => void
  carregando: boolean
  erro: string | null
}) {
  const [selecionado, setSelecionado] = useState('')

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
          <button onClick={onFechar} className="rounded p-1.5 text-muted-foreground hover:text-foreground">
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-64 overflow-y-auto space-y-1.5 p-3">
          {TEMPLATE_OPTIONS.map(t => (
            <button
              key={t.tipo}
              onClick={() => setSelecionado(t.tipo)}
              className={[
                'flex w-full items-start gap-3 rounded-xl p-3 text-left transition',
                selecionado === t.tipo
                  ? 'bg-primary/10 ring-1 ring-primary'
                  : 'hover:bg-accent',
              ].join(' ')}
            >
              <span className="text-lg leading-none">{t.emoji}</span>
              <div>
                <p className="text-sm font-medium text-foreground">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.desc}</p>
              </div>
            </button>
          ))}
        </div>

        {erro && (
          <p className="px-5 pb-1 text-xs text-destructive">{erro}</p>
        )}

        <div
          className="flex gap-2 border-t border-border px-5 py-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            onClick={onFechar}
            className="flex-1 rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground transition hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={() => selecionado && onEnviar(selecionado)}
            disabled={!selecionado || carregando}
            className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {carregando ? 'Enviando…' : 'Enviar template'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function AtendimentoPage() {
  const sb = createClient()

  const [contaId, setContaId]             = useState<string | null>(null)
  const [tab, setTab]                     = useState<AtendimentoStatus>('aguardando')
  const [atendimentos, setAtendimentos]   = useState<Atendimento[]>([])
  const [selecionado, setSelecionado]     = useState<Atendimento | null>(null)
  const [mensagens, setMensagens]         = useState<Mensagem[]>([])
  const [mostrarChat, setMostrarChat]     = useState(false)
  const [mostrarModal, setMostrarModal]             = useState(false)
  const [mostrarTemplatePicker, setMostrarTemplate] = useState(false)
  const [enviandoTemplate, setEnviandoTemplate]     = useState(false)
  const [templateErro, setTemplateErro]             = useState<string | null>(null)
  const [departamentos, setDepartamentos]           = useState<Departamento[]>([])
  const [membros, setMembros]                       = useState<Membro[]>([])
  const [acao, setAcao]                             = useState<string | null>(null)
  const [ultimaMsgIn, setUltimaMsgIn]               = useState<Date | null>(null)

  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [sendState, formAction, isSending] = useActionState(enviarRespostaAction, { error: null })

  // ── Carregar contaId ──────────────────────────────────────────────────────
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

  // ── Carregar atendimentos da aba atual ────────────────────────────────────
  const carregarAtendimentos = useCallback(async (cid: string, status: AtendimentoStatus) => {
    const { data } = await sb
      .from('atendimentos')
      .select(`
        id, numero, conta_id, celular, status, atendente_id,
        ultima_mensagem, ultima_msg_em, criado_em, aceito_em, finalizado_em,
        departamento_id, cliente_id,
        clientes(nome, sobrenome),
        departamentos(nome, cor)
      `)
      .eq('conta_id', cid)
      .eq('status', status)
      .order('ultima_msg_em', { ascending: false })
      .limit(200)

    setAtendimentos((data as unknown as Atendimento[]) ?? [])
  }, [sb])

  useEffect(() => {
    if (!contaId) return
    carregarAtendimentos(contaId, tab)
    setSelecionado(null)
    setMostrarChat(false)
  }, [contaId, tab, carregarAtendimentos])

  // ── Carregar mensagens ────────────────────────────────────────────────────
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

  // ── Realtime ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!contaId) return
    const ch = sb
      .channel('atendimento-realtime')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'atendimentos',
        filter: `conta_id=eq.${contaId}`,
      }, () => carregarAtendimentos(contaId, tab))
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
  }, [contaId, tab, selecionado, sb, carregarAtendimentos])

  // ── Limpar textarea após envio ─────────────────────────────────────────────
  useEffect(() => {
    if (!sendState.error && !isSending && textareaRef.current) {
      textareaRef.current.value = ''
      textareaRef.current.style.height = 'auto'
    }
  }, [sendState, isSending])

  // ── Ações ──────────────────────────────────────────────────────────────────
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
      carregarAtendimentos(contaId, tab)
    }
  }

  async function abrirModal() {
    if (departamentos.length === 0) {
      const r = await buscarDepartamentosEMembrosAction()
      if (!r.error) {
        setDepartamentos(r.departamentos ?? [])
        setMembros(r.membros ?? [])
      }
    }
    setMostrarModal(true)
  }

  async function handleTransferir(depId: string, atendenteId?: string) {
    if (!selecionado || !contaId) return
    setAcao('transferir')
    const r = await transferirAtendimentoAction(selecionado.id, depId, atendenteId)
    setAcao(null)
    if (!r.error) {
      setMostrarModal(false)
      setSelecionado(null)
      setMostrarChat(false)
      carregarAtendimentos(contaId, tab)
    }
  }

  function abrirAtendimento(at: Atendimento) {
    setSelecionado(at)
    setMostrarChat(true)
  }

  function voltarLista() {
    setMostrarChat(false)
    setSelecionado(null)
  }

  async function handleEnviarTemplate(tipo: string) {
    if (!selecionado || !contaId) return
    setEnviandoTemplate(true)
    setTemplateErro(null)
    const r = await enviarTemplateAction(
      selecionado.id,
      selecionado.celular,
      selecionado.cliente_id,
      tipo,
    )
    setEnviandoTemplate(false)
    if (r.error) {
      setTemplateErro(r.error)
    } else {
      setMostrarTemplate(false)
      carregarMensagens(selecionado.celular, contaId)
    }
  }

  // Janela de 24h: aberta se o cliente enviou mensagem nas últimas 24h
  const janelaAberta = ultimaMsgIn
    ? ultimaMsgIn.getTime() + 86_400_000 > Date.now()
    : false

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {mostrarTemplatePicker && selecionado && (
        <ModalTemplatePicker
          onEnviar={handleEnviarTemplate}
          onFechar={() => { setMostrarTemplate(false); setTemplateErro(null) }}
          carregando={enviandoTemplate}
          erro={templateErro}
        />
      )}

      {mostrarModal && selecionado && (
        <ModalTransferir
          departamentos={departamentos}
          membros={membros}
          onConfirmar={handleTransferir}
          onFechar={() => setMostrarModal(false)}
          carregando={acao === 'transferir'}
        />
      )}

      {/*
        Layout: painel esquerdo (lista) sempre montado.
        No mobile, o chat é um painel fixed que cobre tudo (inclusive a bottom nav).
        No desktop: split pane lado a lado.
      */}
      <div className="flex h-[calc(100dvh-4rem)] overflow-hidden md:h-screen">

        {/* ── Painel esquerdo: lista de atendimentos ── */}
        <div className="flex w-full flex-col border-r border-border bg-card md:w-80 md:shrink-0">

          {/* Header + Tabs */}
          <div className="border-b border-border px-4 pb-0 pt-4">
            <div className="mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h1 className="text-sm font-semibold text-foreground">Atendimento</h1>
            </div>

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
                  {status !== 'finalizado' && tab === status && atendimentos.length > 0 && (
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
            {atendimentos.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  {tab === 'aguardando'     && 'Nenhuma conversa aguardando.'}
                  {tab === 'em_atendimento' && 'Nenhum atendimento ativo.'}
                  {tab === 'finalizado'     && 'Nenhum atendimento finalizado.'}
                </p>
              </div>
            ) : (
              atendimentos.map(at => (
                <button
                  key={at.id}
                  onClick={() => abrirAtendimento(at)}
                  className={[
                    'flex w-full items-start gap-3 border-b border-border/40 px-4 py-4 text-left transition-colors active:bg-accent/70',
                    selecionado?.id === at.id ? 'bg-accent' : 'hover:bg-accent/50',
                  ].join(' ')}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {iniciais(nomeAtendimento(at))}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-sm font-medium text-foreground">
                        {nomeAtendimento(at)}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        #{String(at.numero).padStart(4, '0')}
                      </span>
                    </div>

                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                      {at.departamentos && (
                        <span
                          className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold text-white"
                          style={{ backgroundColor: at.departamentos.cor }}
                        >
                          {at.departamentos.nome}
                        </span>
                      )}
                      <span className="truncate text-[11px] text-muted-foreground">
                        {at.ultima_mensagem ?? '—'}
                      </span>
                    </div>

                    {at.ultima_msg_em && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                        {formatarTempo(at.ultima_msg_em)}
                      </p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Chat: fixed overlay no mobile, coluna normal no desktop ── */}

        {/* Desktop placeholder (sem atendimento selecionado) */}
        <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-center md:flex">
          {!selecionado && (
            <>
              <MessageSquare className="h-10 w-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">Selecione um atendimento</p>
            </>
          )}
        </div>

        {/* Painel de chat — mobile: fixed fullscreen com slide, desktop: coluna */}
        {selecionado && (
          <div className={[
            // Mobile: fixed overlay que cobre tudo (inclusive a bottom nav)
            'fixed inset-0 z-[60] flex flex-col bg-background',
            'transition-transform duration-300 ease-out',
            mostrarChat ? 'translate-x-0' : 'translate-x-full',
            // Desktop: coluna normal no layout
            'md:relative md:inset-auto md:z-auto md:flex md:flex-1 md:translate-x-0 md:min-w-0',
          ].join(' ')}>

            {/* Header do chat */}
            <div
              className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3"
              style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
            >
              {/* Botão voltar (mobile) */}
              <button
                onClick={voltarLista}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-foreground md:hidden"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              {/* Avatar */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {iniciais(nomeAtendimento(selecionado))}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {nomeAtendimento(selecionado)}
                </p>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">{selecionado.celular}</p>
                  <JanelaTimer ultimaMsgIn={ultimaMsgIn} />
                </div>
              </div>

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
                      onClick={abrirModal}
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
                    onClick={() => { setMostrarTemplate(true); setTemplateErro(null) }}
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
      </div>
    </>
  )
}
