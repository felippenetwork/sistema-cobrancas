'use client'

import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Send } from 'lucide-react'
import type { EstadoConversa, FluxoAtivo } from '@/lib/chatbot/fluxo'
import { iniciarSimulacao, responderSimulacao, type MensagemSimulada } from '@/lib/chatbot/simulador'

/**
 * Conversa de teste com a automação, sem WhatsApp: mesmas regras do robô de verdade
 * (lib/chatbot/simulador.ts). Recomeça sozinha quando as mensagens da automação mudam.
 */
export function Simulador({ fluxo }: { fluxo: FluxoAtivo }) {
  const [nome, setNome]           = useState('Maria')
  const [mensagens, setMensagens] = useState<MensagemSimulada[]>([])
  const [conversa, setConversa]   = useState<EstadoConversa | null>(null)
  const [texto, setTexto]         = useState('')
  const fim = useRef<HTMLDivElement>(null)

  // Recomeça quando o conteúdo da automação muda (não a cada render).
  const assinatura = JSON.stringify([fluxo.etapas, fluxo.msg_nao_entendi, fluxo.msg_humano, fluxo.palavras_humano, fluxo.aviso_numero, nome])
  useEffect(() => {
    const s = iniciarSimulacao(fluxo, nome)
    setMensagens(s.mensagens)
    setConversa(s.conversa)
    // Depende só de `assinatura` (o conteúdo de `fluxo`), não do objeto, que é recriado a cada render.
  }, [assinatura])

  useEffect(() => { fim.current?.scrollIntoView({ block: 'nearest' }) }, [mensagens])

  function responder(resposta: string) {
    if (!resposta.trim()) return
    const s = responderSimulacao(fluxo, conversa, resposta.trim(), nome)
    setMensagens(m => [...m, ...s.mensagens])
    setConversa(s.conversa)
    setTexto('')
  }

  function recomecar() {
    const s = iniciarSimulacao(fluxo, nome)
    setMensagens(s.mensagens)
    setConversa(s.conversa)
  }

  // Botões rápidos com as opções da mensagem atual.
  const etapa = conversa?.status === 'ativa' ? fluxo.etapas.find(e => e.id === conversa.etapa_id) : undefined
  const opcoes = etapa?.resposta.tipo === 'menu' ? etapa.resposta.opcoes : []

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Testar conversa</p>
          <p className="text-[11px] text-muted-foreground">Só na tela: nada é enviado.</p>
        </div>
        <button type="button" onClick={recomecar} className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          <RotateCcw className="h-3.5 w-3.5" /> Recomeçar
        </button>
      </div>

      <label className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        Nome de quem fala
        <input value={nome} onChange={e => setNome(e.target.value.slice(0, 40))} className="min-w-0 flex-1 rounded-lg border border-border bg-input px-2 py-1 text-xs text-foreground outline-none focus-visible:border-primary" />
      </label>

      <div className="h-[420px] space-y-2 overflow-y-auto bg-background/60 px-3 py-3" aria-live="polite">
        {!mensagens.length && <p className="text-center text-xs text-muted-foreground">Escreva a mensagem de boas-vindas para ver a conversa.</p>}
        {mensagens.map((m, i) => m.de === 'aviso' ? (
          <p key={i} className="mx-auto max-w-[90%] rounded-lg bg-muted px-2.5 py-1 text-center text-[11px] text-muted-foreground">{m.texto}</p>
        ) : (
          <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.de === 'robo' ? 'rounded-tl-sm bg-card text-foreground' : 'ml-auto rounded-tr-sm bg-primary/15 text-foreground'}`}>
            <p className="whitespace-pre-line break-words">{m.texto}</p>
          </div>
        ))}
        <div ref={fim} />
      </div>

      {opcoes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
          {opcoes.map((o, i) => (
            <button key={i} type="button" onClick={() => responder(String(i + 1))}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground hover:border-primary">
              {i + 1}. {o.rotulo || 'opção'}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={e => { e.preventDefault(); responder(texto) }} className="flex gap-2 border-t border-border p-3">
        <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Responder como a pessoa…" aria-label="Responder como a pessoa"
          className="min-w-0 flex-1 rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary" />
        <button type="submit" aria-label="Enviar resposta de teste" className="rounded-xl bg-primary px-3 text-primary-foreground hover:opacity-90">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
