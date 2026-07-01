'use client'

import { useState, useTransition } from 'react'
import { X, RotateCcw, Loader2, Zap } from 'lucide-react'
import { cancelarNotificacaoAction, reenviarNotificacaoAction, forcarEnvioAction } from '../_actions/log'

export function AcoesLog({ id, status, canal }: { id: string; status: string; canal: string }) {
  const [isPending, startTransition] = useTransition()
  const [confirmando, setConfirmando] = useState(false)
  const [erroForca, setErroForca]     = useState<string | null>(null)

  function handleForcar() {
    setErroForca(null)
    startTransition(async () => {
      const result = await forcarEnvioAction(id)
      if (result?.error) setErroForca(result.error)
    })
  }

  if (status === 'fila') {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          {canal === 'whatsapp' && (
            <button
              disabled={isPending}
              onClick={handleForcar}
              title="Enviar agora via WhatsApp"
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-warning transition hover:bg-warning/10 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Forçar
            </button>
          )}

          {confirmando ? (
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground">Cancelar?</span>
              <button
                disabled={isPending}
                onClick={() => startTransition(() => cancelarNotificacaoAction(id))}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Sim'}
              </button>
              <button
                disabled={isPending}
                onClick={() => setConfirmando(false)}
                className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Não
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmando(true)}
              aria-label="Cancelar envio"
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
              Cancelar
            </button>
          )}
        </div>

        {erroForca && (
          <span className="max-w-[200px] text-right text-[10px] leading-tight text-destructive">
            {erroForca}
          </span>
        )}
      </div>
    )
  }

  if (status === 'falhou' || status === 'cancelado') {
    return (
      <button
        disabled={isPending}
        onClick={() => startTransition(() => reenviarNotificacaoAction(id))}
        aria-label="Reenviar mensagem"
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-primary transition hover:bg-primary/10 disabled:opacity-50"
      >
        {isPending
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <RotateCcw className="h-3.5 w-3.5" />}
        Reenviar
      </button>
    )
  }

  return null
}
