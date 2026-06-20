import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export const metadata = { title: 'Plano expirado' }

export default function PlanoExpiradoPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-warning-bg">
          <AlertTriangle className="h-5 w-5 text-warning" />
        </div>
        <h1 className="text-base font-semibold text-foreground">
          Conta suspensa ou plano expirado
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sua conta está suspensa ou o plano venceu. Entre em contato com o suporte para renovar o acesso.
        </p>
        <Link
          href="/login"
          className="mt-6 block text-sm text-muted-foreground transition hover:text-foreground"
        >
          Voltar para o login
        </Link>
      </div>
    </div>
  )
}
