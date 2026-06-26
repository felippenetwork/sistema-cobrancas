'use client'

import { useState, useEffect, useCallback } from 'react'
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
  conectado:    { label: 'Conectado',   dot: 'bg-success',                    text: 'text-success' },
  desconectado: { label: 'Desconectado', dot: 'bg-destructive',               text: 'text-destructive' },
  conectando:   { label: 'Conectando...', dot: 'bg-warning animate-pulse',    text: 'text-warning' },
}

export default function ConexaoPage() {
  const [conexao, setConexao]       = useState<Conexao | null>(null)
  const [loading, setLoading]       = useState(true)
  const [actionPending, setActionPending] = useState(false)

  const runAction = useCallback(async (fn: () => Promise<void>) => {
    setActionPending(true)
    try { await fn() } finally { setActionPending(false) }
  }, [])

  useEffect(() => {
    const sb = createClient()
    let cleanup: (() => void) | undefined
    let pollInterval: ReturnType<typeof setInterval> | undefined

    async function init() {
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: conta } = await sb
        .from('contas').select('id').eq('owner_user_id', user.id).maybeSingle()
      if (!conta) { setLoading(false); return }

      const fetchConexao = async () => {
        const { data } = await sb
          .from('conexoes').select('*').eq('conta_id', conta.id).maybeSingle()
        if (data) setConexao(data as Conexao)
      }

      await fetchConexao()
      setLoading(false)

      const channel = sb
        .channel('conexao-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'conexoes', filter: `conta_id=eq.${conta.id}` },
          (payload) => { if (payload.new) setConexao(payload.new as Conexao) },
        )
        .subscribe()

      pollInterval = setInterval(fetchConexao, 3_000)
      cleanup = () => { sb.removeChannel(channel); clearInterval(pollInterval) }
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

      <div className="max-w-sm space-y-5">

        {/* Status */}
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
          <span className={`text-sm font-medium ${cfg.text}`}>{cfg.label}</span>
        </div>

        {/* Card principal */}
        <div className="rounded-lg border border-border bg-card p-6 text-center">

          {/* ── Conectado ── */}
          {status === 'conectado' && (
            <>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
                <Wifi className="h-8 w-8 text-success" />
              </div>
              <p className="text-base font-semibold text-foreground">WhatsApp conectado</p>
              {conexao?.numero_conectado && (
                <p className="mt-1 text-sm text-muted-foreground">+{conexao.numero_conectado}</p>
              )}
              {conexao?.device_name && (
                <p className="text-sm text-muted-foreground">{conexao.device_name}</p>
              )}
            </>
          )}

          {/* ── Conectando — QR Code ── */}
          {status === 'conectando' && (
            conexao?.qr_code ? (
              <>
                <div className="mx-auto inline-block rounded-lg bg-white p-3">
                  <img src={conexao.qr_code} alt="QR Code WhatsApp" width={200} height={200} />
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
                <p className="text-sm text-muted-foreground">Gerando QR Code…</p>
              </div>
            )
          )}

          {/* ── Desconectado ── */}
          {status === 'desconectado' && (
            <>
              <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${conexao?.numero_conectado ? 'bg-destructive/10' : 'bg-muted/40'}`}>
                <WifiOff className={`h-8 w-8 ${conexao?.numero_conectado ? 'text-destructive' : 'text-muted-foreground'}`} />
              </div>
              {conexao?.numero_conectado ? (
                <>
                  <p className="text-base font-semibold text-foreground">Conexão encerrada</p>
                  <p className="mt-1 text-sm text-muted-foreground">+{conexao.numero_conectado}</p>
                  {conexao.device_name && (
                    <p className="text-sm text-muted-foreground">{conexao.device_name}</p>
                  )}
                  <p className="mt-3 text-sm text-muted-foreground">
                    Clique em <strong className="text-foreground">Reconectar</strong> para restaurar a conexão.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-base font-semibold text-foreground">Nenhum número conectado</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Clique em <strong className="text-foreground">Conectar</strong> para gerar o QR Code e parear seu WhatsApp.
                  </p>
                </>
              )}
            </>
          )}

        </div>

        {/* Botões */}
        <div className="flex flex-wrap gap-3">
          {(status === 'desconectado' || !conexao) && (
            <button
              disabled={actionPending}
              onClick={() => runAction(conectarAction)}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {actionPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {conexao?.numero_conectado ? 'Reconectar' : 'Conectar'}
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

      </div>
    </div>
  )
}
