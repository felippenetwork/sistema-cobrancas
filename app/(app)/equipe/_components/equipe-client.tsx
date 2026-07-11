'use client'

import { useState, useActionState } from 'react'
import { Users, Plus, Trash2, Shield, UserCheck, XCircle } from 'lucide-react'
import {
  convidarMembroAction,
  atualizarMembroAction,
  removerMembroAction,
  criarDepartamentoAction,
  removerDepartamentoAction,
} from '../_actions'

type Membro = {
  id: string
  nome: string
  email: string
  role: string
  ativo: boolean
  criado_em: string
}

type Departamento = {
  id: string
  nome: string
  cor: string
  criado_em: string
}

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', atendente: 'Atendente' }

function iniciais(nome: string) {
  const p = nome.trim().split(' ').filter(Boolean)
  if (p.length >= 2) return (p[0][0] + p[p.length - 1][0]).toUpperCase()
  return nome.slice(0, 2).toUpperCase()
}

// ── Modal de convite ─────────────────────────────────────────────────────────

function ModalConvite({ onFechar }: { onFechar: () => void }) {
  const [state, action, pending] = useActionState(convidarMembroAction, { error: null })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Convidar Atendente</h2>
          <button onClick={onFechar} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
        <form action={action} className="space-y-4 p-5">
          {state.error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{state.error}</p>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome</label>
            <input
              name="nome"
              required
              placeholder="João Silva"
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">E-mail</label>
            <input
              name="email"
              type="email"
              required
              placeholder="joao@empresa.com"
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Cargo</label>
            <select
              name="role"
              defaultValue="atendente"
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="atendente">Atendente</option>
              <option value="admin">Administrador</option>
            </select>
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
              {pending ? 'Enviando…' : 'Enviar Convite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal de departamento ────────────────────────────────────────────────────

function ModalDepartamento({ onFechar }: { onFechar: () => void }) {
  const [state, action, pending] = useActionState(criarDepartamentoAction, { error: null })
  const CORES = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Novo Departamento</h2>
          <button onClick={onFechar} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
        <form action={action} className="space-y-4 p-5">
          {state.error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{state.error}</p>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome</label>
            <input
              name="nome"
              required
              placeholder="Financeiro"
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Cor</label>
            <div className="flex gap-2 flex-wrap">
              {CORES.map(c => (
                <label key={c} className="cursor-pointer">
                  <input type="radio" name="cor" value={c} className="sr-only" defaultChecked={c === '#6366f1'} />
                  <span className="block h-7 w-7 rounded-full border-2 border-transparent" style={{ backgroundColor: c }} />
                </label>
              ))}
            </div>
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
              {pending ? 'Criando…' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────

export function EquipeClient({
  membros: membrosIniciais,
  departamentos: departamentosIniciais,
}: {
  membros: Membro[]
  departamentos: Departamento[]
}) {
  const [tab, setTab]             = useState<'membros' | 'departamentos'>('membros')
  const [modalConvite, setModalConvite]   = useState(false)
  const [modalDept, setModalDept]         = useState(false)
  const [carregando, setCarregando]       = useState<string | null>(null)

  async function handleAlterarRole(membro: Membro) {
    const novoRole: 'admin' | 'atendente' = membro.role === 'admin' ? 'atendente' : 'admin'
    setCarregando(membro.id)
    await atualizarMembroAction(membro.id, { role: novoRole })
    setCarregando(null)
  }

  async function handleRemover(membroId: string) {
    if (!confirm('Remover este membro da equipe?')) return
    setCarregando(membroId)
    await removerMembroAction(membroId)
    setCarregando(null)
  }

  async function handleRemoverDept(depId: string, nome: string) {
    if (!confirm(`Remover departamento "${nome}"?`)) return
    await removerDepartamentoAction(depId)
  }

  const membrosAtivos = membrosIniciais.filter(m => m.ativo)

  return (
    <>
      {modalConvite && <ModalConvite onFechar={() => setModalConvite(false)} />}
      {modalDept    && <ModalDepartamento onFechar={() => setModalDept(false)} />}

      <div className="mx-auto max-w-4xl space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold text-foreground">Equipe</h1>
          </div>
          <button
            onClick={() => tab === 'membros' ? setModalConvite(true) : setModalDept(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            {tab === 'membros' ? 'Convidar' : 'Novo departamento'}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {(['membros', 'departamentos'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t === 'membros' ? `Atendentes (${membrosAtivos.length})` : `Departamentos (${departamentosIniciais.length})`}
            </button>
          ))}
        </div>

        {/* Membros */}
        {tab === 'membros' && (
          <div className="space-y-2">
            {membrosAtivos.length === 0 && (
              <div className="rounded-xl border border-border bg-card p-12 text-center">
                <Users className="mx-auto h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">Nenhum atendente ainda.<br />Convide alguém para começar.</p>
              </div>
            )}
            {membrosAtivos.map(m => (
              <div key={m.id} className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4">
                {/* Avatar */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {iniciais(m.nome)}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{m.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>

                {/* Role badge */}
                <span className={[
                  'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium',
                  m.role === 'admin'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground',
                ].join(' ')}>
                  {m.role === 'admin' ? <Shield className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
                  {ROLE_LABEL[m.role] ?? m.role}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleAlterarRole(m)}
                    disabled={carregando === m.id}
                    title={m.role === 'admin' ? 'Rebaixar para Atendente' : 'Promover para Admin'}
                    className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    {m.role === 'admin' ? <UserCheck className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => handleRemover(m.id)}
                    disabled={carregando === m.id}
                    title="Remover membro"
                    className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Departamentos */}
        {tab === 'departamentos' && (
          <div className="space-y-2">
            {departamentosIniciais.length === 0 && (
              <div className="rounded-xl border border-border bg-card p-12 text-center">
                <p className="text-sm text-muted-foreground">Nenhum departamento criado.</p>
              </div>
            )}
            {departamentosIniciais.map(d => (
              <div key={d.id} className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4">
                <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: d.cor }} />
                <p className="flex-1 text-sm font-medium text-foreground">{d.nome}</p>
                {d.nome !== 'Geral' && (
                  <button
                    onClick={() => handleRemoverDept(d.id, d.nome)}
                    title="Remover departamento"
                    className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
