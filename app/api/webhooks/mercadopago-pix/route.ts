// Webhook do Mercado Pago para PIX de cobrança do CLIENTE FINAL (cada conta usa a própria conta
// Mercado Pago). Separado de /api/mercadopago/webhook, que trata a assinatura do SaaS.
//
// URL ÚNICA e fixa: a Orders API (usada para criar o PIX, ver lib/mercadopago/pix.ts) não aceita
// notification_url por requisição — o Mercado Pago só chama a URL configurada no painel do PRÓPRIO
// app de cada conta ("Suas integrações" → Webhooks). Por isso a notificação não carrega conta_id
// nenhum: o tenant é achado pelo id da ORDEM (globalmente único, atribuído pelo Mercado Pago) em
// cobrancas_pix.txid — nunca confiar em nada do payload antes de achar esse registro (mesmo
// princípio de app/api/webhooks/efibank).
//
// Autenticação: assinatura x-signature (HMAC-SHA256 do manifest oficial do Mercado Pago), validada
// com a Secret Key DAQUELA conta (webhook_secret, obtido no painel dela) — só depois de achar a
// conta pelo id da ordem é que sabemos qual segredo usar. Além da assinatura, o pagamento é sempre
// reconsultado na API antes de dar baixa (nunca confiar só no payload).
import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { baixarPixPago, type ResultadoPix } from '@/lib/pagamentos/baixa-pix'
import { getMpCreds, getMpWebhookSecret, mpRequest } from '@/lib/mercadopago/client'

const LOG = '[webhook/mercadopago-pix]'

type Supabase = ReturnType<typeof createAdminClient>

function assinaturaValida(segredo: string, orderId: string, xSignature: string, xRequestId: string): boolean {
  const [tsParte, v1Parte] = xSignature.split(',').map(p => p.trim())
  const ts = tsParte?.split('=')[1]
  const v1 = v1Parte?.split('=')[1]
  if (!ts || !v1) return false

  const manifest = `id:${orderId.toLowerCase()};request-id:${xRequestId};ts:${ts};`
  const hashCalculado = createHmac('sha256', segredo).update(manifest).digest('hex')

  const bufCalculado = Buffer.from(hashCalculado, 'hex')
  const bufRecebido  = Buffer.from(v1, 'hex')
  return bufCalculado.length === bufRecebido.length && timingSafeEqual(bufCalculado, bufRecebido)
}

export async function POST(req: NextRequest) {
  const orderId    = req.nextUrl.searchParams.get('data.id')
  const xSignature = req.headers.get('x-signature')
  const xRequestId = req.headers.get('x-request-id')
  if (!orderId || !xSignature || !xRequestId) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  try {
    const resultado = await processarNotificacao(createAdminClient(), orderId, xSignature, xRequestId)
    if (resultado === 'invalido') return NextResponse.json({ ok: false }, { status: 401 })
    // 5xx faz o Mercado Pago reenviar; a baixa é idempotente, reenviar é seguro.
    return resultado === 'tentar_de_novo'
      ? NextResponse.json({ ok: false }, { status: 500 })
      : NextResponse.json({ ok: true })
  } catch (err) {
    console.error(`${LOG} erro inesperado`, { orderId, err })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

async function processarNotificacao(
  supabase: Supabase, orderId: string, xSignature: string, xRequestId: string,
): Promise<ResultadoPix | 'invalido'> {
  // Só cobranças PIX criadas por nós, deste provedor. A busca é GLOBAL (sem conta_id — ainda não
  // sabemos de qual conta é) porque o id da ordem é único no Mercado Pago inteiro.
  const { data: cobPix, error: cobPixErr } = await supabase
    .from('cobrancas_pix')
    .select('id, conta_id, parcela_id, status')
    .eq('provedor', 'mercadopago')
    .eq('txid', orderId)
    .maybeSingle()

  if (cobPixErr) {
    console.error(`${LOG} leitura de cobrancas_pix falhou`, { orderId, cobPixErr })
    return 'tentar_de_novo'
  }
  // Não é necessariamente um ataque — o dashboard do Mercado Pago manda notificação de teste
  // ("simular") com IDs fictícios. 200 pra eles não ficarem reenviando pra sempre.
  if (!cobPix) { console.warn(`${LOG} ordem não encontrada:`, orderId); return 'ignorado' }
  if (cobPix.status === 'concluida') return 'ignorado'

  const contaId = cobPix.conta_id

  let segredo: string | null
  let creds
  try {
    ;[segredo, creds] = await Promise.all([getMpWebhookSecret(contaId), getMpCreds(contaId)])
  } catch (err) {
    console.error(`${LOG} credenciais ilegíveis`, { contaId, orderId, motivo: err instanceof Error ? err.message : String(err) })
    return 'tentar_de_novo'
  }
  if (!segredo || !creds) {
    console.error(`${LOG} conta sem credenciais completas do Mercado Pago`, { contaId, orderId })
    return 'ignorado'
  }

  if (!assinaturaValida(segredo, orderId, xSignature, xRequestId)) {
    console.error(`${LOG} assinatura inválida`, { contaId, orderId })
    return 'invalido'
  }

  // Nunca confia só na notificação — reconfirma direto na API com o token da conta.
  let res
  try {
    res = await mpRequest(`/v1/orders/${orderId}`, { method: 'GET', token: creds.accessToken })
  } catch (err) {
    console.error(`${LOG} falha de rede ao consultar a ordem`, { contaId, orderId, motivo: err instanceof Error ? err.message : String(err) })
    return 'tentar_de_novo'
  }
  if (res.status >= 500 || res.status === 429) return 'tentar_de_novo'
  if (!res.ok) {
    console.error(`${LOG} consulta da ordem recusada — revisar manualmente`, { contaId, orderId, status: res.status })
    return 'ignorado'
  }

  const ordem = res.data
  if (ordem?.status !== 'processed' || ordem?.status_detail !== 'accredited') return 'ignorado'

  return baixarPixPago(supabase, cobPix, { origem: 'mercadopago', txid: orderId })
}
