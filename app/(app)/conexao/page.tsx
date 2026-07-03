'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Wifi, WifiOff, RefreshCw, LogOut, Smartphone, QrCode } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { conectarAction, desconectarAction, reiniciarAction } from './_actions/conexao'

type Conexao = {
  id:               string
  status:           'conectado' | 'desconectado' | 'conectando'
  numero_conectado: string | null
  device_name:      string | null
  qr_code:          string | null
  ultima_conexao:   string | null
}

export default function ConexaoPage() {
  const [conexao, setConexao]             = useState<Conexao | null>(null)
  const [loading, setLoading]             = useState(true)
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
          .from('conexoes')
          .select('id, status, numero_conectado, device_name, qr_code, ultima_conexao')
          .eq('conta_id', conta.id).maybeSingle()
        if (data) setConexao(data)
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
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )

  const status = conexao?.status ?? 'desconectado'

  return (
    <div className="p-6 md:p-8">
      <h1 className="mb-6 text-xl font-semibold text-foreground">Conexão WhatsApp</h1>

      <div className="max-w-sm">
        <div className="rounded-lg border border-border bg-card">

          {/* ── Header ── */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <span className="text-sm font-semibold text-foreground">WhatsApp</span>

            <div className="flex shrink-0 items-center gap-1.5">
              {status === 'conectado' && (
                <span className="h-2 w-2 rounded-full bg-green-500" />
              )}
              {status === 'conectando' && (
                <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
              )}
              {status === 'desconectado' && (
                <span className="h-2 w-2 rounded-full bg-zinc-500" />
              )}
              <span className="text-[11px] text-muted-foreground">
                {status === 'conectado'    ? 'Conectado'   :
                 status === 'conectando'   ? 'Conectando…' : 'Desconectado'}
              </span>
            </div>
          </div>

          {/* ── Conteúdo ── */}
          <div className="space-y-4 p-4">

            {/* Conectado */}
            {status === 'conectado' && (
              <>
                <div className="flex items-center gap-2 rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2">
                  <Smartphone className="h-4 w-4 shrink-0 text-green-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-muted-foreground">Número conectado</p>
                    <p className="truncate text-sm font-semibold tabular-nums text-green-400">
                      {conexao?.numero_conectado ? `+${conexao.numero_conectado}` : '—'}
                    </p>
                  </div>
                </div>
                {conexao?.device_name && (
                  <p className="text-center text-xs text-muted-foreground">{conexao.device_name}</p>
                )}
              </>
            )}

            {/* Conectando — QR Code */}
            {status === 'conectando' && (
              conexao?.qr_code ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-lg bg-white p-2.5">
                    <img src={conexao.qr_code} alt="QR Code WhatsApp" width={190} height={190} />
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    WhatsApp{' '}
                    <span className="font-medium text-foreground">
                      → Aparelhos conectados → Conectar aparelho
                    </span>
                  </p>
                  <p className="text-center text-[11px] text-muted-foreground/60">
                    O QR atualiza automaticamente caso expire.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Gerando QR Code…</p>
                </div>
              )
            )}

            {/* Desconectado */}
            {status === 'desconectado' && (
              <div className="flex flex-col items-center gap-2 py-6">
                {conexao?.numero_conectado ? (
                  <>
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                      <WifiOff className="h-6 w-6 text-destructive" />
                    </div>
                    <p className="text-sm font-medium text-foreground">Conexão encerrada</p>
                    <p className="text-xs text-muted-foreground">+{conexao.numero_conectado}</p>
                    <p className="mt-1 text-center text-xs text-muted-foreground">
                      Clique em{' '}
                      <span className="font-medium text-foreground">Reconectar</span>{' '}
                      para restaurar.
                    </p>
                  </>
                ) : (
                  <>
                    <QrCode className="h-10 w-10 text-muted-foreground/30" />
                    <p className="text-sm font-medium text-foreground">Nenhum número conectado</p>
                    <p className="text-center text-xs text-muted-foreground">
                      Clique em{' '}
                      <span className="font-medium text-foreground">Conectar</span>{' '}
                      para gerar o QR Code e parear seu WhatsApp.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Botões */}
            <div className="flex gap-2 pt-1">
              {status === 'desconectado' ? (
                <button
                  disabled={actionPending}
                  onClick={() => runAction(conectarAction)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                >
                  {actionPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Wifi className="h-4 w-4" />}
                  {conexao?.numero_conectado ? 'Reconectar' : 'Conectar'}
                </button>
              ) : (
                <>
                  <button
                    disabled={actionPending}
                    onClick={() => runAction(reiniciarAction)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-4 py-2 text-sm text-foreground transition hover:bg-accent disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Atualizar
                  </button>
                  <button
                    disabled={actionPending}
                    onClick={() => runAction(desconectarAction)}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
                  >
                    {actionPending
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <LogOut className="h-4 w-4" />}
                    Desconectar
                  </button>
                </>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
