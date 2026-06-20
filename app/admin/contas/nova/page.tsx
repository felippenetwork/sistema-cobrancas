'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { criarContaAction } from '../../_actions/contas'

const INPUT_CLS =
  'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'

export default function NovaContaPage() {
  const [state, formAction, isPending] = useActionState(criarContaAction, { error: null })

  return (
    <div className="p-8">

      <div className="mb-6">
        <Link href="/admin/contas" className="text-xs text-muted-foreground transition hover:text-foreground">
          ← Contas
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Nova conta</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Um convite de acesso será enviado para o e-mail do dono da conta.
        </p>
      </div>

      <div className="max-w-lg rounded-lg border border-border bg-card p-6">
        <form action={formAction} className="space-y-4">

          <div className="space-y-1.5">
            <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              E-mail do dono *
            </label>
            <input
              type="email" name="email" required autoComplete="off"
              placeholder="dono@empresa.com.br"
              className={INPUT_CLS}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Nome da empresa *
            </label>
            <input
              type="text" name="nome_empresa" required
              placeholder="Padaria do João"
              className={INPUT_CLS}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Válido até *
              </label>
              <input
                type="date" name="validade_plano" required
                className={INPUT_CLS}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Limite de clientes
              </label>
              <input
                type="number" name="limite_clientes"
                min="1" max="10000" defaultValue="100"
                className={INPUT_CLS}
              />
            </div>
          </div>

          {state.error && (
            <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit" disabled={isPending}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? 'Criando...' : 'Criar conta e enviar convite'}
            </button>
            <Link
              href="/admin/contas"
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Cancelar
            </Link>
          </div>

        </form>
      </div>

    </div>
  )
}
