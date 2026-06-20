import { createClient } from '@/lib/supabase/server'
import { MonthSelector } from '@/app/(app)/_components/month-selector'
import { parseMes, getMesBounds } from '@/lib/utils/mes'
import { formatData } from '@/lib/utils/format'

export const metadata = { title: 'Log de Notificações' }

const STATUS_CLS: Record<string, string> = {
  fila:      'bg-muted text-muted-foreground',
  enviado:   'bg-muted text-muted-foreground',
  entregue:  'bg-success-bg text-success',
  lido:      'bg-success-bg text-success',
  aberto:    'bg-success-bg text-success',
  falhou:    'bg-destructive-bg text-destructive',
  cancelado: 'bg-muted text-muted-foreground',
}

const CANAL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email:    'E-mail',
}

const TIPO_LABEL: Record<string, string> = {
  '5d': '5d antes', '3d': '3d antes', '2d': '2d antes', '1d': '1d antes',
  dia: 'No dia', vencido1d: 'Vencido', manual: 'Manual', boasvindas: 'Boas-vindas',
}

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; canal?: string }>
}) {
  const { mes: mesParam, canal } = await searchParams
  const { ano, mes, param }       = parseMes(mesParam)
  const { inicio, fim }           = getMesBounds(ano, mes)

  const supabase = await createClient()

  let query = supabase
    .from('notificacoes_enviadas')
    .select(`
      id, tipo, canal, status, created_at, enviado_em,
      clientes!inner (nome, sobrenome)
    `)
    .gte('created_at', inicio + 'T00:00:00')
    .lte('created_at', fim   + 'T23:59:59')
    .order('created_at', { ascending: false })
    .limit(200)

  if (canal && ['whatsapp', 'email'].includes(canal)) {
    query = query.eq('canal', canal)
  }

  const { data: logs } = await query

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">Log de Notificações</h1>
        <MonthSelector mesParam={param} basePath="/log" />
      </div>

      {/* Filtro de canal */}
      <div className="mb-4 flex gap-2">
        {[
          { label: 'Todos', value: '' },
          { label: 'WhatsApp', value: 'whatsapp' },
          { label: 'E-mail',   value: 'email' },
        ].map(f => (
          <a
            key={f.value}
            href={`/log?mes=${param}${f.value ? `&canal=${f.value}` : ''}`}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              (canal ?? '') === f.value
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.label}
          </a>
        ))}
      </div>

      {!logs?.length ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center">
          <p className="text-sm text-muted-foreground">Nenhuma notificação neste período.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                {['Cliente', 'Tipo', 'Canal', 'Status', 'Data'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(logs ?? []).map((l: any) => {
                const cli = l.clientes
                return (
                  <tr key={l.id} className="bg-card hover:bg-accent/20">
                    <td className="px-4 py-3 text-foreground">{cli?.nome} {cli?.sobrenome}</td>
                    <td className="px-4 py-3 text-muted-foreground">{TIPO_LABEL[l.tipo] ?? l.tipo}</td>
                    <td className="px-4 py-3 text-muted-foreground">{CANAL_LABEL[l.canal] ?? l.canal}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[l.status] ?? 'bg-muted text-muted-foreground'}`}>
                        {l.status}
                      </span>
                    </td>
                    <td className="monetary px-4 py-3 text-muted-foreground">{formatData(l.enviado_em ?? l.created_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
