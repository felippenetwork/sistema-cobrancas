'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const router   = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'E-mail ou senha incorretos.'
          : 'Falha ao autenticar. Tente novamente.',
      )
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">

        {/* Marca */}
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-foreground">Quita</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acesse sua conta para gerenciar cobranças.
          </p>
        </div>

        {/* Card de login */}
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

            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Senha
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
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
              {loading ? 'Entrando...' : 'Entrar'}
            </button>

          </form>
        </div>

        <p className="mt-4 text-center">
          <Link
            href="/reset-senha"
            className="text-sm text-muted-foreground transition hover:text-foreground"
          >
            Esqueci minha senha
          </Link>
        </p>

      </div>
    </div>
  )
}
