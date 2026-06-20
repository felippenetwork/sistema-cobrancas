'use client'

import { useActionState, useState } from 'react'
import { Plus, X, Loader2, CheckCircle } from 'lucide-react'
import { criarLancamentoAction } from '../_actions/lancamentos'

const INPUT = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'

function hojeISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

export function NovoLancamentoForm() {
  const [aberto, setAberto] = useState(false)
  const [state, formAction, isPending] = useActionState(criarLancamentoAction, { error: null })

  // Fecha o form após sucesso
  if (state.success && aberto) setAberto(false)

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
      >
        <Plus className="h-4 w-4" />
        Novo lançamento
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Novo lançamento manual</h3>
        <button onClick={() => setAberto(false)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <form action={formAction} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tipo *</label>
          <select name="tipo" required className={INPUT}>
            <option value="entrada">Entrada</option>
            <option value="saida">Saída</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Valor (R$) *</label>
          <input type="text" name="valor" required placeholder="0,00" className={INPUT} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Data *</label>
          <input type="date" name="data" required defaultValue={hojeISO()} className={INPUT} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Descrição</label>
          <input type="text" name="descricao" placeholder="Opcional" className={INPUT} />
        </div>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-4">
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <button
            type="submit" disabled={isPending}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
