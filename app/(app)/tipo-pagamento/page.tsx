'use client'

import { useActionState, useState, useEffect } from 'react'
import { Loader2, CheckCircle, Star, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { criarMeioAction, definirPadraoAction, excluirMeioAction } from './_actions/meios'

const INPUT = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'
const LABEL = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'

type Meio = { id: string; nome: string; mensagem: string; is_padrao: boolean }

export default function TipoPagamentoPage() {
  const [state, formAction, isPending] = useActionState(criarMeioAction, { error: null })
  const [meios, setMeios]  = useState<Meio[]>([])
  const [padrao, setPadrao] = useState(false)

  async function fetchMeios() {
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const { data: conta } = await sb.from('contas').select('id').eq('owner_user_id', user.id).single()
    if (!conta) return
    const { data } = await sb.from('meios_pagamento').select('*').eq('conta_id', (conta as any).id).order('created_at')
    setMeios((data as Meio[]) ?? [])
  }

  useEffect(() => { fetchMeios() }, [])
  useEffect(() => { if (state.success) fetchMeios() }, [state.success])

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Tipo de Pagamento</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Cadastre sua chave Pix. O método marcado como padrão alimenta a variável #PIX# nas notificações.
        </p>
      </div>

      <div className="max-w-lg space-y-6">
        {/* Lista */}
        {meios.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  {['Nome', 'Chave / Mensagem Pix', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {meios.map(m => (
                  <tr key={m.id} className="bg-card hover:bg-accent/20">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{m.nome}</span>
                        {m.is_padrao && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-1.5 py-0.5 text-xs font-semibold text-warning">
                            <Star className="h-2.5 w-2.5" /> Padrão
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">{m.mensagem}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {!m.is_padrao && (
                          <form action={definirPadraoAction}>
                            <input type="hidden" name="meio_id" value={m.id} />
                            <button type="submit" className="text-xs text-primary hover:opacity-80">Definir padrão</button>
                          </form>
                        )}
                        <form action={excluirMeioAction}>
                          <input type="hidden" name="meio_id" value={m.id} />
                          <button type="submit" className="rounded p-1 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Novo */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Adicionar Pix</h2>
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="is_padrao" value={String(padrao)} />

            <div className="space-y-1.5">
              <label className={LABEL}>Nome *</label>
              <input type="text" name="nome" required placeholder="Pix principal" className={INPUT} />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Chave ou instrução Pix *</label>
              <textarea name="mensagem" required rows={3} placeholder="Pix: 00.000.000/0001-00" className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary resize-none" />
              <p className="text-xs text-muted-foreground">Este texto será inserido onde aparecer #PIX# nos templates.</p>
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="padrao" checked={padrao} onChange={e => setPadrao(e.target.checked)}
                className="h-4 w-4 accent-primary" />
              <label htmlFor="padrao" className="cursor-pointer text-sm text-foreground">Definir como padrão</label>
            </div>

            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            {state.success && (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle className="h-4 w-4" /> Pix adicionado.
              </p>
            )}

            <button type="submit" disabled={isPending}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? 'Salvando...' : 'Adicionar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
