// Utilitários compartilhados de mês — usados no Dashboard, Cobranças e Caixa.

/**
 * Interpreta o parâmetro de URL `?mes=YYYY-MM`.
 * Se inválido ou ausente, retorna o mês corrente.
 */
export function parseMes(mes?: string): { ano: number; mes: number; param: string } {
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [ano, m] = mes.split('-').map(Number)
    if (m >= 1 && m <= 12) return { ano, mes: m, param: mes }
  }
  const now = new Date()
  const ano = now.getFullYear()
  const m   = now.getMonth() + 1
  return { ano, mes: m, param: `${ano}-${String(m).padStart(2, '0')}` }
}

/**
 * Retorna primeiro e último dia do mês no formato YYYY-MM-DD.
 */
export function getMesBounds(ano: number, mes: number) {
  const pad   = String(mes).padStart(2, '0')
  const inicio = `${ano}-${pad}-01`
  const fim    = new Date(ano, mes, 0).toISOString().slice(0, 10)
  return { inicio, fim }
}
