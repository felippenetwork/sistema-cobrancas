'use client'

import { useActionState, useState, useEffect, useRef } from 'react'
import { Loader2, CheckCircle } from 'lucide-react'
import { salvarConfiguracoesAction } from './_actions/configuracoes'
import { sanitizarLocalPart } from '@/lib/email/template'
import { createClient } from '@/lib/supabase/client'

const INPUT = 'w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20'
const LABEL = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5'

type Data = {
  cfg: {
    contato?: string | null
    cpf_cnpj?: string | null
    endereco?: string | null
    nome_comercial?: string | null
  } | null
  rem:    { local_part?: string | null; from_name?: string | null } | null
  domain: string | null
}

export const dynamic = 'force-dynamic'

export default function ConfiguracoesPage() {
  const [stateGeral,  formActionGeral,  isPendingGeral]  = useActionState(salvarConfiguracoesAction, { error: null })

  const [data, setData]                   = useState<Data | null>(null)
  const [localPart, setLocalPart]         = useState('')
  const [loading, setLoading]             = useState(true)
  const scrollSaveRef = useRef(0)

  const SCROLL_KEY = 'cfg-scroll-y'

  const loadData = async (preserveScroll = false) => {
    if (preserveScroll && typeof window !== 'undefined') {
      scrollSaveRef.current = window.scrollY
    }

    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return

    const [{ data: conta }, { data: plat }] = await Promise.all([
      sb.from('contas').select('id').eq('owner_user_id', user.id).single(),
      sb.from('plataforma_config').select('dominio_email_operador').single(),
    ])
    if (!conta) return

    const [{ data: cfgRaw }, { data: rem }] = await Promise.all([
      sb.from('configuracoes')
        .select('contato, cpf_cnpj, endereco, nome_comercial')
        .eq('conta_id', conta.id)
        .maybeSingle(),
      sb.from('email_remetente').select('local_part, from_name').eq('conta_id', conta.id).maybeSingle(),
    ])

    const cfg = cfgRaw as Data['cfg']
    setData({ cfg, rem, domain: plat?.dominio_email_operador ?? null })
    setLocalPart(rem?.local_part ?? '')
    setLoading(false)

    if (preserveScroll && scrollSaveRef.current > 0) {
      requestAnimationFrame(() => window.scrollTo({ top: scrollSaveRef.current, behavior: 'instant' }))
    }
  }

  // Carga inicial
  useEffect(() => { loadData() }, [])

  // Salvar posição no F5/navegação
  useEffect(() => {
    const save = () => sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))
    window.addEventListener('beforeunload', save)
    return () => window.removeEventListener('beforeunload', save)
  }, [])

  // Restaurar posição após carregar dados (cobrindo F5 e navegação de volta)
  useEffect(() => {
    if (!loading) {
      const saved = sessionStorage.getItem(SCROLL_KEY)
      if (saved) {
        sessionStorage.removeItem(SCROLL_KEY)
        requestAnimationFrame(() => window.scrollTo({ top: parseInt(saved), behavior: 'instant' }))
      }
    }
  }, [loading])

  // Recargas após salvar — preservando posição de scroll
  useEffect(() => { if (stateGeral.success)  loadData(true) }, [stateGeral.success])

  const previewEmail = data?.domain && localPart
    ? `${sanitizarLocalPart(localPart)}@${data.domain}`
    : null

  if (loading) return (
    <div className="flex min-h-[40vh] items-center justify-center p-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-4 md:p-8">
      <h1 className="text-xl font-semibold text-foreground">Configurações</h1>

      {/* ── Dados da empresa + e-mail ───────────────────────────────────────── */}
      <form action={formActionGeral} className="space-y-6">

        <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Dados da empresa</h2>

          <div className="space-y-1.5">
            <label className={LABEL}>Nome comercial</label>
            <input type="text" name="nome_comercial"
              defaultValue={data?.cfg?.nome_comercial ?? ''}
              placeholder="Padaria do João" className={INPUT} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className={LABEL}>CPF / CNPJ</label>
              <input type="text" name="cpf_cnpj"
                defaultValue={data?.cfg?.cpf_cnpj ?? ''}
                placeholder="00.000.000/0001-00" className={INPUT} />
            </div>
            <div className="space-y-1.5">
              <label className={LABEL}>Contato</label>
              <input type="text" name="contato"
                defaultValue={data?.cfg?.contato ?? ''}
                placeholder="(11) 99999-9999" className={INPUT} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={LABEL}>Endereço</label>
            <input type="text" name="endereco"
              defaultValue={data?.cfg?.endereco ?? ''}
              placeholder="Rua das Flores, 123 – São Paulo/SP" className={INPUT} />
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Remetente de e-mail</h2>

          {!data?.domain && (
            <p className="rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning">
              Domínio de e-mail ainda não configurado. Contate o administrador.
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

        {stateGeral.error && (
          <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{stateGeral.error}</p>
        )}
        {stateGeral.success && (
          <p className="flex items-center gap-2 rounded-xl bg-success-bg px-3 py-2 text-sm text-success">
            <CheckCircle className="h-4 w-4" />
            Configurações salvas.
          </p>
        )}

        <button
          type="submit" disabled={isPendingGeral}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {isPendingGeral && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPendingGeral ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </form>
    </div>
  )
}
