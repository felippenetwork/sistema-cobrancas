'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function NovaSenhaPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [done, setDone]         = useState(false)
  const router   = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (password.length < 8) {
      setError('A senha deve ter no mínimo 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }

    setLoading(true)
    setError('')

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError('Não foi possível atualizar a senha. O link pode ter expirado — solicite um novo.')
      setLoading(false)
      return
    }

    setDone(true)
    setTimeout(() => router.push('/dashboard'), 1500)
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-base font-semibold text-foreground">Senha atualizada</h1>
          <p className="mt-2 text-sm text-muted-foreground">Redirecionando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-foreground">Nova senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Defina a nova senha de acesso à sua conta.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">

            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Nova senha
              </label>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Confirmar senha
              </label>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repita a nova senha"
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
              {loading ? 'Salvando...' : 'Salvar nova senha'}
            </button>

          </form>
        </div>

      </div>
    </div>
  )
}
