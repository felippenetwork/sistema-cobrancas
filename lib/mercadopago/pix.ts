import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { PIX_EXPIRACAO_SEG, type PixGerado } from '@/lib/pagamentos/tipos'
import { getMpCreds, mpRequest, type MpCreds, type MpResposta } from './client'

// Orders API (POST/GET /v1/orders) — confirmada em integração irmã (ERP-Rifas Clube do Churrasco)
// contra o sandbox e a produção reais do Mercado Pago em 2026-08-29/09-05, não adivinhada. Formato
// diferente da API clássica de Pagamentos: `total_amount`, `transactions.payments[]`, e o status de
// pago é `processed`/`accredited` (não `approved`). O código PIX vem em
// transactions.payments[0].payment_method.qr_code.

type Supabase = ReturnType<typeof createAdminClient>

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// O Mercado Pago exige e-mail do pagador (só precisa ter formato válido, não existir de verdade).
// Cliente sem e-mail válido usa um endereço sintético, único por cliente, do domínio da plataforma.
function emailDoPagador(email: string | null, clienteId: string | null): string {
  if (email && EMAIL_REGEX.test(email)) return email
  return `pagador+${(clienteId ?? 'sem-cliente').slice(0, 8)}@cobranx.site`
}

async function buscarPagador(supabase: Supabase, contaId: string, parcelaId: string) {
  const semPagador = { clienteId: null, email: null }

  const { data: parcela, error: e1 } = await supabase
    .from('parcelas').select('cobranca_id').eq('id', parcelaId).eq('conta_id', contaId).maybeSingle()
  if (e1 || !parcela) { if (e1) console.error('[criarCobrancaPixMercadoPago] parcela', { contaId, parcelaId, e1 }); return semPagador }

  const { data: cobranca, error: e2 } = await supabase
    .from('cobrancas').select('cliente_id').eq('id', parcela.cobranca_id).eq('conta_id', contaId).maybeSingle()
  if (e2 || !cobranca) { if (e2) console.error('[criarCobrancaPixMercadoPago] cobranca', { contaId, parcelaId, e2 }); return semPagador }

  const { data: cliente, error: e3 } = await supabase
    .from('clientes').select('email').eq('id', cobranca.cliente_id).eq('conta_id', contaId).maybeSingle()
  if (e3) console.error('[criarCobrancaPixMercadoPago] cliente', { contaId, parcelaId, e3 })

  return { clienteId: cobranca.cliente_id as string, email: cliente?.email ?? null }
}

function mensagemDeErro(res: MpResposta): string {
  if (/invalid_email_for_sandbox/i.test(JSON.stringify(res.data ?? ''))) {
    return 'E-mail do pagador recusado pelo ambiente de testes do Mercado Pago.'
  }
  if (res.status === 401 || res.status === 403) {
    return 'Access Token do Mercado Pago inválido ou sem permissão. Atualize em Configurações → Mercado Pago (PIX).'
  }
  return `Erro ao criar cobrança PIX no Mercado Pago (HTTP ${res.status}). Verifique as credenciais.`
}

export async function criarCobrancaPixMercadoPago(
  contaId:    string,
  parcelaId:  string,
  valor:      number,
  descricao?: string,
): Promise<PixGerado | { erro: string }> {
  let creds: MpCreds | null
  try {
    creds = await getMpCreds(contaId)
  } catch (err) {
    console.error('[criarCobrancaPixMercadoPago] credenciais ilegíveis', { contaId, motivo: err instanceof Error ? err.message : String(err) })
    return { erro: 'Não foi possível ler as credenciais do Mercado Pago. Salve o Access Token de novo em Configurações.' }
  }
  if (!creds) return { erro: 'Mercado Pago não configurado. Acesse Configurações → Mercado Pago (PIX).' }

  const supabase = createAdminClient()

  // Reutiliza cobrança ativa, não expirada, deste provedor e com o mesmo valor (parcela editada gera outro PIX)
  const { data: existing, error: existingErr } = await supabase
    .from('cobrancas_pix')
    .select('txid, pix_copia_cola, qr_code_base64, link_pagamento, expira_em')
    .eq('conta_id', contaId)
    .eq('parcela_id', parcelaId)
    .eq('provedor', 'mercadopago')
    .eq('status', 'ativa')
    .eq('valor', valor)
    .gt('expira_em', new Date().toISOString())
    .maybeSingle()

  if (existingErr) {
    console.error('[criarCobrancaPixMercadoPago] leitura de cobrancas_pix falhou', { contaId, parcelaId, existingErr })
    return { erro: 'Não foi possível consultar as cobranças PIX. Tente novamente.' }
  }
  if (existing?.pix_copia_cola && existing.expira_em) {
    return {
      txid:          existing.txid,
      pixCopiaCola:  existing.pix_copia_cola,
      qrCodeBase64:  existing.qr_code_base64 ?? null,
      linkPagamento: existing.link_pagamento ?? null,
      expiraEm:      existing.expira_em,
    }
  }

  const pagador = await buscarPagador(supabase, contaId, parcelaId)
  const valorFmt = valor.toFixed(2)

  let res: MpResposta
  try {
    res = await mpRequest('/v1/orders', {
      method: 'POST',
      token: creds.accessToken,
      idempotencyKey: randomUUID(),
      body: {
        type: 'online',
        total_amount: valorFmt,
        external_reference: parcelaId,
        processing_mode: 'automatic',
        transactions: {
          payments: [{ amount: valorFmt, payment_method: { id: 'pix', type: 'bank_transfer' } }],
        },
        payer: { email: emailDoPagador(pagador.email, pagador.clienteId) },
      },
    })
  } catch (err) {
    console.error('[criarCobrancaPixMercadoPago] falha de rede', { contaId, parcelaId, motivo: err instanceof Error ? err.message : String(err) })
    return { erro: 'Não foi possível falar com o Mercado Pago. Tente novamente.' }
  }

  if (!res.ok) {
    console.error('[criarCobrancaPixMercadoPago] recusado', { contaId, parcelaId, status: res.status, dados: res.data })
    return { erro: mensagemDeErro(res) }
  }

  const ordem = res.data
  const pagamento = ordem?.transactions?.payments?.[0]
  const pixCopiaCola: string | undefined = pagamento?.payment_method?.qr_code
  if (ordem?.id == null || !pixCopiaCola) {
    console.error('[criarCobrancaPixMercadoPago] resposta sem código PIX', { contaId, parcelaId, status: res.status })
    return { erro: 'Não foi possível obter o código PIX. Tente novamente.' }
  }

  const txid          = String(ordem.id)
  const qrCodeBase64  = (pagamento.payment_method.qr_code_base64 as string | undefined) ?? null
  const expiraMp      = pagamento.date_of_expiration ? new Date(pagamento.date_of_expiration) : null
  const expiraFallback = new Date(Date.now() + PIX_EXPIRACAO_SEG * 1000)
  const expiraEm      = (expiraMp && !Number.isNaN(expiraMp.getTime()) ? expiraMp : expiraFallback).toISOString()

  // Sem a linha em cobrancas_pix o webhook não acha o pagamento e ele ficaria sem baixa —
  // então um PIX que não foi gravado NÃO pode ser entregue.
  const { error: persistErr } = await supabase.from('cobrancas_pix').upsert({
    conta_id:       contaId,
    parcela_id:     parcelaId,
    provedor:       'mercadopago',
    txid,
    valor,
    status:         'ativa',
    pix_copia_cola: pixCopiaCola,
    qr_code_base64: qrCodeBase64,
    link_pagamento: null,
    expira_em:      expiraEm,
  }, { onConflict: 'conta_id,txid' })

  if (persistErr) {
    console.error('[criarCobrancaPixMercadoPago] falha ao gravar cobrança PIX — código NÃO entregue', { contaId, parcelaId, txid, persistErr })
    return { erro: 'Não foi possível registrar a cobrança PIX. Tente novamente.' }
  }

  return { txid, pixCopiaCola, qrCodeBase64, linkPagamento: null, expiraEm }
}
