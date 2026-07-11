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

// ── Modal de criação ──────────────────────────────────────────────────────────

function ModalNovoTemplate({ onFechar }: { onFechar: () => void }) {
  const [state, action, pending] = useActionState(criarModeloAction, { error: null })
  const [corpo, setCorpo]         = useState('')

  // Conta variáveis detectadas
  const vars = [...new Set([...corpo.matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1]))]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Novo Template</h2>
          <button onClick={onFechar} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
        <form action={action} className="space-y-4 p-5 max-h-[80vh] overflow-y-auto">
          {state.error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{state.error}</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome do template</label>
              <input
                name="nome"
                required
                placeholder="lembrete_pagamento"
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Apenas letras, números e _</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Categoria</label>
              <select
                name="categoria"
                defaultValue="UTILITY"
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
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
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Corpo da mensagem
              <span className="ml-1 font-normal text-muted-foreground/70">— use {'{{1}}'}, {'{{2}}'} para variáveis</span>
            </label>
            <textarea
              name="corpo"
              required
              rows={5}
              value={corpo}
              onChange={e => setCorpo(e.target.value)}
              placeholder={'Olá, {{1}}! Sua fatura de R$ {{2}} vence em {{3}} dias.'}
              className="w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
            {vars.length > 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Variáveis detectadas: {vars.map(v => `{{${v}}}`).join(', ')}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Rodapé (opcional)</label>
            <input
              name="rodape"
              placeholder="Não responder a este número."
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onFechar}
              className="flex-1 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {pending ? 'Criando…' : 'Criar Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{modelo.nome}</h2>
            <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${st.cls}`}>
              {st.icon}{st.label}
            </span>
          </div>
          <button onClick={onFechar} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
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
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">{modelo.cabecalho}</p>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs text-muted-foreground">Corpo</p>
            <pre className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm text-foreground font-sans">
              {modelo.corpo}
            </pre>
          </div>

          {modelo.rodape && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Rodapé</p>
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{modelo.rodape}</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-border px-5 py-4">
          {modelo.status === 'rascunho' && (
            <>
              <button
                onClick={handleExcluir}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Excluir
              </button>
              <button
                onClick={handleSubmeter}
                disabled={atualizando}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {atualizando ? 'Submetendo…' : 'Submeter para aprovação Meta'}
              </button>
            </>
          )}
          {modelo.status !== 'rascunho' && (
            <button onClick={onFechar} className="flex-1 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent">
              Fechar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export function TemplatesClient({ modelos }: { modelos: Modelo[] }) {
  const [modalNovo, setModalNovo]       = useState(false)
  const [modeloVer, setModeloVer]       = useState<Modelo | null>(null)

  return (
    <>
      {modalNovo    && <ModalNovoTemplate onFechar={() => setModalNovo(false)} />}
      {modeloVer    && <ModalVerTemplate modelo={modeloVer} onFechar={() => setModeloVer(null)} />}

      <div className="mx-auto max-w-4xl space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold text-foreground">Templates WhatsApp Business</h1>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Templates precisam ser aprovados pela Meta antes do uso em campanhas.
            </p>
          </div>
          <button
            onClick={() => setModalNovo(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Novo template
          </button>
        </div>

        {/* Aviso de configuração */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4">
          <p className="text-sm text-amber-600 dark:text-amber-400">
            <strong>API Meta não configurada.</strong> Para submeter templates e fazer disparos via API oficial,
            configure sua conta Meta Business em Configurações → WhatsApp Business API.
          </p>
        </div>

        {/* Lista */}
        {modelos.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-16 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum template criado ainda.</p>
            <button
              onClick={() => setModalNovo(true)}
              className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
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
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 text-left transition hover:border-primary/50 hover:bg-accent/30"
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
