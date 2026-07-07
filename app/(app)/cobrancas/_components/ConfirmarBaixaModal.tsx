'use client'

import { useActionState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'
import { baixarParcelaComConfirmacaoAction } from '../_actions/parcelas'
import { formatData } from '@/lib/utils/format'

export type ModalPagamento = {
  parcelaId:         string
  cobrancaId:        string
  clienteNome:       string
  valor:             number
  createdAt:         string
  recorrente:        boolean
  proximoVencimento: string
}

const INPUT = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-card'
const LABEL = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'

export function ConfirmarBaixaModal({
  modal,
  onClose,
  onSuccess,
}: {
  modal:      ModalPagamento
  onClose:    () => void
  onSuccess?: () => void
}) {
  const [state, formAction, isPending] = useActionState(baixarParcelaComConfirmacaoAction, { error: null })

  useEffect(() => {
    if (state.success) {
      onClose()
      onSuccess?.()
    }
  }, [state.success, onClose, onSuccess])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-lg border border-border bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">Confirmar Pagamento</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-muted-foreground transition hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Corpo */}
        <form id="confirmar-baixa-form" action={formAction} className="space-y-4 px-6 py-5">
          <input type="hidden" name="parcela_id"  value={modal.parcelaId} />
          <input type="hidden" name="cobranca_id" value={modal.cobrancaId} />

          {/* Cliente — somente leitura */}
          <div className="space-y-1.5">
            <label className={LABEL}>Cliente</label>
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {modal.clienteNome}
            </p>
          </div>

          {/* Valor — editável, cascateia para próximos pagamentos */}
          <div className="space-y-1.5">
            <label className={LABEL}>Valor (R$)</label>
            <input
              type="number"
              name="valor"
              defaultValue={modal.valor.toFixed(2)}
              step="0.01"
              min="0.01"
              required
              className={INPUT}
            />
            {modal.recorrente && (
              <p className="text-xs text-muted-foreground">
                Alterar o valor atualiza todos os próximos pagamentos.
              </p>
            )}
          </div>

          {/* Data de registro — somente leitura */}
          <div className="space-y-1.5">
            <label className={LABEL}>Data de registro</label>
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {formatData(modal.createdAt)}
            </p>
          </div>

          {/* Próximo vencimento — editável (apenas recorrente) */}
          {modal.recorrente && (
            <div className="space-y-1.5">
              <label className={LABEL}>Próximo pagamento</label>
              <input
                type="date"
                name="proximo_vencimento"
                defaultValue={modal.proximoVencimento}
                required
                className={INPUT}
              />
            </div>
          )}

          {state.error && (
            <p className="rounded-md bg-destructive-bg px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}
        </form>

        {/* Rodapé */}
        <div className="flex items-center gap-3 border-t border-border px-6 py-4">
          <button
            type="submit"
            form="confirmar-baixa-form"
            disabled={isPending}
            className="flex items-center gap-2 rounded-md bg-success px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? 'Registrando...' : 'Confirmar pagamento'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
