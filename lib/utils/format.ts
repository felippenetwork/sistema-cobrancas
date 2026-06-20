// Formatação de valores monetários e datas em pt-BR.
// Sempre usar para exibição — nunca usar float diretamente em cálculos.

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' })

/** Formata número para R$ 1.234,56 */
export function formatBRL(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value
  return brl.format(isNaN(num) ? 0 : num)
}

/** Soma array de valores do Supabase (retornados como string por numeric(12,2)) */
export function somarValores(items: { valor: unknown }[]): number {
  return items.reduce((acc, i) => acc + parseFloat(String(i.valor ?? 0)), 0)
}

/** Formata data ISO (YYYY-MM-DD) para dd/mm/aaaa */
export function formatData(iso: string | null | undefined): string {
  if (!iso) return '—'
  return dFmt.format(new Date(iso.slice(0, 10) + 'T12:00:00'))
}

const MESES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
]

/** Formata "2026-06" → "Junho 2026" */
export function formatMesAno(mesParam: string): string {
  const [ano, mes] = mesParam.split('-').map(Number)
  return `${MESES[mes - 1]} ${ano}`
}
