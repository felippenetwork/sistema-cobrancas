import type { NextRequest } from 'next/server'

/**
 * Autoriza chamadas às rotas /api/cron/*. Sem CRON_SECRET configurado a
 * resposta é NÃO — comparar com `Bearer ${process.env.CRON_SECRET}` cru aceita
 * "Bearer undefined", e `if (secret && ...)` deixa a rota aberta para todos.
 */
export function cronAutorizado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET não configurado — recusando requisição.')
    return false
  }
  return req.headers.get('authorization') === `Bearer ${secret}`
}
