'use client'

import { useActionState, useState, useEffect } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { criarCobrancaAction } from '../_actions/cobrancas'
import { createClient } from '@/lib/supabase/client'

const INPUT = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'
const LABEL = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'

type Cliente = { id: string; nome: string; sobrenome: string | null }
type Meio    = { id: string; nome: string; is_padrao: boolean }

// Próximo mês no fuso SP (America/Sao_Paulo) → "YYYY-MM"
function proximoMes() {
  const sp  = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const [ano, mes] = sp.split('-').map(Number)
  return mes === 12
    ? `${ano + 1}-01`
    : `${ano}-${String(mes + 1).padStart(2, '0')}`
}

export default function NovaCobrancaPage() {
  const [state, formAction, isPending] = useActionState(criarCobrancaAction, { error: null })
  const [clientes, setClientes]         = useState<Cliente[]>([])
  const [meios, setMeios]               = useState<Meio[]>([])
  const [recorrente, setRecorrente]     = useState(false)
  const [tipoIntegracao, setTipoIntegracao] = useState('')
  const [renovarExterno, setRenovarExterno] = useState(false)

  useEffect(() => {
    const sb = createClient()
    Promise.all([
      sb.from('clientes').select('id, nome, sobrenome').is('deleted_at', null).order('nome'),
      sb.from('meios_pagamento').select('id, nome, is_padrao').order('created_at'),
    ]).then(([{ data: c }, { data: m }]) => {
      setClientes((c as Cliente[]) ?? [])
      setMeios((m as Meio[]) ?? [])
    })
  }, [])

  async function handleClienteChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    setTipoIntegracao('')
    setRenovarExterno(false)
    if (!id) return
    const { data } = await createClient()
      .from('clientes')
      .select('tipo_integracao, login_externo')
      .eq('id', id)
      .maybeSingle()
    if (data?.tipo_integracao && data?.login_externo) {
      setTipoIntegracao(data.tipo_integracao)
      setRenovarExterno(true)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/cobrancas" className="text-xs text-muted-foreground transition hover:text-foreground">
          ← Cobranças
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Nova cobrança</h1>
      </div>

      <div className="max-w-lg rounded-lg border border-border bg-card p-6">
        <form action={formAction} className="space-y-4">
          {/* Input hidden para o checkbox de recorrente */}
          <input type="hidden" name="recorrente" value={String(recorrente)} />

          {/* Cliente */}
          <div className="space-y-1.5">
            <label className={LABEL}>Cliente *</label>
            <select name="cliente_id" required className={INPUT} onChange={handleClienteChange}>
              <option value="">Selecione...</option>
              {clientes.map(c => (
                <option key={c.id} value={c.id}>{c.nome}{c.sobrenome ? ' ' + c.sobrenome : ''}</option>
              ))}
            </select>
          </div>

          {/* Valor */}
          <div className="space-y-1.5">
            <label className={LABEL}>Valor da mensalidade (R$) *</label>
            <input type="text" name="valor_mensalidade" required placeholder="150,00" className={INPUT} />
          </div>

          {/* Recorrente toggle */}
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-3">
            <input
              id="recorrente"
              type="checkbox"
              checked={recorrente}
              onChange={e => setRecorrente(e.target.checked)}
              className="h-4 w-4 rounded accent-primary"
            />
            <label htmlFor="recorrente" className="text-sm text-foreground cursor-pointer select-none">
              Recorrente (mensalidades sem data de término)
            </label>
          </div>

          {/* Qtd. de parcelas (oculto se recorrente) */}
          {!recorrente && (
            <div className="space-y-1.5">
              <label className={LABEL}>Quantidade de parcelas *</label>
              <input type="number" name="qtd_parcelas" min="1" max="360" placeholder="12" className={INPUT} />
            </div>
          )}

          {/* Dia de pagamento + Mês/Ano de início */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className={LABEL}>Dia de pagamento *</label>
              <input type="number" name="dia_pagamento" required min="1" max="31" placeholder="10" className={INPUT} />
            </div>
            <div className="space-y-1.5">
              <label className={LABEL}>Mês/ano de início *</label>
              <input type="month" name="mes_ano_inicio" required defaultValue={proximoMes()} className={INPUT} />
            </div>
          </div>

          {/* Meio de pagamento */}
          {meios.length > 0 && (
            <div className="space-y-1.5">
              <label className={LABEL}>Forma de pagamento</label>
              <select name="meio_pagamento_id" className={INPUT}>
                <option value="">Usar padrão da conta</option>
                {meios.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.nome}{m.is_padrao ? ' (padrão)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Observação */}
          <div className="space-y-1.5">
            <label className={LABEL}>Observação</label>
            <textarea name="observacao" rows={2} placeholder="Opcional..." className={INPUT} />
          </div>

          {/* Renovar no LookDefense (só aparece se o cliente tiver integração) */}
          {tipoIntegracao && (
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-3">
              <input
                id="renovar_externo"
                type="checkbox"
                name="renovar_externo"
                value="true"
                checked={renovarExterno}
                onChange={e => setRenovarExterno(e.target.checked)}
                className="h-4 w-4 rounded accent-primary"
              />
              <label htmlFor="renovar_externo" className="text-sm text-foreground cursor-pointer select-none">
                Renovar no LookDefense {tipoIntegracao === 'lookdefense_p2p' ? '(P2P)' : '(IPTV)'}
              </label>
            </div>
          )}

          {/* Boas-vindas */}
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-3">
            <input
              id="boas_vindas"
              type="checkbox"
              name="enviar_boas_vindas"
              value="true"
              className="h-4 w-4 rounded accent-primary"
            />
            <label htmlFor="boas_vindas" className="text-sm text-foreground cursor-pointer select-none">
              Enviar mensagem de boas-vindas ao cliente
            </label>
          </div>

          {state.error && (
            <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">{state.error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit" disabled={isPending}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? 'Criando...' : 'Criar cobrança'}
            </button>
            <Link href="/cobrancas" className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground">
              Cancelar
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
