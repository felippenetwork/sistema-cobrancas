'use client'

export default function ErroChatbot({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md p-6 text-center">
      <p className="text-sm font-medium text-foreground">Não foi possível carregar o chatbot.</p>
      <p className="mt-1 text-sm text-muted-foreground">Os fluxos e os contatos continuam salvos. Tente de novo em instantes.</p>
      <button onClick={reset} className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">
        Tentar de novo
      </button>
    </div>
  )
}
