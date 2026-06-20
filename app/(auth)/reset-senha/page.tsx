'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function ResetSenhaPage() {
  const [email, setEmail]     = useState('')
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/nova-senha`,
    })

    if (error) {
      setError('Não foi possível enviar o e-mail. Verifique o endereço e tente novamente.')
      setLoading(false)
      return
    }

    setSent(true)
  }

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-base font-semibold text-foreground">Verifique seu e-mail</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enviamos um link de redefinição para{' '}
            <span className="font-medium text-foreground">{email}</span>.
          </p>
          <Link
            href="/login"
            className="mt-4 block text-sm text-muted-foreground transition hover:text-foreground"
          >
            Voltar para o login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-foreground">Redefinir senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Informe seu e-mail e enviaremos o link de redefinição.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">

            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                E-mail
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card"
              />
            </div>

            {error && (
              <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Enviando...' : 'Enviar link de redefinição'}
            </button>

          </form>
        </div>

        <p className="mt-4 text-center">
          <Link
            href="/login"
            className="text-sm text-muted-foreground transition hover:text-foreground"
          >
            Voltar para o login
          </Link>
        </p>

      </div>
    </div>
  )
}
