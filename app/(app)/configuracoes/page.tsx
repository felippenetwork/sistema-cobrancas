'use client'

import { useActionState, useState, useEffect } from 'react'
import { Loader2, CheckCircle } from 'lucide-react'
import { salvarConfiguracoesAction } from './_actions/configuracoes'
import { sanitizarLocalPart } from '@/lib/email/template'
import { createClient } from '@/lib/supabase/client'

const INPUT = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'
const LABEL = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'

type Data = {
  cfg:    { contato?: string | null; cpf_cnpj?: string | null; endereco?: string | null; nome_comercial?: string | null } | null
  rem:    { local_part?: string | null; from_name?: string | null } | null
  domain: string | null
}

export const dynamic = 'force-dynamic'

export default function ConfiguracoesPage() {
  const [state, formAction, isPending] = useActionState(salvarConfiguracoesAction, { error: null })
  const [data, setData]   = useState<Data | null>(null)
  const [localPart, setLocalPart] = useState('')
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return

    const [{ data: conta }, { data: plat }] = await Promise.all([
      sb.from('contas').select('id').eq('owner_user_id', user.id).single(),
      sb.from('plataforma_config').select('dominio_email_operador').single(),
    ])
    if (!conta) return

    const [{ data: cfg }, { data: rem }] = await Promise.all([
      sb.from('configuracoes').select('contato, cpf_cnpj, endereco, nome_comercial').eq('conta_id', conta.id).maybeSingle(),
      sb.from('email_remetente').select('local_part, from_name').eq('conta_id', conta.id).maybeSingle(),
    ])

    setData({
      cfg,
      rem,
      domain: plat?.dominio_email_operador ?? null,
    })
    setLocalPart(rem?.local_part ?? '')
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  // Recarrega os dados após salvar com sucesso
  useEffect(() => {
    if (state.success) loadData()
  }, [state.success])

  const previewEmail = data?.domain && localPart
    ? `${sanitizarLocalPart(localPart)}@${data.domain}`
    : null

  if (loading) return (
    <div className="flex min-h-[40vh] items-center justify-center p-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )

  return (
    <div className="p-8">
      <h1 className="mb-6 text-xl font-semibold text-foreground">Configurações</h1>

      <div className="max-w-lg space-y-6">
        <form action={formAction} className="space-y-6">

          {/* Dados da empresa */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Dados da empresa</h2>

            <div className="space-y-1.5">
              <label className={LABEL}>Nome comercial</label>
              <input type="text" name="nome_comercial"
                defaultValue={data?.cfg?.nome_comercial ?? ''}
                placeholder="Padaria do João" className={INPUT} />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>CPF / CNPJ</label>
              <input type="text" name="cpf_cnpj"
                defaultValue={data?.cfg?.cpf_cnpj ?? ''}
                placeholder="00.000.000/0001-00" className={INPUT} />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Endereço</label>
              <input type="text" name="endereco"
                defaultValue={data?.cfg?.endereco ?? ''}
                placeholder="Rua das Flores, 123 – São Paulo/SP" className={INPUT} />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Contato</label>
              <input type="text" name="contato"
                defaultValue={data?.cfg?.contato ?? ''}
                placeholder="(11) 99999-9999" className={INPUT} />
            </div>
          </section>

          {/* Remetente de e-mail */}
          <section className="rounded-lg border border-border bg-card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Remetente de e-mail</h2>

            {!data?.domain && (
              <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
                O domínio de e-mail do operador ainda não foi configurado. Contate o administrador.
              </p>
            )}

            <div className="space-y-1.5">
              <label className={LABEL}>Nome do remetente (parte antes do @)</label>
              <input type="text" name="local_part"
                value={localPart}
                onChange={e => setLocalPart(e.target.value)}
                placeholder="minha-empresa"
                className={INPUT} />
              {previewEmail && (
                <p className="text-xs text-muted-foreground">
                  Remetente: <span className="font-medium text-foreground">{previewEmail}</span>
                  {' '}— sanitizado automaticamente para [a-z0-9.-]
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Nome de exibição</label>
              <input type="text" name="from_name"
                defaultValue={data?.rem?.from_name ?? ''}
                placeholder="Padaria do João — Cobranças" className={INPUT} />
            </div>
          </section>

          {state.error && (
            <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}
          {state.success && (
            <p className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-sm text-success">
              <CheckCircle className="h-4 w-4" />
              Configurações salvas com sucesso.
            </p>
          )}

          <button
            type="submit" disabled={isPending}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? 'Salvando...' : 'Salvar configurações'}
          </button>

        </form>
      </div>
    </div>
  )
}
