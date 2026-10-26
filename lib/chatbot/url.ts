// URL do webhook de mensagens da conta (registrada na uazapi pelo /chatbot e ao conectar).
export function urlDoWebhook(contaId: string, segredo: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (!base) return null
  return `${base}/api/webhooks/chatbot?conta=${contaId}&s=${segredo}`
}
