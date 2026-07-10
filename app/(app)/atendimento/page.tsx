'use client'

import { useEffect, useRef, useState, useActionState, useCallback } from 'react'
import { ArrowLeft, Send, MessageSquare, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { enviarRespostaAction, marcarLidaAction } from './_actions/mensagens'

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Mensagem = {
  id: string
  celular: string
  direcao: 'in' | 'out'
  texto: string
  recebido_em: string
  lida: boolean
}

type Conversa = {
  celular: string
  nomeCliente: string | null
  ultimaMensagem: string
  ultimaDataStr: string
  ultimaData: Date
  naoLidas: number
  ultimaMsgIn: Date | null  // para calcular janela 24h
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatarHora(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  const diff = hoje.getTime() - d.getTime()

  if (diff < 24 * 60 * 60 * 1000) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}

function calcularJanela(ultimaMsgIn: Date | null): { ms: number; label: string; aberta: boolean } {
  if (!ultimaMsgIn) return { ms: 0, label: 'Sem resposta do cliente', aberta: false }
  const expira = ultimaMsgIn.getTime() + 24 * 60 * 60 * 1000
  const restante = expira - Date.now()
  if (restante <= 0) return { ms: 0, label: 'Janela fechada', aberta: false }

  const h = Math.floor(restante / 3_600_000)
  const m = Math.floor((restante % 3_600_000) / 60_000)
  return { ms: restante, label: `${h}h ${m}m restantes`, aberta: true }
}

// ── Componente contador de janela (atualiza a cada minuto) ────────────────────
function JanelaTimer({ ultimaMsgIn }: { ultimaMsgIn: Date | null }) {
  const [janela, setJanela] = useState(() => calcularJanela(ultimaMsgIn))

  useEffect(() => {
    setJanela(calcularJanela(ultimaMsgIn))
    const id = setInterval(() => setJanela(calcularJanela(ultimaMsgIn)), 60_000)
    return () => clearInterval(id)
  }, [ultimaMsgIn])

  return (
    <div className={[
      'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
      janela.aberta
        ? 'bg-green-500/15 text-green-400'
        : 'bg-muted text-muted-foreground',
    ].join(' ')}>
      <Clock className="h-3 w-3 shrink-0" />
      {janela.label}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AtendimentoPage() {
  const sb = createClient()

  const [conversas, setConversas]         = useState<Conversa[]>([])
  const [selecionada, setSelecionada]     = useState<string | null>(null) // celular
  const [mensagens, setMensagens]         = useState<Mensagem[]>([])
  const [contaId, setContaId]             = useState<string | null>(null)
  const [nomeMap, setNomeMap]             = useState<Record<string, string>>({})
  const [mostrarChat, setMostrarChat]     = useState(false)  // mobile: toggle lista/chat
  const bottomRef                          = useRef<HTMLDivElement>(null)
  const textareaRef                        = useRef<HTMLTextAreaElement>(null)

  const [state, formAction, isPending] = useActionState(enviarRespostaAction, { error: null })

  // ── Carregar conta ─────────────────────────────────────────────────────────
  useEffect(() => {
    sb.auth.getUser().then(({ data }) => {
      if (!data.user) return
      sb.from('contas').select('id').eq('owner_user_id', data.user.id).maybeSingle()
        .then(({ data: c }) => { if (c) setContaId(c.id as string) })
    })
  }, [])

  // ── Carregar conversas ─────────────────────────────────────────────────────
  const carregarConversas = useCallback(async (cid: string) => {
    const { data } = await sb
      .from('mensagens_wa')
      .select('id, celular, direcao, texto, recebido_em, lida, cliente_id, clientes(nome, sobrenome)')
      .eq('conta_id', cid)
      .order('recebido_em', { ascending: false })
      .limit(500)

    if (!data) return

    // Agrupar por celular
    const map = new Map<string, Conversa>()
    const nomes: Record<string, string> = {}

    for (const msg of data) {
      const cel = msg.celular as string
      const cl  = (msg as any).clientes
      if (cl) {
        const nome = [cl.nome, cl.sobrenome].filter(Boolean).join(' ')
        nomes[cel] = nome
      }

      if (!map.has(cel)) {
        map.set(cel, {
          celular:        cel,
          nomeCliente:    nomes[cel] ?? null,
          ultimaMensagem: msg.texto as string,
          ultimaDataStr:  formatarHora(msg.recebido_em as string),
          ultimaData:     new Date(msg.recebido_em as string),
          naoLidas:       0,
          ultimaMsgIn:    null,
        })
      }

      const c = map.get(cel)!
      if (!msg.lida && msg.direcao === 'in') c.naoLidas++
      if (msg.direcao === 'in') {
        const d = new Date(msg.recebido_em as string)
        if (!c.ultimaMsgIn || d > c.ultimaMsgIn) c.ultimaMsgIn = d
      }
    }

    setNomeMap(nomes)
    setConversas(
      Array.from(map.values()).sort((a, b) => b.ultimaData.getTime() - a.ultimaData.getTime()),
    )
  }, [sb])

  useEffect(() => {
    if (!contaId) return
    carregarConversas(contaId)
  }, [contaId, carregarConversas])

  // ── Carregar mensagens da conversa selecionada ─────────────────────────────
  const carregarMensagens = useCallback(async (cel: string, cid: string) => {
    const { data } = await sb
      .from('mensagens_wa')
      .select('id, celular, direcao, texto, recebido_em, lida')
      .eq('conta_id', cid)
      .eq('celular', cel)
      .order('recebido_em', { ascending: true })
    setMensagens((data as Mensagem[]) ?? [])
  }, [sb])

  useEffect(() => {
    if (!selecionada || !contaId) return
    carregarMensagens(selecionada, contaId)
    marcarLidaAction(selecionada)
    setConversas(prev => prev.map(c => c.celular === selecionada ? { ...c, naoLidas: 0 } : c))
  }, [selecionada, contaId, carregarMensagens])

  // ── Scroll para o fim sempre que mensagens mudam ───────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens])

  // ── Realtime: novas mensagens ──────────────────────────────────────────────
  useEffect(() => {
    if (!contaId) return

    const channel = sb
      .channel('mwa-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mensagens_wa', filter: `conta_id=eq.${contaId}` },
        (payload) => {
          const nova = payload.new as Mensagem
          // Atualiza lista de conversas
          carregarConversas(contaId)
          // Se a conversa está aberta, adiciona a mensagem diretamente
          if (nova.celular === selecionada) {
            setMensagens(prev => [...prev, nova])
            if (nova.direcao === 'in') marcarLidaAction(nova.celular)
          }
        },
      )
      .subscribe()

    return () => { sb.removeChannel(channel) }
  }, [contaId, selecionada, sb, carregarConversas])

  // ── Limpar textarea após envio com sucesso ─────────────────────────────────
  useEffect(() => {
    if (!state.error && !isPending && textareaRef.current) {
      textareaRef.current.value = ''
    }
  }, [state, isPending])

  // ── Abrir conversa ─────────────────────────────────────────────────────────
  function abrirConversa(celular: string) {
    setSelecionada(celular)
    setMostrarChat(true)
  }

  function voltarLista() {
    setMostrarChat(false)
    setSelecionada(null)
  }

  const conversaSelecionada = conversas.find(c => c.celular === selecionada)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-57px)] md:h-screen overflow-hidden">

      {/* ── Painel esquerdo: lista de conversas ── */}
      <div className={[
        'flex flex-col border-r border-border bg-card',
        'w-full md:w-80 md:shrink-0',
        mostrarChat ? 'hidden md:flex' : 'flex',
      ].join(' ')}>

        <div className="border-b border-border px-4 py-4">
          <h1 className="text-base font-semibold text-foreground flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Atendimento
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{conversas.length} conversa{conversas.length !== 1 ? 's' : ''}</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversas.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.<br />Configure o webhook do uazapi para começar a receber.</p>
            </div>
          )}

          {conversas.map(c => (
            <button
              key={c.celular}
              onClick={() => abrirConversa(c.celular)}
              className={[
                'flex w-full items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors',
                selecionada === c.celular
                  ? 'bg-accent'
                  : 'hover:bg-accent/50',
              ].join(' ')}
            >
              {/* Avatar */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {(c.nomeCliente ?? c.celular).charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-sm font-medium text-foreground">
                    {c.nomeCliente ?? c.celular}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{c.ultimaDataStr}</span>
                </div>
                <div className="flex items-center justify-between gap-1 mt-0.5">
                  <span className="truncate text-xs text-muted-foreground">{c.ultimaMensagem}</span>
                  {c.naoLidas > 0 && (
                    <span className="shrink-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                      {c.naoLidas}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Painel direito: chat ── */}
      <div className={[
        'flex flex-col flex-1 min-w-0 bg-background',
        mostrarChat ? 'flex' : 'hidden md:flex',
      ].join(' ')}>

        {!selecionada ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center px-6">
            <MessageSquare className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Selecione uma conversa para começar</p>
          </div>
        ) : (
          <>
            {/* Header do chat */}
            <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
              <button
                onClick={voltarLista}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>

              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary shrink-0">
                {(conversaSelecionada?.nomeCliente ?? selecionada).charAt(0).toUpperCase()}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {conversaSelecionada?.nomeCliente ?? selecionada}
                </p>
                <p className="text-xs text-muted-foreground">{selecionada}</p>
              </div>

              {/* Cronômetro da janela 24h */}
              <JanelaTimer ultimaMsgIn={conversaSelecionada?.ultimaMsgIn ?? null} />
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
              {mensagens.map(msg => (
                <div
                  key={msg.id}
                  className={['flex', msg.direcao === 'out' ? 'justify-end' : 'justify-start'].join(' ')}
                >
                  <div className={[
                    'max-w-[75%] rounded-2xl px-3 py-2 text-sm',
                    msg.direcao === 'out'
                      ? 'rounded-br-sm bg-primary text-primary-foreground'
                      : 'rounded-bl-sm bg-card border border-border text-foreground',
                  ].join(' ')}>
                    <p className="whitespace-pre-wrap break-words">{msg.texto}</p>
                    <p className={[
                      'mt-1 text-[10px]',
                      msg.direcao === 'out' ? 'text-primary-foreground/70 text-right' : 'text-muted-foreground',
                    ].join(' ')}>
                      {formatarHora(msg.recebido_em)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Campo de resposta */}
            <div className="border-t border-border bg-card px-4 py-3">
              {state.error && (
                <p className="mb-2 text-xs text-destructive">{state.error}</p>
              )}
              <form action={formAction} className="flex items-end gap-2">
                <input type="hidden" name="celular" value={selecionada} />
                <textarea
                  ref={textareaRef}
                  name="texto"
                  rows={1}
                  placeholder="Digite uma mensagem..."
                  className="flex-1 resize-none rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 max-h-32"
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
                  disabled={isPending}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
