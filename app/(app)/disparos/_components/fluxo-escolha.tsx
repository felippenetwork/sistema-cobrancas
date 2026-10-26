'use client'

import Link from 'next/link'
import { Bot } from 'lucide-react'

export type FluxoDisparo = { id: string; nome: string; ativo: boolean }

/** Automação do chatbot em que entra quem responder ao disparo (opcional). */
export function FluxoEscolha({ id, fluxos, valor, onChange, name }: {
  id: string
  fluxos: FluxoDisparo[]
  valor: string
  onChange: (id: string) => void
  /** Nome do campo quando o formulário é enviado por FormData (modo normal). */
  name?: string
}) {
  const escolhido = fluxos.find(f => f.id === valor)
  return (
    <div className="space-y-2 rounded-xl border border-border px-4 py-3">
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Bot className="h-3.5 w-3.5 text-muted-foreground" /> Quando responderem
      </label>
      {fluxos.length ? (
        <select id={id} name={name} value={valor} onChange={e => onChange(e.target.value)}
          className="w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none focus-visible:border-primary">
          <option value="">Nada (o robô não responde)</option>
          {fluxos.map(f => <option key={f.id} value={f.id}>Entrar na automação: {f.nome}{f.ativo ? '' : ' (desligada)'}</option>)}
        </select>
      ) : (
        <p className="text-xs text-muted-foreground">
          Crie uma automação em <Link href="/chatbot" className="font-medium text-primary hover:underline">Chatbot</Link> para responder sozinho quem responder ao disparo.
        </p>
      )}
      {escolhido && !escolhido.ativo && (
        <p className="text-xs text-muted-foreground">Esta automação está desligada: ligue em Chatbot para o robô responder.</p>
      )}
      {escolhido && <p className="text-xs text-muted-foreground">Vale para respostas em até 7 dias depois do envio.</p>}
    </div>
  )
}
