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

// ── Sheet base (bottom sheet no mobile, modal centrado no desktop) ────────────

function Sheet({
  titulo,
  onFechar,
  children,
}: {
  titulo: string
  onFechar: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 md:items-center md:justify-center md:p-4"
      onClick={e => e.target === e.currentTarget && onFechar()}
    >
      <div className="w-full rounded-t-2xl border border-border bg-card shadow-2xl md:max-w-sm md:rounded-xl">
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

// ── Modal de convite ─────────────────────────────────────────────────────────

function ModalConvite({ onFechar }: { onFechar: () => void }) {
  const [state, action, pending] = useActionState(convidarMembroAction, { error: null })

  return (
    <Sheet titulo="Convidar Atendente" onFechar={onFechar}>
      <form action={action} className="space-y-4 p-5">
        {state.error && (
          <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{state.error}</p>
        )}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome</label>
          <input
            name="nome"
            required
            placeholder="João Silva"
            className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">E-mail</label>
          <input
            name="email"
            type="email"
            required
            placeholder="joao@empresa.com"
            className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Cargo</label>
          <select
            name="role"
            defaultValue="atendente"
            className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
          >
            <option value="atendente">Atendente</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        <div
          className="flex gap-3 pt-1"
          style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom, 0px))' }}
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
            {pending ? 'Enviando…' : 'Enviar Convite'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

// ── Modal de departamento ────────────────────────────────────────────────────

function ModalDepartamento({ onFechar }: { onFechar: () => void }) {
  const [state, action, pending] = useActionState(criarDepartamentoAction, { error: null })
  const CORES = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']

  return (
    <Sheet titulo="Novo Departamento" onFechar={onFechar}>
      <form action={action} className="space-y-4 p-5">
        {state.error && (
          <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{state.error}</p>
        )}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome</label>
          <input
            name="nome"
            required
            placeholder="Financeiro"
            className="w-full rounded-xl border border-border bg-input px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-medium text-muted-foreground">Cor</label>
          <div className="flex gap-3 flex-wrap">
            {CORES.map(c => (
              <label key={c} className="cursor-pointer">
                <input type="radio" name="cor" value={c} className="sr-only" defaultChecked={c === '#6366f1'} />
                <span className="block h-8 w-8 rounded-full border-2 border-transparent transition hover:scale-110" style={{ backgroundColor: c }} />
              </label>
            ))}
          </div>
        </div>
        <div
          className="flex gap-3 pt-1"
          style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom, 0px))' }}
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
            {pending ? 'Criando…' : 'Criar'}
          </button>
        </div>
      </form>
    </Sheet>
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
  const [tab, setTab]                       = useState<'membros' | 'departamentos'>('membros')
  const [modalConvite, setModalConvite]     = useState(false)
  const [modalDept, setModalDept]           = useState(false)
  const [carregando, setCarregando]         = useState<string | null>(null)

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

      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold text-foreground">Equipe</h1>
          </div>
          <button
            onClick={() => tab === 'membros' ? setModalConvite(true) : setModalDept(true)}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 active:opacity-80"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{tab === 'membros' ? 'Convidar' : 'Novo departamento'}</span>
            <span className="sm:hidden">{tab === 'membros' ? 'Convidar' : 'Novo'}</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {(['membros', 'departamentos'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t === 'membros'
                ? `Atendentes (${membrosAtivos.length})`
                : `Departamentos (${departamentosIniciais.length})`}
            </button>
          ))}
        </div>

        {/* Membros */}
        {tab === 'membros' && (
          <div className="space-y-2">
            {membrosAtivos.length === 0 && (
              <div className="rounded-2xl border border-border bg-card p-12 text-center">
                <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Nenhum atendente ainda.<br />Convide alguém para começar.</p>
              </div>
            )}
            {membrosAtivos.map(m => (
              <div key={m.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 md:px-5 md:py-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {iniciais(m.nome)}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{m.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>

                <span className={[
                  'hidden shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium sm:flex',
                  m.role === 'admin' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                ].join(' ')}>
                  {m.role === 'admin' ? <Shield className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
                  {ROLE_LABEL[m.role] ?? m.role}
                </span>

                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => handleAlterarRole(m)}
                    disabled={carregando === m.id}
                    title={m.role === 'admin' ? 'Rebaixar para Atendente' : 'Promover para Admin'}
                    className="rounded-xl p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    {m.role === 'admin' ? <UserCheck className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => handleRemover(m.id)}
                    disabled={carregando === m.id}
                    title="Remover membro"
                    className="rounded-xl p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
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
              <div className="rounded-2xl border border-border bg-card p-12 text-center">
                <p className="text-sm text-muted-foreground">Nenhum departamento criado.</p>
              </div>
            )}
            {departamentosIniciais.map(d => (
              <div key={d.id} className="flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-4 md:px-5">
                <span className="h-5 w-5 shrink-0 rounded-full" style={{ backgroundColor: d.cor }} />
                <p className="flex-1 text-sm font-medium text-foreground">{d.nome}</p>
                {d.nome !== 'Geral' && (
                  <button
                    onClick={() => handleRemoverDept(d.id, d.nome)}
                    className="rounded-xl p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
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
