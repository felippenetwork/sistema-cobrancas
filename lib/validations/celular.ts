// Normalização e validação de celular brasileiro.
// Formato de saída: 55 + DDD(2) + número(8 ou 9 dígitos) = 12 ou 13 dígitos.

export function normalizarCelular(raw: string): string | null {
  const d = raw.replace(/\D/g, '')

  // Com código de país 55
  if (d.startsWith('55')) {
    const rest = d.slice(2)
    if (rest.length === 11 || rest.length === 10) return d  // 55+DDD+9 ou 55+DDD+8
    return null
  }

  // Sem código de país
  if (d.length === 11 || d.length === 10) return '55' + d   // DDD+9 ou DDD+8
  return null
}

export function celularValido(raw: string): boolean {
  return normalizarCelular(raw) !== null
}

// Formata para exibição: 5511999999999 → (11) 99999-9999
export function formatarCelular(normalized: string): string {
  if (normalized.startsWith('55') && normalized.length === 13) {
    const ddd = normalized.slice(2, 4)
    const num = normalized.slice(4)
    return `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`
  }
  if (normalized.startsWith('55') && normalized.length === 12) {
    const ddd = normalized.slice(2, 4)
    const num = normalized.slice(4)
    return `(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`
  }
  return normalized
}

// Máscara visual em tempo real: +55 (11) 99999-9999
// Aceita entrada livre do usuário (parcial ou completa)
export function mascararCelular(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('55') && d.length > 2) d = d.slice(2)
  d = d.slice(0, 11)
  if (d.length === 0)  return ''
  if (d.length <= 2)   return `+55 (${d}`
  if (d.length <= 7)   return `+55 (${d.slice(0, 2)}) ${d.slice(2)}`
  return `+55 (${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
