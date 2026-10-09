export const PIX_PROVEDORES = ['efibank', 'mercadopago'] as const
export type PixProvedor = (typeof PIX_PROVEDORES)[number]

export type PixGerado = {
  txid:          string
  pixCopiaCola:  string
  qrCodeBase64:  string | null
  linkPagamento: string | null
  expiraEm:      string
}

// Tempo de vida do PIX gerado (o Mercado Pago aceita de 30 min a 30 dias).
export const PIX_EXPIRACAO_SEG = 3600
