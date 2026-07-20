'use client'

import { useActionState, useState, useEffect } from 'react'
import { Loader2, CheckCircle, Eye, EyeOff, ExternalLink } from 'lucide-react'
import { salvarConfiguracoesAction, salvarMetaApiAction } from './_actions/configuracoes'
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
    meta_access_token?: string | null
    meta_phone_number_id?: string | null
    meta_waba_id?: string | null
  } | null
  rem:    { local_part?: string | null; from_name?: string | null } | null
  domain: string | null
}

export const dynamic = 'force-dynamic'

export default function ConfiguracoesPage() {
  const [stateGeral, formActionGeral, isPendingGeral] = useActionState(salvarConfiguracoesAction, { error: null })
  const [stateMeta,  formActionMeta,  isPendingMeta]  = useActionState(salvarMetaApiAction,       { error: null })

  const [data, setData]           = useState<Data | null>(null)
  const [localPart, setLocalPart] = useState('')
  const [loading, setLoading]     = useState(true)
  const [showToken, setShowToken] = useState(false)

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
      sb.from('configuracoes')
        .select('contato, cpf_cnpj, endereco, nome_comercial, meta_access_token, meta_phone_number_id, meta_waba_id')
        .eq('conta_id', conta.id)
        .maybeSingle(),
      sb.from('email_remetente').select('local_part, from_name').eq('conta_id', conta.id).maybeSingle(),
    ])

    setData({ cfg, rem, domain: plat?.dominio_email_operador ?? null })
    setLocalPart(rem?.local_part ?? '')
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])
  useEffect(() => { if (stateGeral.success) loadData() }, [stateGeral.success])
  useEffect(() => { if (stateMeta.success)  loadData() }, [stateMeta.success])

  const previewEmail = data?.domain && localPart
    ? `${sanitizarLocalPart(localPart)}@${data.domain}`
    : null

  const metaConfigurado = !!(data?.cfg?.meta_access_token && data?.cfg?.meta_phone_number_id && data?.cfg?.meta_waba_id)

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

      {/* ── WhatsApp Business API (Meta) ────────────────────────────────────── */}
      <form action={formActionMeta} className="space-y-6">
        <section className="rounded-2xl border border-border bg-card p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">WhatsApp Business API</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                API oficial Meta Cloud — envio, recebimento e templates aprovados.
              </p>
            </div>
            {metaConfigurado ? (
              <span className="flex items-center gap-1 rounded-full bg-green-500/15 px-2.5 py-1 text-[11px] font-medium text-green-500">
                <CheckCircle className="h-3 w-3" />
                Configurado
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                Não configurado
              </span>
            )}
          </div>

          {/* Guia de onde encontrar as credenciais */}
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Como obter as credenciais:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Acesse <strong>developers.facebook.com</strong> → seu app → WhatsApp → Configuração</li>
              <li><strong>Phone Number ID</strong>: aparece na seção "Números de telefone"</li>
              <li><strong>WABA ID</strong>: aparece logo abaixo do Phone Number ID</li>
              <li><strong>Access Token</strong>: gere um token permanente via "System Users" no Meta Business</li>
            </ol>
            <p className="pt-1">
              URL do webhook para configurar na Meta:{' '}
              <span className="font-mono text-foreground">
                {typeof window !== 'undefined' ? window.location.origin : 'https://seu-dominio.com'}/api/webhooks/whatsapp
              </span>
            </p>
            <p>
              Token de verificação do webhook:{' '}
              <span className="font-mono text-foreground">WHATSAPP_VERIFY_TOKEN</span>{' '}
              (variável de ambiente na Vercel)
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className={LABEL}>Phone Number ID</label>
              <input
                name="meta_phone_number_id"
                defaultValue={data?.cfg?.meta_phone_number_id ?? ''}
                placeholder="123456789012345"
                className={INPUT}
              />
              <p className="text-[10px] text-muted-foreground">ID numérico do seu número no painel Meta Developers</p>
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>WABA ID (WhatsApp Business Account ID)</label>
              <input
                name="meta_waba_id"
                defaultValue={data?.cfg?.meta_waba_id ?? ''}
                placeholder="987654321098765"
                className={INPUT}
              />
              <p className="text-[10px] text-muted-foreground">ID da sua conta WhatsApp Business</p>
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Access Token (Permanente)</label>
              <div className="relative">
                <input
                  name="meta_access_token"
                  type={showToken ? 'text' : 'password'}
                  defaultValue={data?.cfg?.meta_access_token ?? ''}
                  placeholder="EAAxxxxxxxxxx…"
                  className={INPUT + ' pr-10'}
                />
                <button
                  type="button"
                  onClick={() => setShowToken(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">Token de sistema permanente — não usa tokens de usuário que expiram</p>
            </div>
          </div>
        </section>

        {stateMeta.error && (
          <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{stateMeta.error}</p>
        )}
        {stateMeta.success && (
          <p className="flex items-center gap-2 rounded-xl bg-success-bg px-3 py-2 text-sm text-success">
            <CheckCircle className="h-4 w-4" />
            Credenciais Meta salvas.
          </p>
        )}

        <button
          type="submit" disabled={isPendingMeta}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {isPendingMeta && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPendingMeta ? 'Salvando…' : 'Salvar credenciais Meta'}
        </button>
      </form>
    </div>
  )
}
