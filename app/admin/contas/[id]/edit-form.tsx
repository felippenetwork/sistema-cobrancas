'use client'

import { useActionState } from 'react'
import { Loader2, CheckCircle } from 'lucide-react'
import { editarContaAction } from '../../_actions/contas'

type Conta = {
  id: string
  nome_empresa: string
  validade_plano: string | null
  limite_clientes: number
}

const INPUT_CLS =
  'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'

export function EditContaForm({ conta }: { conta: Conta }) {
  const [state, formAction, isPending] = useActionState(editarContaAction, { error: null })

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="conta_id" value={conta.id} />

      <div className="space-y-1.5">
        <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Nome da empresa *
        </label>
        <input
          type="text" name="nome_empresa" required
          defaultValue={conta.nome_empresa}
          className={INPUT_CLS}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Válido até
          </label>
          <input
            type="date" name="validade_plano"
            defaultValue={conta.validade_plano?.slice(0, 10) ?? ''}
            className={INPUT_CLS}
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Limite de clientes
          </label>
          <input
            type="number" name="limite_clientes"
            min="1" max="10000"
            defaultValue={conta.limite_clientes}
            className={INPUT_CLS}
          />
        </div>
      </div>

      {state.error && (
        <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-sm text-success">
          <CheckCircle className="h-4 w-4" />
          Alterações salvas com sucesso.
        </p>
      )}

      <button
        type="submit" disabled={isPending}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {isPending ? 'Salvando...' : 'Salvar alterações'}
      </button>
    </form>
  )
}
