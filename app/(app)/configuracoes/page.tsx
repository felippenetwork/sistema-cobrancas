'use client'

import { useActionState, useState, useEffect } from 'react'
import { Loader2, CheckCircle, Eye, EyeOff, ExternalLink } from 'lucide-react'
import { salvarConfiguracoesAction, salvarMetaApiAction, salvarTwilioAction, toggleMetaApiAction, toggleTwilioAction } from './_actions/configuracoes'
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
    meta_api_ativo?: boolean | null
    meta_phone_number_id?: string | null
    meta_waba_id?: string | null
    twilio_account_sid?: string | null
    twilio_ativo?: boolean | null
    twilio_auth_token?: string | null
    twilio_from_number?: string | null
  } | null
  rem:    { local_part?: string | null; from_name?: string | null } | null
  domain: string | null
}

export const dynamic = 'force-dynamic'

export default function ConfiguracoesPage() {
  const [stateGeral,  formActionGeral,  isPendingGeral]  = useActionState(salvarConfiguracoesAction, { error: null })
  const [stateMeta,   formActionMeta,   isPendingMeta]   = useActionState(salvarMetaApiAction,       { error: null })
  const [stateTwilio,      formActionTwilio,      isPendingTwilio]      = useActionState(salvarTwilioAction,    { error: null })
  const [stateToggleMeta,   formActionToggleMeta]   = useActionState(toggleMetaApiAction, { error: null })
  const [stateToggleTwilio, formActionToggleTwilio] = useActionState(toggleTwilioAction,  { error: null })

  const [data, setData]                   = useState<Data | null>(null)
  const [localPart, setLocalPart]         = useState('')
  const [loading, setLoading]             = useState(true)
  const [showToken, setShowToken]         = useState(false)
  const [showTwilioToken, setShowTwilioToken] = useState(false)

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
        .select('contato, cpf_cnpj, endereco, nome_comercial, meta_access_token, meta_api_ativo, meta_phone_number_id, meta_waba_id, twilio_account_sid, twilio_ativo, twilio_auth_token, twilio_from_number')
        .eq('conta_id', conta.id)
        .maybeSingle(),
      sb.from('email_remetente').select('local_part, from_name').eq('conta_id', conta.id).maybeSingle(),
    ])

    setData({ cfg, rem, domain: plat?.dominio_email_operador ?? null })
    setLocalPart(rem?.local_part ?? '')
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])
  useEffect(() => { if (stateGeral.success)        loadData() }, [stateGeral.success])
  useEffect(() => { if (stateMeta.success)         loadData() }, [stateMeta.success])
  useEffect(() => { if (stateTwilio.success)       loadData() }, [stateTwilio.success])
  useEffect(() => { if (stateToggleMeta.success)   loadData() }, [stateToggleMeta.success])
  useEffect(() => { if (stateToggleTwilio.success) loadData() }, [stateToggleTwilio.success])

  const previewEmail = data?.domain && localPart
    ? `${sanitizarLocalPart(localPart)}@${data.domain}`
    : null

  const metaConfigurado   = !!(data?.cfg?.meta_access_token && data?.cfg?.meta_phone_number_id && data?.cfg?.meta_waba_id)
  const twilioConfigurado = !!(data?.cfg?.twilio_account_sid && data?.cfg?.twilio_auth_token && data?.cfg?.twilio_from_number)
  const metaAtivo         = data?.cfg?.meta_api_ativo !== false
  const twilioAtivo       = data?.cfg?.twilio_ativo !== false

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
            <div className="flex items-center gap-2 flex-shrink-0">
              {metaConfigurado && (
                <form action={formActionToggleMeta}>
                  <input type="hidden" name="ativo" value={metaAtivo ? 'false' : 'true'} />
                  <button type="submit" title={metaAtivo ? 'Desativar' : 'Ativar'}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${metaAtivo ? 'bg-green-500' : 'bg-muted'}`}>
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${metaAtivo ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </button>
                </form>
              )}
              {metaConfigurado ? (
                <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${metaAtivo ? 'bg-green-500/15 text-green-500' : 'bg-muted text-muted-foreground'}`}>
                  <CheckCircle className="h-3 w-3" />
                  {metaAtivo ? 'Ativo' : 'Desativado'}
                </span>
              ) : (
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  Não configurado
                </span>
              )}
            </div>
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

      {/* ── Twilio WhatsApp (Sandbox / Produção) ────────────────────────────── */}
      <form action={formActionTwilio} className="space-y-6">
        <section className="rounded-2xl border border-border bg-card p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Twilio WhatsApp</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Alternativa à Meta API — sandbox para testes ou número próprio em produção.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {twilioConfigurado && (
                <form action={formActionToggleTwilio}>
                  <input type="hidden" name="ativo" value={twilioAtivo ? 'false' : 'true'} />
                  <button type="submit" title={twilioAtivo ? 'Desativar' : 'Ativar'}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${twilioAtivo ? 'bg-green-500' : 'bg-muted'}`}>
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${twilioAtivo ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </button>
                </form>
              )}
              {twilioConfigurado ? (
                <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${twilioAtivo ? 'bg-green-500/15 text-green-500' : 'bg-muted text-muted-foreground'}`}>
                  <CheckCircle className="h-3 w-3" />
                  {twilioAtivo ? 'Ativo' : 'Desativado'}
                </span>
              ) : (
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  Não configurado
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Sandbox (teste):</p>
            <p>From Number: <span className="font-mono text-foreground">whatsapp:+14155238886</span></p>
            <p className="pt-1 font-medium text-foreground">Webhook Twilio (configurar em Sandbox Settings):</p>
            <p className="font-mono text-foreground break-all">
              {typeof window !== 'undefined' ? window.location.origin : 'https://seu-dominio.com'}/api/webhooks/whatsapp
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className={LABEL}>Account SID</label>
              <input
                name="twilio_account_sid"
                defaultValue={data?.cfg?.twilio_account_sid ?? ''}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className={INPUT}
              />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Auth Token</label>
              <div className="relative">
                <input
                  name="twilio_auth_token"
                  type={showTwilioToken ? 'text' : 'password'}
                  defaultValue={data?.cfg?.twilio_auth_token ?? ''}
                  placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className={INPUT + ' pr-10'}
                />
                <button
                  type="button"
                  onClick={() => setShowTwilioToken(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showTwilioToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>From Number</label>
              <input
                name="twilio_from_number"
                defaultValue={data?.cfg?.twilio_from_number ?? ''}
                placeholder="whatsapp:+14155238886"
                className={INPUT}
              />
              <p className="text-[10px] text-muted-foreground">Sandbox: whatsapp:+14155238886 — produção: whatsapp:+seu-numero-twilio</p>
            </div>
          </div>
        </section>

        {stateTwilio.error && (
          <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{stateTwilio.error}</p>
        )}
        {stateTwilio.success && (
          <p className="flex items-center gap-2 rounded-xl bg-success-bg px-3 py-2 text-sm text-success">
            <CheckCircle className="h-4 w-4" />
            Credenciais Twilio salvas.
          </p>
        )}

        <button
          type="submit" disabled={isPendingTwilio}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {isPendingTwilio && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPendingTwilio ? 'Salvando…' : 'Salvar credenciais Twilio'}
        </button>
      </form>
    </div>
  )
}
