'use client'

import { useState } from 'react'
import { Loader2, CheckCircle } from 'lucide-react'

export default function DescadastrarForm({ clienteId }: { clienteId: string }) {
  const [loading, setLoading]   = useState(false)
  const [concluido, setConcluido] = useState(false)
  const [erro, setErro]         = useState('')

  async function handleDescadastrar() {
    setLoading(true)
    setErro('')

    const res = await fetch(`/api/descadastrar/${clienteId}`, { method: 'POST' })
    if (res.ok) {
      setConcluido(true)
    } else {
      setErro('Não foi possível processar. Tente novamente.')
    }
    setLoading(false)
  }

  if (concluido) {
    return (
      <div className="mt-4 flex flex-col items-center gap-2">
        <CheckCircle className="h-6 w-6 text-success" />
        <p className="text-sm text-success">Descadastrado com sucesso.</p>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-3">
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <button
        onClick={handleDescadastrar}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {loading ? 'Processando...' : 'Confirmar descadastro'}
      </button>
      <p className="text-xs text-muted-foreground">
        Você não receberá mais e-mails desta conta.
      </p>
    </div>
  )
}
