'use client'

import { useActionState, useState, useEffect } from 'react'
import { Plus, X, Loader2 } from 'lucide-react'
import { criarAgendamentoAction, type ActionState } from '../_actions/agendamentos'

const INPUT = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'
const LABEL = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

function hojeEmSP() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

type Cliente = { id: string; nome: string; sobrenome: string }

export function NovoAgendamentoForm({ clientes }: { clientes: Cliente[] }) {
  const [aberto, setAberto] = useState(false)
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    criarAgendamentoAction,
    { error: null },
  )
  const [canais, setCanais] = useState<string[]>(['whatsapp'])

  useEffect(() => {
    if (state.success && aberto) setAberto(false)
  }, [state.success, aberto])

  const querEmail = canais.includes('email')

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
      >
        <Plus className="h-4 w-4" />
        Novo agendamento
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Agendar mensagem</h3>
        <button onClick={() => setAberto(false)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <form action={formAction} className="space-y-4">

        {/* Cliente */}
        <div className="space-y-1">
          <label className={LABEL}>Cliente *</label>
          <select name="cliente_id" required className={INPUT}>
            <option value="">Selecione um cliente…</option>
            {clientes.map(c => (
              <option key={c.id} value={c.id}>{c.nome} {c.sobrenome}</option>
            ))}
          </select>
        </div>

        {/* Canal */}
        <div className="space-y-1">
          <label className={LABEL}>Canal *</label>
          <div className="flex gap-4">
            {[
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'email',    label: 'E-mail'   },
            ].map(c => (
              <label key={c.value} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  name="canais"
                  value={c.value}
                  checked={canais.includes(c.value)}
                  onChange={e => setCanais(prev =>
                    e.target.checked ? [...prev, c.value] : prev.filter(x => x !== c.value)
                  )}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        {/* Data e hora */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className={LABEL}>Data *</label>
            <input type="date" name="data" required min={hojeEmSP()} defaultValue={hojeEmSP()} className={INPUT} />
          </div>
          <div className="space-y-1">
            <label className={LABEL}>Hora *</label>
            <input type="time" name="hora" required defaultValue="10:00" className={INPUT} />
          </div>
        </div>

        {/* Assunto (só e-mail) */}
        {querEmail && (
          <div className="space-y-1">
            <label className={LABEL}>Assunto do e-mail *</label>
            <input type="text" name="assunto" required={querEmail} maxLength={200} placeholder="Ex: Lembrete importante" className={INPUT} />
          </div>
        )}

        {/* Mensagem */}
        <div className="space-y-1">
          <label className={LABEL}>Mensagem *</label>
          <textarea
            name="mensagem"
            required
            maxLength={4000}
            rows={5}
            placeholder="Digite a mensagem…"
            className={INPUT + ' resize-y'}
          />
          <p className="text-[11px] text-muted-foreground">
            Variáveis disponíveis:{' '}
            <code className="font-mono">#NOME#</code>,{' '}
            <code className="font-mono">#NOMECOMPLETO#</code>,{' '}
            <code className="font-mono">#SAUDACAO#</code>
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            Envio entre 09h e 20h. Fora desse horário, a mensagem é enviada no próximo horário disponível.
          </p>
        </div>

        {/* Erro + submit */}
        <div className="flex items-center gap-3">
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <button
            type="submit"
            disabled={isPending || canais.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? 'Agendando…' : 'Agendar'}
          </button>
        </div>
      </form>
    </div>
  )
}
