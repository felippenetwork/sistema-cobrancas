'use client'

import { useActionState, useState, useEffect, useTransition, useRef } from 'react'
import { Loader2, CheckCircle, Eye, EyeOff, ExternalLink } from 'lucide-react'
import { salvarConfiguracoesAction, salvarMetaApiAction, salvarTwilioAction, salvarLookDefenseAction, toggleMetaApiAction, toggleTwilioAction, salvarEfiBankAction } from './_actions/configuracoes'
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
    ld_username?: string | null
    ld_password?: string | null
    efi_client_id?:     string | null
    efi_client_secret?: string | null
    efi_pix_key?:       string | null
    efi_cert_base64?:   string | null
    efi_sandbox?:       boolean | null
  } | null
  rem:    { local_part?: string | null; from_name?: string | null } | null
  domain: string | null
}

export const dynamic = 'force-dynamic'

export default function ConfiguracoesPage() {
  const [stateGeral,  formActionGeral,  isPendingGeral]  = useActionState(salvarConfiguracoesAction, { error: null })
  const [stateMeta,   formActionMeta,   isPendingMeta]   = useActionState(salvarMetaApiAction,       { error: null })
  const [stateTwilio,      formActionTwilio,      isPendingTwilio]      = useActionState(salvarTwilioAction,    { error: null })
  const [stateLookDefense, formActionLookDefense, isPendingLookDefense] = useActionState(salvarLookDefenseAction, { error: null })
  const [stateEfi,         formActionEfi,         isPendingEfi]         = useActionState(salvarEfiBankAction,    { error: null })
  const [, startToggleMeta]   = useTransition()
  const [, startToggleTwilio] = useTransition()

  const [data, setData]                   = useState<Data | null>(null)
  const [localPart, setLocalPart]         = useState('')
  const [loading, setLoading]             = useState(true)
  const [showToken, setShowToken]         = useState(false)
  const [showTwilioToken, setShowTwilioToken] = useState(false)
  const [showLdPassword, setShowLdPassword]   = useState(false)
  const [showEfiSecret, setShowEfiSecret]     = useState(false)
  const [efiSandbox, setEfiSandbox]           = useState(false)
  const [overrideMetaAtivo, setOverrideMetaAtivo]     = useState<boolean | null>(null)
  const [overrideTwilioAtivo, setOverrideTwilioAtivo] = useState<boolean | null>(null)
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
      (sb.from('configuracoes') as any)
        .select('contato, cpf_cnpj, endereco, nome_comercial, meta_access_token, meta_api_ativo, meta_phone_number_id, meta_waba_id, twilio_account_sid, twilio_ativo, twilio_auth_token, twilio_from_number, ld_username, ld_password, efi_client_id, efi_client_secret, efi_pix_key, efi_cert_base64, efi_sandbox')
        .eq('conta_id', conta.id)
        .maybeSingle(),
      sb.from('email_remetente').select('local_part, from_name').eq('conta_id', conta.id).maybeSingle(),
    ])

    const cfg = cfgRaw as Data['cfg']
    setData({ cfg, rem, domain: plat?.dominio_email_operador ?? null })
    setLocalPart(rem?.local_part ?? '')
    setEfiSandbox(!!(cfg as any)?.efi_sandbox)
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
  useEffect(() => { if (stateMeta.success)   loadData(true) }, [stateMeta.success])
  useEffect(() => { if (stateTwilio.success)      loadData(true) }, [stateTwilio.success])
  useEffect(() => { if (stateLookDefense.success) loadData(true) }, [stateLookDefense.success])
  useEffect(() => { if (stateEfi.success)         loadData(true) }, [stateEfi.success])

  const previewEmail = data?.domain && localPart
    ? `${sanitizarLocalPart(localPart)}@${data.domain}`
    : null

  const metaConfigurado   = !!(data?.cfg?.meta_access_token && data?.cfg?.meta_phone_number_id && data?.cfg?.meta_waba_id)
  const twilioConfigurado = !!(data?.cfg?.twilio_account_sid && data?.cfg?.twilio_auth_token && data?.cfg?.twilio_from_number)
  const metaAtivo         = overrideMetaAtivo   !== null ? overrideMetaAtivo   : (data?.cfg?.meta_api_ativo !== false)
  const twilioAtivo       = overrideTwilioAtivo !== null ? overrideTwilioAtivo : (data?.cfg?.twilio_ativo   !== false)

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
                <button
                  type="button"
                  title={metaAtivo ? 'Desativar' : 'Ativar'}
                  onClick={() => {
                    const novo = !metaAtivo
                    setOverrideMetaAtivo(novo)
                    startToggleMeta(async () => {
                      const fd = new FormData()
                      fd.append('ativo', String(novo))
                      await toggleMetaApiAction({ error: null }, fd)
                      await loadData(true)
                      setOverrideMetaAtivo(null)
                    })
                  }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${metaAtivo ? 'bg-green-500' : 'bg-muted'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${metaAtivo ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                </button>
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
                <button
                  type="button"
                  title={twilioAtivo ? 'Desativar' : 'Ativar'}
                  onClick={() => {
                    const novo = !twilioAtivo
                    setOverrideTwilioAtivo(novo)
                    startToggleTwilio(async () => {
                      const fd = new FormData()
                      fd.append('ativo', String(novo))
                      await toggleTwilioAction({ error: null }, fd)
                      await loadData(true)
                      setOverrideTwilioAtivo(null)
                    })
                  }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${twilioAtivo ? 'bg-green-500' : 'bg-muted'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${twilioAtivo ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                </button>
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

      {/* ── LookDefense IPTV ────────────────────────────────────────────────── */}
      <form action={formActionLookDefense} className="space-y-6">
        <section className="rounded-2xl border border-border bg-card p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">LookDefense IPTV</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Renovação automática de planos IPTV ao baixar parcelas de clientes vinculados.
              </p>
            </div>
            {(data?.cfg?.ld_username && data?.cfg?.ld_password) ? (
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

          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Como funciona:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Informe o login e senha da sua conta revendedor no painel LookDefense</li>
              <li>No cadastro de cada cliente IPTV, preencha o campo <strong>Login externo</strong> com o username dele no painel</li>
              <li>Ao baixar uma parcela, o sistema agenda a renovação automaticamente</li>
            </ol>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className={LABEL}>Usuário (login do revendedor)</label>
              <input
                name="ld_username"
                defaultValue={data?.cfg?.ld_username ?? ''}
                placeholder="seu.usuario"
                autoComplete="off"
                className={INPUT}
              />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Senha</label>
              <div className="relative">
                <input
                  name="ld_password"
                  type={showLdPassword ? 'text' : 'password'}
                  defaultValue={data?.cfg?.ld_password ?? ''}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className={INPUT + ' pr-10'}
                />
                <button
                  type="button"
                  onClick={() => setShowLdPassword(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showLdPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </section>

        {stateLookDefense.error && (
          <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{stateLookDefense.error}</p>
        )}
        {stateLookDefense.success && (
          <p className="flex items-center gap-2 rounded-xl bg-success-bg px-3 py-2 text-sm text-success">
            <CheckCircle className="h-4 w-4" />
            Credenciais LookDefense salvas.
          </p>
        )}

        <button
          type="submit" disabled={isPendingLookDefense}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {isPendingLookDefense && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPendingLookDefense ? 'Salvando…' : 'Salvar credenciais LookDefense'}
        </button>
      </form>

      {/* ── EfiBanK PIX ─────────────────────────────────────────────────────── */}
      <form action={formActionEfi} className="space-y-6">
        <section className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">EfiBanK PIX</h2>

          <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Como configurar:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Acesse <strong>developers.efipay.com.br</strong> → Aplicações → Nova Aplicação → marque <strong>API Pix</strong></li>
              <li>Copie o <strong>Client ID</strong> e o <strong>Client Secret</strong></li>
              <li>Baixe o certificado <strong>.p12</strong> em Meus Certificados</li>
              <li>Converta para Base64: <code className="bg-muted px-1 rounded">base64 -i certificado.p12</code> (Mac/Linux) ou use um conversor online</li>
              <li>Informe sua chave PIX (CPF/CNPJ, telefone, e-mail ou chave aleatória)</li>
              <li>Configure o webhook na EfiBanK: URL → <code className="bg-muted px-1 rounded">https://www.cobranx.site/api/webhooks/efibank?token=SEU_CRON_SECRET</code></li>
            </ol>
          </div>

          <div className="space-y-4">
            {/* Ambiente */}
            <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Ambiente sandbox (homologação)</p>
                <p className="text-xs text-muted-foreground">Ative apenas para testes. Desative em produção.</p>
              </div>
              <button
                type="button"
                onClick={() => setEfiSandbox(v => !v)}
                className={[
                  'relative h-6 w-11 rounded-full transition-colors focus:outline-none',
                  efiSandbox ? 'bg-amber-500' : 'bg-muted',
                ].join(' ')}
              >
                <span className={['absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', efiSandbox ? 'translate-x-5' : 'translate-x-0.5'].join(' ')} />
              </button>
              <input type="hidden" name="efi_sandbox" value={String(efiSandbox)} />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Client ID</label>
              <input
                name="efi_client_id"
                defaultValue={data?.cfg?.efi_client_id ?? ''}
                placeholder="Client_Id_..."
                autoComplete="off"
                className={INPUT}
              />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Client Secret</label>
              <div className="relative">
                <input
                  name="efi_client_secret"
                  type={showEfiSecret ? 'text' : 'password'}
                  defaultValue={data?.cfg?.efi_client_secret ?? ''}
                  placeholder="Client_Secret_..."
                  autoComplete="new-password"
                  className={INPUT + ' pr-10'}
                />
                <button type="button" onClick={() => setShowEfiSecret(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showEfiSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Chave PIX (recebimento)</label>
              <input
                name="efi_pix_key"
                defaultValue={data?.cfg?.efi_pix_key ?? ''}
                placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                className={INPUT}
              />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Certificado .p12 em Base64</label>
              <textarea
                name="efi_cert_base64"
                defaultValue={data?.cfg?.efi_cert_base64 ?? ''}
                placeholder="Cole aqui o conteúdo base64 do arquivo .p12..."
                rows={4}
                className={INPUT + ' resize-none font-mono text-xs'}
              />
              <p className="text-xs text-muted-foreground">
                {data?.cfg?.efi_cert_base64 ? '✓ Certificado salvo.' : 'Nenhum certificado salvo.'}
              </p>
            </div>
          </div>
        </section>

        {stateEfi.error && (
          <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{stateEfi.error}</p>
        )}
        {stateEfi.success && (
          <p className="flex items-center gap-2 rounded-xl bg-success-bg px-3 py-2 text-sm text-success">
            <CheckCircle className="h-4 w-4" />
            Credenciais EfiBanK salvas.
          </p>
        )}

        <button
          type="submit" disabled={isPendingEfi}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {isPendingEfi && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPendingEfi ? 'Salvando…' : 'Salvar credenciais EfiBanK'}
        </button>
      </form>
    </div>
  )
}
