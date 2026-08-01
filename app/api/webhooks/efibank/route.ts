// Webhook EfiBanK — recebe notificação de PIX pago e confirma a parcela
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcularVencimento } from '@/lib/utils/parcelas'
import { enviarWhatsAppImediato } from '@/lib/whatsapp/enviar-imediato'
import { renovarLookDefenseImediato } from '@/lib/lookdefense/renovar-imediato'

export async function POST(req: NextRequest) {
  try {
    // Token de segurança na URL (?token=CRON_SECRET)
    const token = req.nextUrl.searchParams.get('token')
    if (!token || token !== process.env.CRON_SECRET) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    const body    = await req.json()
    const pixList = (body?.pix ?? []) as any[]
    if (!pixList.length) return NextResponse.json({ ok: true })

    const supabase = createAdminClient()
    const db = supabase as any

    for (const pix of pixList) {
      const txid = pix.txid as string | undefined
      if (!txid) continue

      // Localiza a cobrança PIX pelo txid
      const { data: cobPix } = await db
        .from('cobrancas_pix')
        .select('id, conta_id, parcela_id, status')
        .eq('txid', txid)
        .maybeSingle()

      if (!cobPix) { console.warn('[efibank webhook] txid não encontrado:', txid); continue }
      if (cobPix.status === 'concluida') continue

      const contaId   = cobPix.conta_id   as string
      const parcelaId = cobPix.parcela_id as string

      // Marca como concluída antes de baixar (idempotência)
      await db.from('cobrancas_pix')
        .update({ status: 'concluida', pago_em: new Date().toISOString() })
        .eq('id', cobPix.id)

      // Baixa a parcela via RPC
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
      const { data: rpcData, error: rpcErr } = await supabase.rpc('baixar_parcela', {
        p_parcela_id: parcelaId,
        p_conta_id:   contaId,
        p_hoje:       hoje,
      })

      const result       = rpcData as any
      if (rpcErr || !result?.ok) {
        console.error('[efibank webhook] rpc erro:', rpcErr, rpcData)
        continue
      }
      const contaIdFinal = result.conta_id  as string
      const cobrancaId   = result.cobranca_id as string
      const clienteId    = result.cliente_id  as string | null

      if (!clienteId) continue

      // WhatsApp de confirmação
      const { data: cfgNotif } = await supabase
        .from('notificacoes_config')
        .select('ativo_whatsapp')
        .eq('conta_id', contaIdFinal)
        .eq('tipo', 'pagamento_confirmado')
        .maybeSingle()

      if ((cfgNotif as any)?.ativo_whatsapp) {
        const agora = new Date().toISOString()
        const { data: notif } = await supabase.from('notificacoes_enviadas').insert({
          conta_id:      contaIdFinal,
          parcela_id:    parcelaId,
          cobranca_id:   cobrancaId,
          cliente_id:    clienteId,
          tipo:          'pagamento_confirmado' as const,
          canal:         'whatsapp'             as const,
          status:        'fila'                 as const,
          agendado_para: agora,
        }).select('id').single()

        if ((notif as any)?.id) {
          await enviarWhatsAppImediato(contaIdFinal, (notif as any).id, parcelaId, cobrancaId, clienteId, 'pagamento_confirmado')
        }
      }

      // LookDefense
      const { data: cli } = await supabase
        .from('clientes')
        .select('login_externo, tipo_integracao')
        .eq('id', clienteId)
        .maybeSingle()

      if ((cli as any)?.login_externo && (cli as any)?.tipo_integracao) {
        const { data: baixaExt } = await supabase.from('baixas_externas').insert({
          conta_id:        contaIdFinal,
          cliente_id:      clienteId,
          parcela_id:      parcelaId,
          login_externo:   (cli as any).login_externo,
          tipo_integracao: (cli as any).tipo_integracao,
        }).select('id').single()

        if ((baixaExt as any)?.id) {
          await renovarLookDefenseImediato(contaIdFinal, (baixaExt as any).id, (cli as any).login_externo, 0)
        }
      }

      // Gera próxima parcela se cobrança recorrente
      if (result.recorrente) {
        const { data: cob } = await supabase
          .from('cobrancas')
          .select('dia_pagamento, valor_mensalidade')
          .eq('id', cobrancaId)
          .single()

        const { count: abertas } = await supabase
          .from('parcelas')
          .select('*', { count: 'exact', head: true })
          .eq('cobranca_id', cobrancaId)
          .eq('conta_id', contaIdFinal)
          .eq('status', 'aberta')

        if ((abertas ?? 0) === 0 && cob) {
          const { data: ultimas } = await supabase
            .from('parcelas')
            .select('numero, data_vencimento')
            .eq('cobranca_id', cobrancaId)
            .eq('conta_id', contaIdFinal)
            .order('numero', { ascending: false })
            .limit(1)

          if (ultimas?.length) {
            const ultima = ultimas[0]
            const prox   = calcularVencimento(
              new Date((ultima.data_vencimento as string) + 'T12:00:00'),
              cob.dia_pagamento as number,
              1,
            ).toISOString().slice(0, 10)

            await supabase.from('parcelas').insert({
              conta_id:        contaIdFinal,
              cobranca_id:     cobrancaId,
              numero:          (ultima.numero as number) + 1,
              valor:           cob.valor_mensalidade,
              data_vencimento: prox,
              status:          'aberta',
            })
          }
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[webhook/efibank]', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
