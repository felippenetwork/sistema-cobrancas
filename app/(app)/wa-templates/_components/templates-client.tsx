'use client'

import { useState, useActionState } from 'react'
import { FileText, Plus, Send, Trash2, XCircle, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import { criarModeloAction, submeterAprovacaoAction, excluirModeloAction } from '../_actions'

type Modelo = {
  id: string
  nome: string
  categoria: string
  idioma: string
  corpo: string
  cabecalho: string | null
  rodape: string | null
  status: string
  meta_template_id: string | null
  criado_em: string
  atualizado_em: string
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  rascunho:   { label: 'Rascunho',   icon: <Clock className="h-3 w-3" />,        cls: 'bg-muted text-muted-foreground' },
  em_analise: { label: 'Em análise', icon: <Clock className="h-3 w-3" />,        cls: 'bg-amber-500/15 text-amber-500' },
  aprovado:   { label: 'Aprovado',   icon: <CheckCircle className="h-3 w-3" />,  cls: 'bg-green-500/15 text-green-500' },
  rejeitado:  { label: 'Rejeitado',  icon: <AlertCircle className="h-3 w-3" />, cls: 'bg-destructive/15 text-destructive' },
}

const CAT_LABEL: Record<string, string> = {
  UTILITY:        'Utilidade',
  MARKETING:      'Marketing',
  AUTHENTICATION: 'Autenticação',
}

// ── Sheet base ────────────────────────────────────────────────────────────────

function Sheet({
  titulo,
  onFechar,
  children,
  wide,
}: {
  titulo: string
  onFechar: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 md:items-center md:justify-center md:p-4"
      onClick={e => e.target === e.currentTarget && onFechar()}
    >
      <div className={[
        'w-full rounded-t-2xl border border-border bg-card shadow-2xl md:rounded-xl',
        wide ? 'md:max-w-lg' : 'md:max-w-sm',
      ].join(' ')}>
        <div className="flex justify-center pt-3 md:hidden">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
          <button onClick={onFechar} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Modal de criação ──────────────────────────────────────────────────────────

function ModalNovoTemplate({ onFechar }: { onFechar: () => void }) {
  const [state, action, pending] = useActionState(criarModeloAction, { error: null })
  const [corpo, setCorpo]         = useState('')

  const vars = [...new Set([...corpo.matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1]))]

  return (
    <Sheet titulo="Novo Template" onFechar={onFechar} wide>
      <form action={action} className="max-h-[80dvh] overflow-y-auto">
        <div className="space-y-4 p-5">
          {state.error && (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{state.error}</p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome do template</label>
              <input
                name="nome"
                required
                placeholder="lembrete_pagamento"
                className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Apenas letras, números e _</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Categoria</label>
              <select
                name="categoria"
                defaultValue="UTILITY"
                className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="UTILITY">Utilidade (~R$ 0,06)</option>
                <option value="MARKETING">Marketing (~R$ 0,12)</option>
                <option value="AUTHENTICATION">Autenticação (~R$ 0,04)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Cabeçalho (opcional)</label>
            <input
              name="cabecalho"
              placeholder="Título da mensagem"
              className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Corpo da mensagem
              <span className="ml-1 font-normal text-muted-foreground/70">— {'{{1}}'}, {'{{2}}'} para variáveis</span>
            </label>
            <textarea
              name="corpo"
              required
              rows={4}
              value={corpo}
              onChange={e => setCorpo(e.target.value)}
              placeholder={'Olá, {{1}}! Sua fatura de R$ {{2}} vence em {{3}} dias.'}
              className="w-full resize-none rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
            />
            {vars.length > 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Variáveis: {vars.map(v => `{{${v}}}`).join(', ')}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Rodapé (opcional)</label>
            <input
              name="rodape"
              placeholder="Não responder a este número."
              className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
        </div>

        <div
          className="flex gap-3 border-t border-border px-5 py-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            type="button"
            onClick={onFechar}
            className="flex-1 rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground transition hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending}
            className="flex-1 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Criando…' : 'Criar Template'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

// ── Modal de visualização ─────────────────────────────────────────────────────

function ModalVerTemplate({ modelo, onFechar }: { modelo: Modelo; onFechar: () => void }) {
  const [atualizando, setAtualizando] = useState(false)

  async function handleSubmeter() {
    setAtualizando(true)
    const r = await submeterAprovacaoAction(modelo.id)
    setAtualizando(false)
    if (!r.error) onFechar()
  }

  async function handleExcluir() {
    if (!confirm('Excluir este template?')) return
    await excluirModeloAction(modelo.id)
    onFechar()
  }

  const st = STATUS_CONFIG[modelo.status] ?? STATUS_CONFIG.rascunho

  return (
    <Sheet titulo={modelo.nome} onFechar={onFechar} wide>
      <div className="max-h-[70dvh] overflow-y-auto">
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium ${st.cls}`}>
              {st.icon}{st.label}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">Categoria</p>
              <p className="font-medium text-foreground">{CAT_LABEL[modelo.categoria] ?? modelo.categoria}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Idioma</p>
              <p className="font-medium text-foreground">{modelo.idioma}</p>
            </div>
          </div>

          {modelo.cabecalho && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Cabeçalho</p>
              <p className="rounded-xl bg-muted px-3 py-2.5 text-sm text-foreground">{modelo.cabecalho}</p>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs text-muted-foreground">Corpo</p>
            <pre className="whitespace-pre-wrap rounded-xl bg-muted px-3 py-2.5 text-sm font-sans text-foreground">
              {modelo.corpo}
            </pre>
          </div>

          {modelo.rodape && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Rodapé</p>
              <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">{modelo.rodape}</p>
            </div>
          )}
        </div>
      </div>

      <div
        className="flex gap-2 border-t border-border px-5 py-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
      >
        {modelo.status === 'rascunho' && (
          <>
            <button
              onClick={handleExcluir}
              className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-3 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </button>
            <button
              onClick={handleSubmeter}
              disabled={atualizando}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-3 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {atualizando ? 'Submetendo…' : 'Submeter para Meta'}
            </button>
          </>
        )}
        {modelo.status !== 'rascunho' && (
          <button
            onClick={onFechar}
            className="flex-1 rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground transition hover:bg-accent"
          >
            Fechar
          </button>
        )}
      </div>
    </Sheet>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export function TemplatesClient({ modelos, metaConfigurada }: { modelos: Modelo[]; metaConfigurada: boolean }) {
  const [modalNovo, setModalNovo] = useState(false)
  const [modeloVer, setModeloVer] = useState<Modelo | null>(null)

  return (
    <>
      {modalNovo && <ModalNovoTemplate onFechar={() => setModalNovo(false)} />}
      {modeloVer && <ModalVerTemplate modelo={modeloVer} onFechar={() => setModeloVer(null)} />}

      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold text-foreground">Templates WhatsApp</h1>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Templates precisam ser aprovados pela Meta antes do uso.
            </p>
          </div>
          <button
            onClick={() => setModalNovo(true)}
            className="shrink-0 flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 active:opacity-80"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo template</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </div>

        {/* Aviso — só aparece quando Meta não está configurada */}
        {!metaConfigurada && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3.5">
            <p className="text-sm text-amber-600 dark:text-amber-400">
              <strong>API Meta não configurada.</strong>{' '}
              <a href="/configuracoes" className="underline underline-offset-2 hover:opacity-80">
                Configure em Configurações → WhatsApp Business API.
              </a>
            </p>
          </div>
        )}

        {/* Lista */}
        {modelos.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-14 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Nenhum template criado ainda.</p>
            <button
              onClick={() => setModalNovo(true)}
              className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Criar primeiro template
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {modelos.map(m => {
              const st = STATUS_CONFIG[m.status] ?? STATUS_CONFIG.rascunho
              return (
                <button
                  key={m.id}
                  onClick={() => setModeloVer(m)}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-left transition hover:border-primary/50 hover:bg-accent/30 active:bg-accent/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{m.nome}</p>
                      <p className="text-[11px] text-muted-foreground">{CAT_LABEL[m.categoria] ?? m.categoria}</p>
                    </div>
                    <span className={`shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${st.cls}`}>
                      {st.icon}
                      {st.label}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{m.corpo}</p>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
