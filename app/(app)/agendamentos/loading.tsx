export default function Carregando() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8" aria-busy="true" aria-label="Carregando os agendamentos">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="h-6 w-36 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="h-10 w-40 animate-pulse rounded-xl bg-muted" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-2xl border border-border bg-card" />)}
      </div>
    </div>
  )
}
