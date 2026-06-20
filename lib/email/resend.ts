import { Resend } from 'resend'

// Cliente Resend — usado no servidor (Server Actions, Route Handlers, worker).
// NUNCA importar em 'use client'. RESEND_API_KEY fica apenas no servidor.
export const resend = new Resend(process.env.RESEND_API_KEY)

/** Monta o endereço remetente: {local_part}@{dominio_operador} */
export function montarRemetente(localPart: string, dominio: string, fromName?: string | null): string {
  const addr = `${localPart}@${dominio}`
  return fromName ? `${fromName} <${addr}>` : addr
}
