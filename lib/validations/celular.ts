// DDIs disponíveis para seleção no cadastro de clientes
export const DDIS = [
  { code: '55',  label: '+55',  pais: 'Brasil' },
  { code: '1',   label: '+1',   pais: 'EUA / Canadá' },
  { code: '54',  label: '+54',  pais: 'Argentina' },
  { code: '56',  label: '+56',  pais: 'Chile' },
  { code: '57',  label: '+57',  pais: 'Colômbia' },
  { code: '58',  label: '+58',  pais: 'Venezuela' },
  { code: '51',  label: '+51',  pais: 'Peru' },
  { code: '595', label: '+595', pais: 'Paraguai' },
  { code: '598', label: '+598', pais: 'Uruguai' },
  { code: '34',  label: '+34',  pais: 'Espanha' },
  { code: '351', label: '+351', pais: 'Portugal' },
] as const

export type DdiCode = typeof DDIS[number]['code']

// Normaliza celular. raw = número local digitado (sem DDI), ddi = código do país (só dígitos, ex: "55").
// Retorna string de dígitos completa (DDI + número) ou null se inválido.
export function normalizarCelular(raw: string, ddi: string = '55'): string | null {
  const d = raw.replace(/\D/g, '')

  if (ddi === '55') {
    // Aceita com ou sem DDI (ex: usuário colou número completo)
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d
    if (d.length === 10 || d.length === 11) return '55' + d
    return null
  }

  // Internacional: remove DDI se o usuário colou o número completo
  const semDdi = d.startsWith(ddi) ? d.slice(ddi.length) : d
  if (semDdi.length < 4 || semDdi.length > 15) return null
  return ddi + semDdi
}

export function celularValido(raw: string, ddi: string = '55'): boolean {
  return normalizarCelular(raw, ddi) !== null
}

// Formata para exibição um celular já normalizado (armazenado no banco)
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
  // Para outros DDIs, exibe os dígitos após o código do país
  const sorted = [...DDIS].sort((a, b) => b.code.length - a.code.length)
  for (const ddi of sorted) {
    if (ddi.code !== '55' && normalized.startsWith(ddi.code)) {
      return normalized.slice(ddi.code.length)
    }
  }
  return normalized
}

// Máscara visual em tempo real para o número LOCAL (sem DDI).
// ddi='55' → formato brasileiro: (11) 99999-9999
// outros  → dígitos limitados a 15 sem máscara específica
export function mascararCelular(raw: string, ddi: string = '55'): string {
  let d = raw.replace(/\D/g, '')

  if (ddi === '55') {
    // Remove DDI se o usuário colou o número completo (55 + DDD + número = 12-13 dígitos)
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
    d = d.slice(0, 11)
    if (d.length === 0)  return ''
    if (d.length <= 2)   return `(${d}`
    if (d.length <= 7)   return `(${d.slice(0, 2)}) ${d.slice(2)}`
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  }

  // Internacional: remove DDI se colado junto
  if (d.startsWith(ddi)) d = d.slice(ddi.length)
  return d.slice(0, 15)
}

// Extrai DDI e número local de um celular normalizado (armazenado no banco).
// Testa DDIs mais longos primeiro para evitar match parcial (ex: "595" vs "5").
export function extrairDDI(normalized: string): { ddi: string; numero: string } {
  const sorted = [...DDIS].sort((a, b) => b.code.length - a.code.length)
  for (const ddi of sorted) {
    if (normalized.startsWith(ddi.code)) {
      return { ddi: ddi.code, numero: normalized.slice(ddi.code.length) }
    }
  }
  return { ddi: '55', numero: normalized }
}
