'use client'

import { useActionState, useState, useEffect } from 'react'
import { Loader2, CheckCircle, Copy, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { criarAssinaturaAction } from '../_actions/assinaturas'
import { formatBRL } from '@/lib/utils/format'

const INPUT = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'

const STATUS_CLS: Record<string, string> = {
  ativa:        'bg-success-bg text-success',
  pendente:     'bg-warning-bg text-warning',
  cancelada:    'bg-muted text-muted-foreground',
  inadimplente: 'bg-destructive-bg text-destructive',
}

export default function AssinaturasPage() {
  const [state, formAction, isPending] = useActionState(criarAssinaturaAction, { error: null })
  const [contas, setContas]       = useState<any[]>([])
  const [assinaturas, setAss]     = useState<any[]>([])
  const [copied, setCopied]       = useState(false)

  async function fetchData() {
    const sb = createClient()
    const [{ data: c }, { data: a }] = await Promise.all([
      sb.from('contas').select('id, nome_empresa').order('nome_empresa'),
      sb.from('assinaturas').select('id, conta_id, mp_preapproval_id, status, valor, proximo_vencimento, created_at, contas(nome_empresa)').order('created_at', { ascending: false }),
    ])
    setContas(c ?? [])
    setAss(a ?? [])
  }

  useEffect(() => { fetchData() }, [])
  useEffect(() => { if (state.success) fetchData() }, [state.success])

  function copiar(text: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Assinaturas</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Assinaturas recorrentes do SaaS (Mercado Pago Preapproval).
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">

        {/* Criar nova assinatura */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Criar assinatura</h2>
          <form action={formAction} className="space-y-4">

            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Conta *</label>
              <select name="conta_id" required className={INPUT}>
                <option value="">Selecione...</option>
                {contas.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.nome_empresa}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Valor mensal (R$) *</label>
              <input type="text" name="valor" required placeholder="99,90" className={INPUT} />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Descrição (opcional)</label>
              <input type="text" name="descricao" placeholder="Assinatura Quita — Plano Mensal" className={INPUT} />
            </div>

            {state.error && (
              <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">{state.error}</p>
            )}

            {state.initPoint && (
              <div className="rounded-md bg-success-bg p-3 space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium text-success">
                  <CheckCircle className="h-4 w-4" /> Assinatura criada!
                </p>
                <p className="text-xs text-success">Compartilhe este link com o cliente para autorizar o pagamento:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-success/10 px-2 py-1 text-xs text-success">
                    {state.initPoint}
                  </code>
                  <button type="button" onClick={() => copiar(state.initPoint!)}
                    className="shrink-0 rounded p-1 text-success hover:opacity-80">
                    {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <a href={state.initPoint} target="_blank" rel="noopener"
                    className="shrink-0 rounded p-1 text-success hover:opacity-80">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            )}

            <button type="submit" disabled={isPending}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? 'Criando...' : 'Criar assinatura no MP'}
            </button>
          </form>
        </div>

        {/* Lista de assinaturas */}
        <div>
          <h2 className="mb-4 text-sm font-semibold text-foreground">Assinaturas ativas</h2>
          {assinaturas.length === 0 ? (
            <div className="rounded-lg border border-border bg-card py-8 text-center">
              <p className="text-sm text-muted-foreground">Nenhuma assinatura criada.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {assinaturas.map((a: any) => (
                <div key={a.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{a.contas?.nome_empresa}</p>
                      <p className="monetary text-xs text-muted-foreground">{formatBRL(a.valor)}/mês</p>
                      {a.proximo_vencimento && (
                        <p className="monetary text-xs text-muted-foreground">
                          Próximo: {new Date(a.proximo_vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}
                        </p>
                      )}
                    </div>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[a.status] ?? 'bg-muted text-muted-foreground'}`}>
                      {a.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
