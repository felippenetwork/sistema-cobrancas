'use client'

import { useActionState, useEffect, useState } from 'react'
import { Loader2, CheckCircle } from 'lucide-react'
import { salvarPlataformaAction } from '../_actions/plataforma'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/client'

const INPUT = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'

export default function PlataformaPage() {
  const [state, formAction, isPending] = useActionState(salvarPlataformaAction, { error: null })
  const [dominio, setDominio] = useState('')

  useEffect(() => {
    const sb = createClient()
    sb.from('plataforma_config').select('dominio_email_operador').single()
      .then(({ data }) => {
        if ((data as any)?.dominio_email_operador) {
          setDominio((data as any).dominio_email_operador)
        }
      })
  }, [])

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Configuração da plataforma</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Configurações globais — aplicadas a todas as contas.
        </p>
      </div>

      <div className="max-w-lg rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Domínio de e-mail compartilhado</h2>
        <p className="text-sm text-muted-foreground">
          Subdomínio autenticado uma vez no Resend (SPF/DKIM/DMARC). Todos os clientes enviam e-mails a partir deste domínio. Autentique-o no painel do Resend antes de salvar.
        </p>

        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Domínio (ex.: cobranca.suaempresa.com.br)
            </label>
            <input
              type="text"
              name="dominio_email_operador"
              value={dominio}
              onChange={e => setDominio(e.target.value)}
              placeholder="cobranca.suaempresa.com.br"
              className={INPUT}
            />
            {dominio && (
              <p className="text-xs text-muted-foreground">
                Remetente exemplo: <span className="font-medium text-foreground">minha-empresa@{dominio}</span>
              </p>
            )}
          </div>

          {state.error && (
            <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">{state.error}</p>
          )}
          {state.success && (
            <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-sm text-success">
              <CheckCircle className="h-4 w-4" />
              Domínio salvo. Lembre-se de autenticar no Resend.
            </p>
          )}

          <button
            type="submit" disabled={isPending}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? 'Salvando...' : 'Salvar domínio'}
          </button>
        </form>
      </div>

      <div className="mt-6 max-w-lg rounded-lg border border-border bg-card p-6 space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Variáveis de ambiente necessárias</h2>
        <p className="text-sm text-muted-foreground">Configure no servidor (Vercel / .env.local):</p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li><code className="text-foreground">RESEND_API_KEY</code> — chave da API do Resend</li>
          <li><code className="text-foreground">RESEND_WEBHOOK_SECRET</code> — secret do webhook (painel Resend → Webhooks)</li>
        </ul>
        <p className="text-xs text-muted-foreground mt-2">
          URL do webhook a configurar no Resend: <code className="text-foreground">https://SEU-DOMINIO/api/resend/webhook</code>
        </p>
      </div>
    </div>
  )
}
