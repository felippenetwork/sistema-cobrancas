'use client'

import { useActionState, useState, useEffect, useCallback } from 'react'
import { Loader2, CheckCircle, ChevronDown, ChevronUp, MessageSquare, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { NOTIF_TIPOS } from '@/lib/notificacao/tipos'
import { toggleCanalAction, salvarTemplateAction, seedNotificacoesAction } from './_actions/notificacao'

const TEXTAREA = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary resize-none'
const INPUT    = 'w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary'

type Config = {
  tipo: string; horario: string
  ativo_whatsapp: boolean; ativo_email: boolean
  template_whatsapp: string | null; assunto_email: string | null; template_email: string | null
}

function EditForm({ cfg, onClose }: { cfg: Config; onClose: () => void }) {
  const [state, formAction, isPending] = useActionState(salvarTemplateAction, { error: null })
  useEffect(() => { if (state.success) onClose() }, [state.success, onClose])

  return (
    <form action={formAction} className="mt-3 space-y-3 rounded-md border border-border bg-muted/20 p-4">
      <input type="hidden" name="tipo" value={cfg.tipo} />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Horário</label>
          <input type="time" name="horario" defaultValue={cfg.horario} className={INPUT} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <MessageSquare className="h-3 w-3" /> Template WhatsApp
        </label>
        <textarea name="template_whatsapp" rows={4} defaultValue={cfg.template_whatsapp ?? ''} className={TEXTAREA} />
        <p className="text-xs text-muted-foreground">Variáveis: #NOME# #NOMECOMPLETO# #VALOR# #VENCIMENTO# #PIX# #SAUDACAO#</p>
      </div>

      <div className="space-y-1">
        <label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Mail className="h-3 w-3" /> Assunto do e-mail
        </label>
        <input type="text" name="assunto_email" defaultValue={cfg.assunto_email ?? ''} className={INPUT} />
      </div>

      <div className="space-y-1">
        <label className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Mail className="h-3 w-3" /> Corpo do e-mail
        </label>
        <textarea name="template_email" rows={4} defaultValue={cfg.template_email ?? ''} className={TEXTAREA} />
      </div>

      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      {state.success && <p className="flex items-center gap-1 text-xs text-success"><CheckCircle className="h-3 w-3" /> Salvo!</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={isPending}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {isPending ? 'Salvando...' : 'Salvar'}
        </button>
        <button type="button" onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          Cancelar
        </button>
      </div>
    </form>
  )
}

export default function NotificacaoPage() {
  const [configs, setConfigs] = useState<Config[]>([])
  const [loading, setLoading] = useState(true)
  const [editando, setEditando] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  const fetchConfigs = useCallback(async () => {
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return
    const { data: conta } = await sb.from('contas').select('id').eq('owner_user_id', user.id).single()
    if (!conta) return

    let { data } = await sb.from('notificacoes_config').select('*').eq('conta_id', (conta as any).id).order('created_at')
    if (!data?.length) {
      await seedNotificacoesAction()
      const { data: seeded } = await sb.from('notificacoes_config').select('*').eq('conta_id', (conta as any).id)
      data = seeded
    }
    setConfigs((data as Config[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchConfigs() }, [fetchConfigs])

  async function handleToggle(tipo: string, canal: 'whatsapp' | 'email', atual: boolean) {
    setToggling(`${tipo}-${canal}`)
    await toggleCanalAction(tipo, canal, !atual)
    await fetchConfigs()
    setToggling(null)
  }

  if (loading) return (
    <div className="flex min-h-[40vh] items-center justify-center p-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )

  const configMap = new Map(configs.map(c => [c.tipo, c]))

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Notificações</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          8 tipos fixos. Ative o canal e personalize o conteúdo por tipo.
        </p>
      </div>

      <div className="max-w-2xl space-y-3">
        {NOTIF_TIPOS.map(({ tipo, label, desc }) => {
          const cfg = configMap.get(tipo)
          const aberto = editando === tipo
          const waTog = `${tipo}-whatsapp`
          const emTog = `${tipo}-email`

          return (
            <div key={tipo} className="rounded-lg border border-border bg-card">
              <div className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {/* WhatsApp toggle */}
                  <button
                    onClick={() => cfg && handleToggle(tipo, 'whatsapp', cfg.ativo_whatsapp)}
                    disabled={!cfg || toggling === waTog}
                    title="WhatsApp"
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition ${
                      cfg?.ativo_whatsapp ? 'bg-success-bg text-success' : 'bg-muted text-muted-foreground'
                    } disabled:opacity-50`}
                  >
                    {toggling === waTog && <Loader2 className="h-3 w-3 animate-spin" />}
                    <MessageSquare className="h-3 w-3" />
                    {cfg?.ativo_whatsapp ? 'Ativo' : 'Off'}
                  </button>

                  {/* Email toggle */}
                  <button
                    onClick={() => cfg && handleToggle(tipo, 'email', cfg.ativo_email)}
                    disabled={!cfg || toggling === emTog}
                    title="E-mail"
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition ${
                      cfg?.ativo_email ? 'bg-success-bg text-success' : 'bg-muted text-muted-foreground'
                    } disabled:opacity-50`}
                  >
                    {toggling === emTog && <Loader2 className="h-3 w-3 animate-spin" />}
                    <Mail className="h-3 w-3" />
                    {cfg?.ativo_email ? 'Ativo' : 'Off'}
                  </button>

                  {/* Editar */}
                  <button
                    onClick={() => setEditando(aberto ? null : tipo)}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {aberto ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    Editar
                  </button>
                </div>
              </div>

              {aberto && cfg && (
                <div className="border-t border-border px-4 pb-4">
                  <EditForm cfg={cfg} onClose={() => { setEditando(null); fetchConfigs() }} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
