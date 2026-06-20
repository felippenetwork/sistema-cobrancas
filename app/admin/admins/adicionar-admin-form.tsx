'use client'

import { useActionState } from 'react'
import { Loader2, CheckCircle } from 'lucide-react'
import { adicionarAdminAction } from '../_actions/admins'

const INPUT_CLS =
  'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'

export function AdicionarAdminForm() {
  const [state, formAction, isPending] = useActionState(adicionarAdminAction, { error: null })

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          E-mail do novo admin
        </label>
        <input
          type="email" name="email" required
          placeholder="colega@empresa.com"
          className={INPUT_CLS}
        />
        <p className="text-xs text-muted-foreground">
          Se o e-mail não tiver conta, um convite será enviado automaticamente.
        </p>
      </div>

      {state.error && (
        <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-sm text-success">
          <CheckCircle className="h-4 w-4" />
          Administrador adicionado com sucesso.
        </p>
      )}

      <button
        type="submit" disabled={isPending}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {isPending ? 'Adicionando...' : 'Adicionar administrador'}
      </button>
    </form>
  )
}
