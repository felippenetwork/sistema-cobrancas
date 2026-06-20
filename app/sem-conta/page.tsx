import Link from 'next/link'

export const metadata = { title: 'Conta não configurada' }

// Destino para usuários autenticados sem conta associada (ex.: admin no Sprint 1).
// Sprint 2 cria o painel admin; o admin não usa este fluxo após isso.
export default function SemContaPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
        <h1 className="text-base font-semibold text-foreground">
          Conta não configurada
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Este usuário não possui uma conta ativa na plataforma. Se você é administrador, o painel admin estará disponível em breve.
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
