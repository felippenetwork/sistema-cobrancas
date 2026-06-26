'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { criarClienteAction } from '../_actions/clientes'
import { mascararCelular } from '@/lib/validations/celular'

const INPUT = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'
const LABEL = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'

export default function NovoClientePage() {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(criarClienteAction, { error: null })
  const [celularInput, setCelularInput] = useState('')

  useEffect(() => {
    if (state.success) router.push('/clientes')
  }, [state.success, router])

  return (
    <div className="p-8">

      <div className="mb-6">
        <Link href="/clientes" className="text-xs text-muted-foreground transition hover:text-foreground">
          ← Clientes
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Novo cliente</h1>
      </div>

      <div className="max-w-lg rounded-lg border border-border bg-card p-6">
        <form action={formAction} className="space-y-4">

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className={LABEL}>Nome *</label>
              <input type="text" name="nome" required placeholder="João" className={INPUT} />
            </div>
            <div className="space-y-1.5">
              <label className={LABEL}>Sobrenome</label>
              <input type="text" name="sobrenome" placeholder="Silva" className={INPUT} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={LABEL}>CPF</label>
            <input
              type="text" name="cpf"
              placeholder="000.000.000-00"
              maxLength={14}
              className={INPUT}
            />
          </div>

          <div className="space-y-1.5">
            <label className={LABEL}>Celular *</label>
            <input
              type="text" name="celular" required
              value={celularInput}
              onChange={e => setCelularInput(mascararCelular(e.target.value))}
              placeholder="+55 (11) 99999-9999"
              className={INPUT}
            />
          </div>

          <div className="space-y-1.5">
            <label className={LABEL}>E-mail</label>
            <input
              type="email" name="email"
              placeholder="joao@email.com"
              className={INPUT}
            />
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
              {isPending ? 'Salvando...' : 'Cadastrar cliente'}
            </button>
            <Link
              href="/clientes"
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
