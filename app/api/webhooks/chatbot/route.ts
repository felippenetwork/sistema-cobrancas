// Webhook de mensagens recebidas da uazapi — existe só para o chatbot (/chatbot); não há tela de
// conversas. URL registrada por conta em /chatbot ("Ativar robô") e ao conectar o WhatsApp:
//   /api/webhooks/chatbot?conta=<conta_id>&s=<conexoes.webhook_segredo>
//
// Segurança: o segredo é POR CONTA (um vazado não abre as outras) e comparado em tempo
// constante; quando a uazapi manda o token da instância, ele tem de ser o da conta. Sem isso, 401.
// O robô "digita" por segundos antes de responder — a resposta HTTP sai na hora e o
// processamento continua em segundo plano (after(), até maxDuration), como no cron.
import { timingSafeEqual } from 'node:crypto'
import { after, NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { lerMensagemWebhook } from '@/lib/chatbot/webhook'
import { processarMensagem } from '@/lib/chatbot/processar'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
const BUDGET_MS = 270_000

function mesmoSegredo(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function POST(req: NextRequest) {
  const inicio = Date.now()
  const contaId = req.nextUrl.searchParams.get('conta') ?? ''
  const segredo = req.nextUrl.searchParams.get('s') ?? ''
  if (!z.string().uuid().safeParse(contaId).success || !segredo) return NextResponse.json({ ok: false }, { status: 401 })

  const supabase = createAdminClient()
  const { data: conexao, error } = await supabase
    .from('conexoes')
    .select('webhook_segredo, uazapi_instance_token, numero_conectado')
    .eq('conta_id', contaId)
    .maybeSingle()
  if (error) {
    console.error('[webhook/chatbot] leitura da conexão falhou', { contaId, error })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
  if (!conexao?.webhook_segredo || !conexao.uazapi_instance_token || !mesmoSegredo(segredo, conexao.webhook_segredo)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let payload: unknown
  try { payload = await req.json() } catch { return NextResponse.json({ ok: true }) }

  const msg = lerMensagemWebhook(payload)
  if (!msg) return NextResponse.json({ ok: true })
  if (msg.token && !mesmoSegredo(msg.token, conexao.uazapi_instance_token)) {
    console.warn('[webhook/chatbot] token da instância não confere com a conta', { contaId })
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const conta = { contaId, token: conexao.uazapi_instance_token, numeroConectado: conexao.numero_conectado }
  const processar = () => processarMensagem(supabase, conta, msg, { inicio, budgetMs: BUDGET_MS })
  try {
    after(processar)
    return NextResponse.json({ ok: true })
  } catch {
    // after() só lança fora de uma requisição real do Next (teste chamando o handler direto).
    const resultado = await processar()
    return NextResponse.json({ ok: true, resultado })
  }
}
