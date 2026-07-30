'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FileText, RefreshCw, ExternalLink, CheckCircle,
  Clock, AlertCircle, XCircle, AlertTriangle, Info,
} from 'lucide-react'

type MetaTemplate = {
  id: string
  name: string
  status: string
  category: string
  language: string
  body: string
}

const STATUS_CFG: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  APPROVED:   { label: 'Aprovado',    icon: <CheckCircle  className="h-3 w-3" />, cls: 'bg-green-500/15 text-green-600 dark:text-green-400' },
  PENDING:    { label: 'Em análise',  icon: <Clock        className="h-3 w-3" />, cls: 'bg-amber-500/15  text-amber-600  dark:text-amber-400'  },
  REJECTED:   { label: 'Rejeitado',   icon: <XCircle      className="h-3 w-3" />, cls: 'bg-red-500/15    text-red-600    dark:text-red-400'    },
  PAUSED:     { label: 'Pausado',     icon: <AlertCircle  className="h-3 w-3" />, cls: 'bg-muted         text-muted-foreground'                 },
  DISABLED:   { label: 'Desativado',  icon: <AlertCircle  className="h-3 w-3" />, cls: 'bg-muted         text-muted-foreground'                 },
  IN_APPEAL:  { label: 'Em recurso',  icon: <Clock        className="h-3 w-3" />, cls: 'bg-amber-500/15  text-amber-600  dark:text-amber-400'  },
  DRAFT:      { label: 'Rascunho',    icon: <Clock        className="h-3 w-3" />, cls: 'bg-muted         text-muted-foreground'                 },
}

const CAT_CFG: Record<string, { label: string; cls: string }> = {
  UTILITY:        { label: 'Utilidade',   cls: 'bg-blue-500/15   text-blue-600   dark:text-blue-400'   },
  MARKETING:      { label: 'Marketing',   cls: 'bg-orange-500/15 text-orange-600 dark:text-orange-400' },
  AUTHENTICATION: { label: 'Auth',        cls: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' },
}

const LANG_LABEL: Record<string, string> = {
  'pt_BR': 'PT-BR',
  'en_US': 'EN-US',
  'es':    'ES',
}

const STATUS_FILTERS = ['Todos', 'APPROVED', 'PENDING', 'REJECTED'] as const

function ModalDetalhes({ t, onFechar }: { t: MetaTemplate; onFechar: () => void }) {
  const st  = STATUS_CFG[t.status]  ?? STATUS_CFG.PENDING
  const cat = CAT_CFG[t.category]   ?? { label: t.category, cls: 'bg-muted text-muted-foreground' }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 md:items-center md:justify-center md:p-4"
      onClick={e => e.target === e.currentTarget && onFechar()}
    >
      <div className="w-full rounded-t-2xl border border-border bg-card shadow-2xl md:max-w-md md:rounded-xl">
        <div className="flex justify-center pt-3 md:hidden">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground truncate pr-2">{t.name}</h2>
          <button onClick={onFechar} className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-foreground">
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60dvh] overflow-y-auto p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium ${st.cls}`}>
              {st.icon}{st.label}
            </span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium ${cat.cls}`}>
              {cat.label}
            </span>
            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
              {LANG_LABEL[t.language] ?? t.language}
            </span>
          </div>

          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Corpo da mensagem</p>
            <pre className="whitespace-pre-wrap rounded-xl bg-muted px-3 py-3 text-sm font-sans text-foreground leading-relaxed">
              {t.body || '(sem corpo)'}
            </pre>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">ID do template</p>
              <p className="font-mono text-[11px] text-foreground break-all mt-0.5">{t.id}</p>
            </div>
          </div>
        </div>

        <div
          className="border-t border-border px-5 py-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            onClick={onFechar}
            className="w-full rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground transition hover:bg-accent"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

export function TemplatesClient({
  metaConfigurada,
  temWabaId,
  temToken,
}: {
  metaConfigurada: boolean
  temWabaId: boolean
  temToken: boolean
}) {
  const [templates,     setTemplates]     = useState<MetaTemplate[]>([])
  const [carregando,    setCarregando]    = useState(false)
  const [erro,          setErro]          = useState<string | null>(null)
  const [erroCode,      setErroCode]      = useState<string | null>(null)
  const [atualizadoEm,  setAtualizadoEm]  = useState<Date | null>(null)
  const [filtro,        setFiltro]        = useState<string>('Todos')
  const [detalhes,      setDetalhes]      = useState<MetaTemplate | null>(null)

  const buscar = useCallback(async () => {
    if (!metaConfigurada) return
    setCarregando(true)
    setErro(null)
    setErroCode(null)
    try {
      const res = await fetch('/api/meta/templates', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) {
        setErro(json.error ?? 'Erro ao buscar templates.')
        setErroCode(json.code ?? null)
        setTemplates([])
      } else {
        setTemplates(json.templates ?? [])
        setAtualizadoEm(new Date())
      }
    } catch {
      setErro('Erro de rede ao buscar templates da Meta.')
    } finally {
      setCarregando(false)
    }
  }, [metaConfigurada])

  useEffect(() => { buscar() }, [buscar])

  const lista = filtro === 'Todos'
    ? templates
    : templates.filter(t => t.status === filtro)

  const contagens = STATUS_FILTERS.reduce<Record<string, number>>((acc, f) => {
    acc[f] = f === 'Todos' ? templates.length : templates.filter(t => t.status === f).length
    return acc
  }, {})

  return (
    <>
      {detalhes && <ModalDetalhes t={detalhes} onFechar={() => setDetalhes(null)} />}

      <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold text-foreground">Templates WhatsApp</h1>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Templates aprovados na Meta Business API.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={buscar}
              disabled={carregando || !metaConfigurada}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-accent disabled:opacity-40"
              title="Atualizar templates da Meta"
            >
              <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Atualizar</span>
            </button>

            <a
              href="https://business.facebook.com/wa/manage/message-templates/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              <ExternalLink className="h-4 w-4" />
              <span className="hidden sm:inline">Meta Manager</span>
              <span className="sm:hidden">Meta</span>
            </a>
          </div>
        </div>

        {/* Aviso: Meta não configurada */}
        {!metaConfigurada && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="space-y-1 text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  {!temToken ? 'Access Token não configurado.' : !temWabaId ? 'WABA ID não configurado.' : 'Meta API desativada.'}
                </p>
                <p className="text-amber-600/80 dark:text-amber-400/70 text-xs">
                  {!temWabaId
                    ? 'Acesse Configurações → WhatsApp Business API e preencha o campo "WABA ID". Este é o ID da sua conta WhatsApp Business, diferente do Phone Number ID.'
                    : 'Acesse Configurações → WhatsApp Business API para ativar.'}
                </p>
                <a href="/configuracoes" className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 underline underline-offset-2 hover:opacity-80 dark:text-amber-400 mt-1">
                  Ir para Configurações
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Erro da API */}
        {erro && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-destructive">Erro ao carregar templates</p>
                <p className="text-xs text-destructive/80">{erro}</p>
                {(erroCode === 'WABA_ID_MISSING' || erroCode === 'WABA_ID_INVALID') && (
                  <div className="mt-2 rounded-xl bg-destructive/5 p-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      Como encontrar o WABA ID:
                    </p>
                    <ol className="list-decimal list-inside space-y-0.5 ml-1">
                      <li>Acesse <strong>business.facebook.com</strong></li>
                      <li>Vá em <strong>Configurações</strong> → <strong>Contas do WhatsApp Business</strong></li>
                      <li>Clique na sua conta → copie o <strong>ID da conta</strong> (não o ID do número)</li>
                    </ol>
                    <a href="/configuracoes" className="mt-1 inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2">
                      Corrigir em Configurações
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Carregando */}
        {carregando && !erro && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Buscando templates na Meta…
          </div>
        )}

        {/* Lista */}
        {!carregando && !erro && metaConfigurada && (
          <>
            {/* Filtros + timestamp */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1.5 flex-wrap">
                {STATUS_FILTERS.map(f => (
                  <button
                    key={f}
                    onClick={() => setFiltro(f)}
                    className={[
                      'rounded-lg px-3 py-1.5 text-xs font-medium transition',
                      filtro === f
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80',
                    ].join(' ')}
                  >
                    {f === 'Todos' ? 'Todos' : (STATUS_CFG[f]?.label ?? f)}
                    {contagens[f] > 0 && (
                      <span className="ml-1 opacity-70">({contagens[f]})</span>
                    )}
                  </button>
                ))}
              </div>
              {atualizadoEm && (
                <p className="text-[11px] text-muted-foreground">
                  Atualizado às {atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>

            {lista.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-14 text-center">
                <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  {templates.length === 0
                    ? 'Nenhum template encontrado na Meta.'
                    : `Nenhum template com status "${STATUS_CFG[filtro]?.label ?? filtro}".`}
                </p>
                {templates.length === 0 && (
                  <a
                    href="https://business.facebook.com/wa/manage/message-templates/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Criar no Meta Manager
                  </a>
                )}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {lista.map(t => {
                  const st  = STATUS_CFG[t.status]  ?? { label: t.status, icon: null, cls: 'bg-muted text-muted-foreground' }
                  const cat = CAT_CFG[t.category]   ?? { label: t.category, cls: 'bg-muted text-muted-foreground' }
                  return (
                    <button
                      key={t.id}
                      onClick={() => setDetalhes(t)}
                      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-left transition hover:border-primary/50 hover:bg-accent/30 active:bg-accent/60"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                        <span className={`shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${st.cls}`}>
                          {st.icon}{st.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cat.cls}`}>
                          {cat.label}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {LANG_LABEL[t.language] ?? t.language}
                        </span>
                      </div>

                      {t.body && (
                        <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">{t.body}</p>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
