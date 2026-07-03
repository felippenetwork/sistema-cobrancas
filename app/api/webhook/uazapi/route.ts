import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Recebe eventos de conexão da uazapi e atualiza a tabela conexoes.
// uazapi envia: connection.update, qrcode.updated, etc.

export async function POST(req: NextRequest) {
  // Valida segredo compartilhado (configurar UAZAPI_WEBHOOK_SECRET na Vercel e
  // incluir ?secret=TOKEN na URL do webhook registrada na uazapi)
  const webhookSecret = process.env.UAZAPI_WEBHOOK_SECRET
  if (webhookSecret) {
    const incoming = req.nextUrl.searchParams.get('secret')
      ?? req.headers.get('x-webhook-secret')
    if (incoming !== webhookSecret) {
      console.warn('[webhook/uazapi] segredo inválido')
      return NextResponse.json({ ok: false }, { status: 401 })
    }
  }

  try {
    const payload = await req.json() as Record<string, unknown>

    const event = ((payload.event || payload.Event || '') as string).toLowerCase()

    // Ignora eventos que não são de conexão
    if (!event.includes('connection') && !event.includes('qrcode')) {
      return NextResponse.json({ ok: true })
    }

    // O token da instância vem no header ou no body
    const instanceToken =
      req.headers.get('token') ||
      req.headers.get('apikey') ||
      (payload.token as string) ||
      (payload.apikey as string) ||
      ''

    if (!instanceToken) return NextResponse.json({ ok: true })

    const supabase = createAdminClient()

    // Busca a conta pelo token da instância
    const { data: conexao } = await supabase
      .from('conexoes')
      .select('conta_id')
      .eq('uazapi_instance_token', instanceToken)
      .maybeSingle()

    if (!conexao) return NextResponse.json({ ok: true })

    const contaId = conexao.conta_id as string

    // Extrai dados do payload
    const data     = (payload.data || payload.Data || payload) as Record<string, unknown>
    const instance = (data.instance || data.Instance || data) as Record<string, unknown>
    const connected = Boolean(data.connected ?? data.Connected ?? instance.connected)
    const qrcode    = (instance.qrcode || instance.QRCode || instance.qr || '') as string
    const owner     = (instance.owner || instance.Owner || '') as string

    if (connected) {
      const phone = owner
        ? owner.replace('@s.whatsapp.net', '').replace(/\D/g, '')
        : null

      await supabase.from('conexoes').update({
        status:           'conectado',
        qr_code:          null,
        numero_conectado: phone,
        ultima_conexao:   new Date().toISOString(),
      }).eq('conta_id', contaId)

    } else if (qrcode) {
      await supabase.from('conexoes').update({
        status:  'conectando',
        qr_code: qrcode,
      }).eq('conta_id', contaId)

    } else {
      // Desconectado sem QR
      await supabase.from('conexoes').update({
        status:  'desconectado',
        qr_code: null,
      }).eq('conta_id', contaId)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[webhook/uazapi]', err)
    return NextResponse.json({ ok: true })
  }
}
