'use client'

// Página de conexão WhatsApp.
// Usa Supabase Realtime para receber QR e atualizações de status em tempo real.
// O socket Baileys fica no worker VPS — este componente só exibe o estado.

import { useState, useEffect, useCallback } from 'react'
import QRCode from 'react-qr-code'
import { Loader2, Wifi, WifiOff, RefreshCw, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { conectarAction, desconectarAction, reiniciarAction } from './_actions/conexao'

type Conexao = {
  id: string
  status: 'conectado' | 'desconectado' | 'conectando'
  numero_conectado: string | null
  device_name:      string | null
  qr_code:          string | null
  ultima_conexao:   string | null
}

const STATUS_CFG = {
  conectado:    { label: 'Conectado',    dot: 'bg-success',     text: 'text-success' },
  desconectado: { label: 'Desconectado', dot: 'bg-destructive', text: 'text-destructive' },
  conectando:   { label: 'Conectando…',  dot: 'bg-warning animate-pulse', text: 'text-warning' },
}

export default function ConexaoPage() {
  const [conexao, setConexao] = useState<Conexao | null>(null)
  const [contaId, setContaId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionPending, setActionPending] = useState(false)

  const runAction = useCallback(async (fn: () => Promise<void>) => {
    setActionPending(true)
    try { await fn() } finally { setActionPending(false) }
  }, [])

  useEffect(() => {
    const sb = createClient()
    let cleanup: (() => void) | undefined

    async function init() {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: conta } = await sb
        .from('contas').select('id').eq('owner_user_id', user.id).maybeSingle()
      if (!conta) { setLoading(false); return }

      setContaId(conta.id)

      const { data } = await sb
        .from('conexoes').select('*').eq('conta_id', conta.id).maybeSingle()
      setConexao(data as Conexao)
      setLoading(false)

      // Realtime: recebe QR e status do worker instantaneamente
      const channel = sb
        .channel('conexao-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'conexoes', filter: `conta_id=eq.${conta.id}` },
          (payload) => { if (payload.new) setConexao(payload.new as Conexao) },
        )
        .subscribe()

      cleanup = () => { sb.removeChannel(channel) }
    }

    init()
    return () => cleanup?.()
  }, [])

  if (loading) return (
    <div className="flex min-h-[40vh] items-center justify-center p-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )

  const status = conexao?.status ?? 'desconectado'
  const cfg    = STATUS_CFG[status]

  return (
    <div className="p-8">
      <h1 className="mb-6 text-xl font-semibold text-foreground">Conexão WhatsApp</h1>

      <div className="max-w-md space-y-6">

        {/* Status badge */}
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
          <span className={`text-sm font-medium ${cfg.text}`}>{cfg.label}</span>
        </div>

        {/* Conectado: info do número */}
        {status === 'conectado' && conexao?.numero_conectado && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-success">
              <Wifi className="h-4 w-4" />
              <span className="text-sm font-medium">Pareado com sucesso</span>
            </div>
            <p className="text-sm text-foreground">
              <span className="text-muted-foreground">Número:</span>{' '}
              +{conexao.numero_conectado}
            </p>
            {conexao.device_name && (
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Dispositivo:</span>{' '}
                {conexao.device_name}
              </p>
            )}
          </div>
        )}

        {/* Conectando: QR Code */}
        {status === 'conectando' && (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            {conexao?.qr_code ? (
              <>
                <div className="mx-auto inline-block rounded-lg bg-white p-3">
                  <QRCode value={conexao.qr_code} size={200} />
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  Abra o WhatsApp → <strong className="text-foreground">Aparelhos conectados</strong> → Conectar aparelho
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  O QR atualiza automaticamente caso expire.
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Aguardando o worker gerar o QR Code…
                </p>
                <p className="text-xs text-muted-foreground">
                  Certifique-se de que o worker está rodando no VPS.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Desconectado: instruções */}
        {status === 'desconectado' && (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <WifiOff className="h-4 w-4" />
              <span className="text-sm">Nenhum número conectado</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Clique em <strong className="text-foreground">Conectar</strong> para gerar o QR Code e parear seu WhatsApp.
            </p>
          </div>
        )}

        {/* Ações */}
        <div className="flex flex-wrap gap-3">
          {(status === 'desconectado' || !conexao) && (
            <button
              disabled={actionPending}
              onClick={() => runAction(conectarAction)}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {actionPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Conectar
            </button>
          )}

          {(status === 'conectado' || status === 'conectando') && (
            <>
              <button
                disabled={actionPending}
                onClick={() => runAction(reiniciarAction)}
                className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-foreground transition hover:bg-accent disabled:opacity-50"
              >
                {actionPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Reiniciar
              </button>
              <button
                disabled={actionPending}
                onClick={() => runAction(desconectarAction)}
                className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive-bg px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/20 disabled:opacity-50"
              >
                {actionPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Desconectar
              </button>
            </>
          )}
        </div>

        {/* Nota informativa sobre o worker */}
        <p className="text-xs text-muted-foreground">
          A conexão é mantida pelo worker no VPS Vortexus. Esta tela mostra o estado em tempo real via Supabase Realtime.
        </p>

      </div>
    </div>
  )
}
