'use client'

import { useActionState, useState, useEffect } from 'react'
import { Loader2, CheckCircle, Star, Trash2, Pencil, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { criarMeioAction, editarMeioAction, definirPadraoAction, excluirMeioAction } from './_actions/meios'

const INPUT = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'
const LABEL = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'

type Meio = { id: string; nome: string; mensagem: string; is_padrao: boolean }

export default function TipoPagamentoPage() {
  const [stateNovo,  formActionNovo,  isPendingNovo]  = useActionState(criarMeioAction,  { error: null })
  const [stateEdit,  formActionEdit,  isPendingEdit]  = useActionState(editarMeioAction, { error: null })
  const [meios, setMeios]     = useState<Meio[]>([])
  const [padrao, setPadrao]   = useState(false)
  const [editando, setEditando] = useState<Meio | null>(null)
  const [editPadrao, setEditPadrao] = useState(false)
  const [excluindo, setExcluindo]   = useState<string | null>(null)

  async function fetchMeios() {
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const { data: conta } = await sb.from('contas').select('id').eq('owner_user_id', user.id).single()
    if (!conta) return
    const { data } = await sb.from('meios_pagamento').select('*').eq('conta_id', (conta as any).id).order('created_at')
    setMeios((data as Meio[]) ?? [])
  }

  useEffect(() => { fetchMeios() }, [])
  useEffect(() => { if (stateNovo.success) { fetchMeios(); setPadrao(false) } }, [stateNovo.success])
  useEffect(() => { if (stateEdit.success) { fetchMeios(); setEditando(null) } }, [stateEdit.success])

  function abrirEdicao(m: Meio) {
    setEditando(m)
    setEditPadrao(m.is_padrao)
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Tipo de Pagamento</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Cadastre sua chave Pix. O método marcado como padrão alimenta a variável #PIX# nas notificações.
        </p>
      </div>

      <div className="max-w-lg space-y-6">
        {/* Lista */}
        {meios.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Nome</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {meios.map(m => (
                  <tr key={m.id} className="bg-card hover:bg-accent/20">
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground">{m.nome}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <form action={definirPadraoAction}>
                          <input type="hidden" name="meio_id" value={m.id} />
                          <button
                            type="submit"
                            aria-label={m.is_padrao ? 'Padrão' : 'Definir como padrão'}
                            className={`rounded p-1 transition ${m.is_padrao ? 'text-warning' : 'text-muted-foreground hover:text-warning'}`}
                          >
                            <Star className={`h-4 w-4 ${m.is_padrao ? 'fill-warning' : ''}`} />
                          </button>
                        </form>
                        <button
                          onClick={() => abrirEdicao(m)}
                          aria-label="Editar"
                          className="rounded p-1 text-muted-foreground hover:text-primary"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Editar */}
        {editando && (
          <div className="rounded-lg border border-primary/40 bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Editar Pix</h2>
              <button onClick={() => setEditando(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form action={formActionEdit} className="space-y-4">
              <input type="hidden" name="meio_id"  value={editando.id} />
              <input type="hidden" name="is_padrao" value={String(editPadrao)} />

              <div className="space-y-1.5">
                <label className={LABEL}>Nome *</label>
                <input type="text" name="nome" required defaultValue={editando.nome} className={INPUT} />
              </div>

              <div className="space-y-1.5">
                <label className={LABEL}>Chave ou instrução Pix *</label>
                <textarea name="mensagem" required rows={3} defaultValue={editando.mensagem}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary resize-none" />
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="edit-padrao" checked={editPadrao} onChange={e => setEditPadrao(e.target.checked)}
                  className="h-4 w-4 accent-primary" />
                <label htmlFor="edit-padrao" className="cursor-pointer text-sm text-foreground">Definir como padrão</label>
              </div>

              {stateEdit.error && <p className="text-sm text-destructive">{stateEdit.error}</p>}

              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  <button type="submit" disabled={isPendingEdit}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                    {isPendingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isPendingEdit ? 'Salvando...' : 'Salvar alterações'}
                  </button>
                  <button type="button" onClick={() => setEditando(null)}
                    className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent">
                    Cancelar
                  </button>
                </div>
                {excluindo === editando?.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Confirmar exclusão?</span>
                    <form action={excluirMeioAction} onSubmit={() => { setExcluindo(null); setEditando(null) }}>
                      <input type="hidden" name="meio_id" value={editando.id} />
                      <button type="submit" className="text-xs font-medium text-destructive hover:opacity-80">Excluir</button>
                    </form>
                    <button onClick={() => setExcluindo(null)} className="text-xs text-muted-foreground hover:opacity-80">Cancelar</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setExcluindo(editando?.id ?? null)}
                    className="flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-3.5 w-3.5" /> Excluir
                  </button>
                )}
              </div>
            </form>
          </div>
        )}

        {/* Novo */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Adicionar Pix</h2>
          <form action={formActionNovo} className="space-y-4">
            <input type="hidden" name="is_padrao" value={String(padrao)} />

            <div className="space-y-1.5">
              <label className={LABEL}>Nome *</label>
              <input type="text" name="nome" required placeholder="Pix principal" className={INPUT} />
            </div>

            <div className="space-y-1.5">
              <label className={LABEL}>Chave ou instrução Pix *</label>
              <textarea name="mensagem" required rows={3} placeholder="Pix: 00.000.000/0001-00"
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary resize-none" />
              <p className="text-xs text-muted-foreground">Este texto será inserido onde aparecer #PIX# nos templates.</p>
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="padrao" checked={padrao} onChange={e => setPadrao(e.target.checked)}
                className="h-4 w-4 accent-primary" />
              <label htmlFor="padrao" className="cursor-pointer text-sm text-foreground">Definir como padrão</label>
            </div>

            {stateNovo.error && <p className="text-sm text-destructive">{stateNovo.error}</p>}
            {stateNovo.success && (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle className="h-4 w-4" /> Pix adicionado.
              </p>
            )}

            <button type="submit" disabled={isPendingNovo}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {isPendingNovo && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPendingNovo ? 'Salvando...' : 'Adicionar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
