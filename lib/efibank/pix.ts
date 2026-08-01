import { createAdminClient } from '@/lib/supabase/admin'
import { getEfiCreds, getEfiToken, efiAuthRequest, efiBaseUrl } from './client'

export type PixGerado = {
  txid:          string
  pixCopiaCola:  string
  qrCodeBase64:  string | null
  linkPagamento: string | null
  expiraEm:      string
}

const EXPIRACAO_SEG = 3600 // 1h

export async function criarCobrancaPix(
  contaId:   string,
  parcelaId: string,
  valor:     number,
  descricao?: string,
): Promise<PixGerado | { erro: string }> {
  const creds = await getEfiCreds(contaId)
  if (!creds) return { erro: 'EfiBanK não configurado. Acesse Configurações → EfiBanK PIX.' }

  const supabase = createAdminClient()
  const db = supabase as any

  // Reutiliza cobrança ativa não expirada
  const { data: existing } = await db
    .from('cobrancas_pix')
    .select('txid, pix_copia_cola, qr_code_base64, link_pagamento, expira_em')
    .eq('conta_id', contaId)
    .eq('parcela_id', parcelaId)
    .eq('status', 'ativa')
    .gt('expira_em', new Date().toISOString())
    .maybeSingle()

  if (existing && (existing as any).pix_copia_cola) {
    const e = existing as any
    return {
      txid:          e.txid,
      pixCopiaCola:  e.pix_copia_cola,
      qrCodeBase64:  e.qr_code_base64   ?? null,
      linkPagamento: e.link_pagamento    ?? null,
      expiraEm:      e.expira_em,
    }
  }

  try {
    const token   = await getEfiToken(creds)
    const base    = efiBaseUrl(creds.sandbox)
    const valorFmt = valor.toFixed(2)
    const expiraEm = new Date(Date.now() + EXPIRACAO_SEG * 1000).toISOString()

    // Cria cobrança imediata
    const cobRes = await efiAuthRequest(`${base}/v2/cob`, 'POST', {
      calendario: { expiracao: EXPIRACAO_SEG },
      valor:      { original: valorFmt },
      chave:      creds.pixKey,
      solicitacaoPagador: (descricao ?? 'Pagamento de mensalidade').slice(0, 140),
    }, creds, token)

    if (!cobRes.ok) {
      console.error('[criarCobrancaPix] cob', cobRes.status, cobRes.data)
      return { erro: `Erro ao criar cobrança PIX (${cobRes.status}). Verifique as credenciais.` }
    }

    const cob: any       = cobRes.data
    const txid: string   = cob.txid
    const locId: number  = cob.loc?.id

    // pixCopiaECola pode vir direto na resposta do cob
    let pixCopiaCola: string    = cob.pixCopiaECola ?? ''
    let qrCodeBase64: string | null = null
    let linkPagamento: string | null = null

    // Se não veio, busca via /v2/loc/{id}/qrcode
    if (!pixCopiaCola && locId) {
      const qrRes = await efiAuthRequest(`${base}/v2/loc/${locId}/qrcode`, 'GET', undefined, creds, token)
      if (qrRes.ok) {
        pixCopiaCola  = qrRes.data.qrcode          ?? ''
        qrCodeBase64  = qrRes.data.imagemQrcode    ?? null
        linkPagamento = qrRes.data.linkVisualizacao ?? null
      }
    }

    if (!pixCopiaCola) return { erro: 'Não foi possível obter o código PIX. Tente novamente.' }

    // Persiste
    await db.from('cobrancas_pix').upsert({
      conta_id:       contaId,
      parcela_id:     parcelaId,
      txid,
      valor,
      status:         'ativa',
      pix_copia_cola: pixCopiaCola,
      qr_code_base64: qrCodeBase64,
      link_pagamento: linkPagamento,
      expira_em:      expiraEm,
    } as any, { onConflict: 'conta_id,txid' })

    return { txid, pixCopiaCola, qrCodeBase64, linkPagamento, expiraEm }
  } catch (err: any) {
    console.error('[criarCobrancaPix]', err?.message)
    return { erro: err?.message ?? 'Erro desconhecido ao criar cobrança PIX.' }
  }
}
