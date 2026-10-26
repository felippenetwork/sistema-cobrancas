'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot, Loader2, Pause, Play, Plus, Power, RotateCcw, Square, Trash2, UserCheck, X } from 'lucide-react'
import {
  alternarFluxoAction, ativarRecebimentoAction, excluirFluxoAction, historicoAction, mudarConversaAction,
  type MensagemHistorico,
} from '../_actions'

type Fluxo = { id: string; nome: string; ativo: boolean; etapas: number; palavras: string[]; etiquetas: string[]; excluidas: string[] }
type Conversa = {
  id: string; celular: string; nome: string | null; fluxo: string | null
  status: 'ativa' | 'humano' | 'encerrada' | 'descadastrado'; emEtapa: boolean; atualizado_em: string
}

const SITUACAO: Record<Conversa['status'], { rotulo: string; cls: string }> = {
  ativa:         { rotulo: 'Com o robô',          cls: 'bg-primary/10 text-primary' },
  humano:        { rotulo: 'Aguardando você',     cls: 'border border-primary/40 text-foreground' },
  encerrada:     { rotulo: 'Encerrada',           cls: 'bg-muted text-muted-foreground' },
  descadastrado: { rotulo: 'Pediu para sair',     cls: 'bg-muted text-muted-foreground' },
}

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const telefone = (c: string) => `+${c}`

export function ChatbotClient({ conectado, recebimentoLigado, fluxos, conversas }: {
  conectado: boolean
  recebimentoLigado: boolean
  fluxos: Fluxo[]
  conversas: Conversa[]
}) {
  const [aba, setAba]             = useState<'fluxos' | 'contatos'>('fluxos')
  const [erro, setErro]           = useState<string | null>(null)
  const [aviso, setAviso]         = useState<string | null>(null)
  const [ocupado, setOcupado]     = useState<string | null>(null)
  const [historico, setHistorico] = useState<Conversa | null>(null)

  async function executar(chave: string, acao: () => Promise<{ error: string | null }>, ok?: string) {
    setErro(null); setAviso(null); setOcupado(chave)
    const r = await acao()
    setOcupado(null)
    if (r.error) setErro(r.error)
    else if (ok) setAviso(ok)
  }

  const aguardando = conversas.filter(c => c.status === 'humano').length

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold text-foreground">Chatbot</h1>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Responde sozinho quem manda uma palavra-chave, tem uma etiqueta ou responde a um disparo.
          </p>
        </div>
        <Link href="/chatbot/novo"
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Novo fluxo</span><span className="sm:hidden">Novo</span>
        </Link>
      </div>

      {/* Recebimento de mensagens */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Recebimento de mensagens: {recebimentoLigado ? 'ligado' : 'desligado'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {!conectado ? 'Conecte o WhatsApp em Conexão WA para o robô funcionar.'
              : recebimentoLigado ? 'O WhatsApp avisa o sistema de cada mensagem recebida. Se o robô parar de responder, ligue de novo.'
              : 'Sem isso o robô não fica sabendo das mensagens. Ligue uma vez; reconectar o WhatsApp mantém ligado.'}
          </p>
        </div>
        <button
          onClick={() => executar('webhook', ativarRecebimentoAction, 'Recebimento de mensagens ligado.')}
          disabled={!conectado || ocupado === 'webhook'}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm text-foreground transition hover:border-primary disabled:opacity-50"
        >
          {ocupado === 'webhook' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
          {recebimentoLigado ? 'Ligar de novo' : 'Ligar recebimento'}
        </button>
      </div>

      {erro && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
      {aviso && <p role="status" className="rounded-xl bg-primary/10 px-3 py-2 text-sm text-foreground">{aviso}</p>}

      <div role="tablist" className="flex gap-1 border-b border-border">
        {(['fluxos', 'contatos'] as const).map(a => (
          <button key={a} role="tab" aria-selected={aba === a} onClick={() => setAba(a)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${aba === a ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {a === 'fluxos' ? `Fluxos (${fluxos.length})` : `Contatos (${conversas.length})`}
            {a === 'contatos' && aguardando > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground tabular-nums">{aguardando}</span>
            )}
          </button>
        ))}
      </div>

      {aba === 'fluxos' ? (
        fluxos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">Nenhum fluxo ainda. Crie o primeiro: mensagem de boas-vindas, menu de opções e o que acontece em cada uma.</p>
            <Link href="/chatbot/novo" className="mt-4 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">
              Criar primeiro fluxo
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {fluxos.map(f => {
              const gatilhos = [
                f.palavras.length ? `palavra: ${f.palavras.slice(0, 3).join(', ')}${f.palavras.length > 3 ? '…' : ''}` : null,
                f.etiquetas.length ? `etiqueta: ${f.etiquetas.join(', ')}` : null,
              ].filter(Boolean)
              return (
                <div key={f.id} className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-4">
                  <Link href={`/chatbot/${f.id}`} className="min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{f.nome}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${f.ativo ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                        {f.ativo ? 'Ligado' : 'Desligado'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className="tabular-nums">{f.etapas}</span> etapa{f.etapas === 1 ? '' : 's'} · {gatilhos.length ? gatilhos.join(' · ') : 'só por resposta a disparo'}
                      {f.excluidas.length > 0 && ` · fora: ${f.excluidas.join(', ')}`}
                    </p>
                  </Link>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => executar(f.id, () => alternarFluxoAction(f.id, !f.ativo))} disabled={ocupado === f.id}
                      aria-label={f.ativo ? `Desligar ${f.nome}` : `Ligar ${f.nome}`}
                      className="rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50">
                      {f.ativo ? 'Desligar' : 'Ligar'}
                    </button>
                    <button onClick={() => confirm(`Excluir o fluxo "${f.nome}"? Quem está nele sai da conversa.`) && executar(f.id, () => excluirFluxoAction(f.id))}
                      disabled={ocupado === f.id} aria-label={`Excluir ${f.nome}`}
                      className="rounded-xl border border-border p-2 text-muted-foreground transition hover:border-destructive hover:text-destructive disabled:opacity-50">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : conversas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Ninguém falou com o robô ainda. Os contatos aparecem aqui quando entram num fluxo.
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {conversas.map(c => {
            const s = SITUACAO[c.status]
            const acoes: { acao: 'retomar' | 'pausar' | 'encerrar' | 'permitir'; rotulo: string; icone: React.ReactNode }[] =
              c.status === 'humano' ? [{ acao: 'retomar', rotulo: 'Devolver ao robô', icone: <Play className="h-3.5 w-3.5" /> }, { acao: 'encerrar', rotulo: 'Encerrar', icone: <Square className="h-3.5 w-3.5" /> }]
              : c.status === 'ativa' ? [{ acao: 'pausar', rotulo: 'Pausar robô', icone: <Pause className="h-3.5 w-3.5" /> }, { acao: 'encerrar', rotulo: 'Encerrar', icone: <Square className="h-3.5 w-3.5" /> }]
              : c.status === 'descadastrado' ? [{ acao: 'permitir', rotulo: 'Permitir de novo', icone: <RotateCcw className="h-3.5 w-3.5" /> }]
              : []
            return (
              <div key={c.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <button onClick={() => setHistorico(c)} className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{c.nome ?? telefone(c.celular)}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.rotulo}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {c.nome && `${telefone(c.celular)} · `}{c.fluxo ?? 'sem fluxo'} · {quando(c.atualizado_em)}
                  </p>
                </button>
                {acoes.length > 0 && (
                  <div className="flex shrink-0 gap-2">
                    {acoes.map(a => (
                      <button key={a.acao} onClick={() => executar(`${c.id}-${a.acao}`, () => mudarConversaAction(c.id, a.acao))}
                        disabled={ocupado?.startsWith(c.id)}
                        className="flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50">
                        {ocupado === `${c.id}-${a.acao}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : a.icone} {a.rotulo}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {historico && <Historico conversa={historico} onFechar={() => setHistorico(null)} />}
    </div>
  )
}

function Historico({ conversa, onFechar }: { conversa: Conversa; onFechar: () => void }) {
  const [mensagens, setMensagens] = useState<MensagemHistorico[] | null>(null)
  const [erro, setErro]           = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    historicoAction(conversa.id).then(r => {
      if (!vivo) return
      if (r.error) setErro(r.error)
      else setMensagens(r.mensagens ?? [])
    })
    return () => { vivo = false }
  }, [conversa.id])

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onFechar} />
      <div role="dialog" aria-modal="true" aria-labelledby="titulo-historico"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="titulo-historico" className="truncate text-sm font-semibold text-foreground">{conversa.nome ?? telefone(conversa.celular)}</h2>
            <p className="text-xs text-muted-foreground tabular-nums">{telefone(conversa.celular)}</p>
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="rounded-md p-1 text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          {!mensagens && !erro && (
            <div className="space-y-2" aria-label="Carregando histórico">
              {[0, 1, 2].map(i => <div key={i} className="h-10 animate-pulse rounded-xl bg-muted" />)}
            </div>
          )}
          {mensagens?.length === 0 && <p className="text-sm text-muted-foreground">Sem mensagens registradas.</p>}
          {mensagens?.map(m => m.direcao === 'evento' ? (
            <p key={m.id} className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
              <UserCheck className="h-3 w-3 shrink-0" /> {m.texto} <span className="tabular-nums">· {quando(m.criado_em)}</span>
            </p>
          ) : (
            <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.direcao === 'enviada' ? 'ml-auto bg-primary/10 text-foreground' : 'bg-muted text-foreground'}`}>
              <p className="whitespace-pre-line break-words">{m.texto}</p>
              <p className="mt-1 text-right text-[10px] text-muted-foreground tabular-nums">{m.direcao === 'enviada' ? 'Robô · ' : ''}{quando(m.criado_em)}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
