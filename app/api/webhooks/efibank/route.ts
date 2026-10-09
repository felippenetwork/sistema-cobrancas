// Webhook EfiBanK — recebe notificação de PIX pago e confirma a parcela.
// A regra de baixa (ordem, idempotência, próxima parcela recorrente) é comum aos provedores
// de PIX e vive em lib/pagamentos/baixa-pix.ts (PAG-N1: a baixa roda ANTES de encerrar a
// cobrança PIX; falha transitória responde 500 para a EfiBank reenviar).
import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { baixarPixPago, type ResultadoPix } from '@/lib/pagamentos/baixa-pix'

type Supabase = ReturnType<typeof createAdminClient>

// EFIBANK_WEBHOOK_SECRET é o segredo próprio deste webhook. Sem ele cai no CRON_SECRET
// (legado) — o token vai na URL cadastrada na EfiBank e aparece em logs de acesso, então
// um segredo dedicado evita que esse vazamento comprometa também os crons internos.
function tokenValido(recebido: string | null): boolean {
  const esperado = process.env.EFIBANK_WEBHOOK_SECRET || process.env.CRON_SECRET
  if (!esperado || !recebido) return false
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!tokenValido(req.nextUrl.searchParams.get('token'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: { pix?: { txid?: string }[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const pixList = body?.pix ?? []
  if (!pixList.length) return NextResponse.json({ ok: true })

  const supabase = createAdminClient()
  let tentarDeNovo = false

  for (const pix of pixList) {
    if (!pix.txid) continue
    try {
      if (await processarPix(supabase, pix.txid) === 'tentar_de_novo') tentarDeNovo = true
    } catch (err) {
      console.error('[webhook/efibank] erro inesperado', { txid: pix.txid, err })
      tentarDeNovo = true
    }
  }

  // 5xx faz a EfiBank reenviar a notificação; a baixa é idempotente, reenviar é seguro.
  return tentarDeNovo
    ? NextResponse.json({ ok: false }, { status: 500 })
    : NextResponse.json({ ok: true })
}

async function processarPix(supabase: Supabase, txid: string): Promise<ResultadoPix> {
  // Localiza a cobrança PIX pelo txid
  const { data: cobPix, error: cobPixErr } = await supabase
    .from('cobrancas_pix')
    .select('id, conta_id, parcela_id, status')
    .eq('txid', txid)
    .maybeSingle()

  if (cobPixErr) {
    console.error('[webhook/efibank] leitura de cobrancas_pix falhou', { txid, cobPixErr })
    return 'tentar_de_novo'
  }
  if (!cobPix) { console.warn('[webhook/efibank] txid não encontrado:', txid); return 'ignorado' }

  return baixarPixPago(supabase, cobPix, { origem: 'efibank', txid })
}
