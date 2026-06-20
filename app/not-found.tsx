import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">404</p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Página não encontrada</h1>
        <p className="mt-1 text-sm text-muted-foreground">O endereço acessado não existe.</p>
        <Link href="/dashboard" className="mt-4 block text-sm text-primary hover:opacity-80">
          Voltar ao início
        </Link>
      </div>
    </div>
  )
}
