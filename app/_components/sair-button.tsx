'use client'

// Botão Sair com modal de confirmação inline.
// PRD §6.11: "Botão Sair → modal de confirmação → logout (encerra sessão Supabase)."
// Usado em ambos os sidebars (app e admin).

import { useState } from 'react'
import { LogOut, AlertCircle } from 'lucide-react'

type Props = {
  signOutAction: () => Promise<void>
  className?: string
}

export function SairButton({ signOutAction, className = '' }: Props) {
  const [confirmando, setConfirmando] = useState(false)

  if (confirmando) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2.5">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
          Confirma saída da conta?
        </div>
        <div className="flex gap-2">
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90"
            >
              Sim, sair
            </button>
          </form>
          <button
            onClick={() => setConfirmando(false)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirmando(true)}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${className}`}
    >
      <LogOut className="h-4 w-4" />
      Sair
    </button>
  )
}
