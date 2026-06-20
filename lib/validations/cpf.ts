// Validação de CPF brasileiro — dígito verificador completo.
// Rejeita sequências de dígitos iguais (000...0, 111...1 etc.)

export function validarCPF(raw: string): boolean {
  const d = raw.replace(/\D/g, '')

  if (d.length !== 11) return false
  if (/^(\d)\1+$/.test(d)) return false  // todos iguais

  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i)
  let rem = (sum * 10) % 11
  if (rem === 10 || rem === 11) rem = 0
  if (rem !== parseInt(d[9])) return false

  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i)
  rem = (sum * 10) % 11
  if (rem === 10 || rem === 11) rem = 0
  return rem === parseInt(d[10])
}

// Normaliza para somente dígitos
export function normalizarCPF(raw: string): string {
  return raw.replace(/\D/g, '')
}

// Formata para exibição: 529.982.247-25
export function formatarCPF(digits: string): string {
  const d = digits.replace(/\D/g, '')
  if (d.length !== 11) return digits
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}
