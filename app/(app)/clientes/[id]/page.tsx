'use client'

import { useActionState } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, CheckCircle } from 'lucide-react'
import { atualizarClienteAction, excluirClienteAction } from '../_actions/clientes'
import { formatarCPF } from '@/lib/validations/cpf'
import { formatarCelular } from '@/lib/validations/celular'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'

const INPUT = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'
const LABEL = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'

type Cliente = {
  id: string; nome: string; sobrenome: string
  celular: string; cpf: string; email: string
}

export default function EditarClientePage() {
  const { id } = useParams<{ id: string }>()
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [loading, setLoading] = useState(true)
  const [state, formAction, isPending] = useActionState(atualizarClienteAction, { error: null })

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('clientes')
      .select('id, nome, sobrenome, celular, cpf, email')
      .eq('id', id)
      .single()
      .then(({ data }) => { setCliente(data as Cliente); setLoading(false) })
  }, [id])

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!cliente) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">Cliente não encontrado.</p>
        <Link href="/clientes" className="mt-2 block text-sm text-primary">← Clientes</Link>
      </div>
    )
  }

  return (
    <div className="p-8">

      <div className="mb-6">
        <Link href="/clientes" className="text-xs text-muted-foreground transition hover:text-foreground">
          ← Clientes
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">
          {cliente.nome} {cliente.sobrenome}
        </h1>
      </div>

      <div className="max-w-lg space-y-6">

        {/* Editar */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Dados do cliente</h2>
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="cliente_id" value={cliente.id} />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className={LABEL}>Nome *</label>
                <input type="text" name="nome" required defaultValue={cliente.nome} className={INPUT} />
              </div>
              <div className="space-y-1.5">
                <label className={LABEL}>Sobrenome</label>
                <input type="text" name="sobrenome" defaultValue={cliente.sobrenome} className={INPUT} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>CPF</label>
              <input
                type="text" name="cpf" maxLength={14}
                defaultValue={formatarCPF(cliente.cpf)}
                className={INPUT}
              />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Celular *</label>
              <input
                type="text" name="celular" required
                defaultValue={formatarCelular(cliente.celular)}
                className={INPUT}
              />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>E-mail</label>
              <input type="email" name="email" defaultValue={cliente.email} className={INPUT} />
            </div>

            {state.error && (
              <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">{state.error}</p>
            )}
            {state.success && (
              <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-sm text-success">
                <CheckCircle className="h-4 w-4" />
                Alterações salvas.
              </p>
            )}

            <button
              type="submit" disabled={isPending}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </form>
        </div>

        {/* Excluir */}
        <div className="rounded-lg border border-destructive/30 bg-card p-6">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Excluir cliente</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            O cliente some da lista, mas o histórico financeiro é preservado.
          </p>
          <form action={excluirClienteAction}>
            <input type="hidden" name="cliente_id" value={cliente.id} />
            <input type="hidden" name="redirect_to" value="/clientes" />
            <button
              type="submit"
              className="rounded-md border border-destructive/40 bg-destructive-bg px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/20"
            >
              Excluir cliente
            </button>
          </form>
        </div>

      </div>
    </div>
  )
}
