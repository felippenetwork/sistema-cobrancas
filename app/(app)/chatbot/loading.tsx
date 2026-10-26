export default function Carregando() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6" aria-busy="true" aria-label="Carregando o chatbot">
      <div className="space-y-2">
        <div className="h-6 w-32 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="h-20 animate-pulse rounded-2xl border border-border bg-card" />
      <div className="space-y-3">
        {[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-2xl border border-border bg-card" />)}
      </div>
    </div>
  )
}
