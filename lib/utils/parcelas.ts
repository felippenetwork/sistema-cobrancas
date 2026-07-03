// Cálculo de vencimentos e status visual de parcelas.
// REGRA (A1): dia_pagamento prevalece sempre. Se o dia não existir no mês,
// usa o último dia do mês. "Vencida" nunca é gravada no banco — é computada
// na query como status='aberta' AND data_vencimento < current_date (A2).

/**
 * Calcula a data de vencimento de uma parcela dado o mês/ano de início
 * e um deslocamento em meses.
 */
export function calcularVencimento(
  mesAnoInicio: Date,  // apenas mês/ano importa (dia é ignorado)
  diaPagamento: number,
  offsetMeses: number,
): Date {
  const mesBase = mesAnoInicio.getMonth() + offsetMeses // pode ultrapassar 11
  const ano     = mesAnoInicio.getFullYear() + Math.floor(mesBase / 12)
  const mes     = ((mesBase % 12) + 12) % 12  // normaliza para 0–11

  // último dia do mês alvo — trata 31 em fevereiro, etc.
  const ultimoDia = new Date(ano, mes + 1, 0).getDate()
  const dia       = Math.min(diaPagamento, ultimoDia)

  return new Date(ano, mes, dia)
}

/**
 * Gera os registros de parcelas para uma cobrança de parcelas fixas.
 */
export function gerarParcelasFixas(
  cobrancaId: string,
  contaId: string,
  mesAnoInicio: Date,
  diaPagamento: number,
  valorMensalidade: number,
  qtdParcelas: number,
) {
  return Array.from({ length: qtdParcelas }, (_, i) => ({
    conta_id:        contaId,
    cobranca_id:     cobrancaId,
    numero:          i + 1,
    valor:           valorMensalidade,
    data_vencimento: calcularVencimento(mesAnoInicio, diaPagamento, i)
      .toISOString()
      .slice(0, 10),
    status: 'aberta' as const,
  }))
}

/**
 * Gera as parcelas iniciais de uma cobrança recorrente.
 * Sprint 4: cria 3 para cobertura inicial.
 * Sprint 8 (scheduler): mantém sempre 1 parcela aberta à frente por data.
 * ⚠️ PROIBIDO gerar parcelas recorrentes "ao dar baixa" — quebra os lembretes.
 */
export function gerarParcelasRecorrentes(
  cobrancaId: string,
  contaId: string,
  mesAnoInicio: Date,
  diaPagamento: number,
  valorMensalidade: number,
  qtdIniciais = 3,
) {
  return gerarParcelasFixas(
    cobrancaId,
    contaId,
    mesAnoInicio,
    diaPagamento,
    valorMensalidade,
    qtdIniciais,
  )
}

// ── Status visual (§5 regras-financeiras) ────────────────────────────────────

export type StatusVisual = 'em_dia' | 'vence_hoje' | 'vencido'

/**
 * Calcula o status visual de uma parcela com base na data de vencimento.
 * Fuso: America/Sao_Paulo (UTC-3). "Vencida" é computada, nunca gravada no banco.
 */
export function calcularStatusVisual(dataVencimento: string): StatusVisual {
  // Força meia-noite no horário local de SP para evitar drift de timezone
  const hoje = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
  )
  hoje.setHours(0, 0, 0, 0)

  const venc = new Date(dataVencimento + 'T00:00:00')

  if (venc < hoje)                              return 'vencido'
  if (venc.getTime() === hoje.getTime())        return 'vence_hoje'
  return 'em_dia'
}

export const STATUS_VISUAL_CFG = {
  em_dia:     { label: 'Em dia',     cls: 'bg-success-bg text-success border border-success-border' },
  vence_hoje: { label: 'Vence hoje', cls: 'bg-warning-bg text-warning border border-warning-border' },
  vencido:    { label: 'Vencido',    cls: 'bg-destructive-bg text-destructive border border-destructive-border' },
} as const

/**
 * Retorna as badges de status a exibir no card de uma cobrança.
 * §5: se houver simultaneamente 1 vencida E 1 a vencer, mostra as duas.
 */
export function badgesCobranca(parcelasAbertas: { data_vencimento: string }[]) {
  const statuses = [...new Set(parcelasAbertas.map(p => calcularStatusVisual(p.data_vencimento)))]
  return statuses.map(s => STATUS_VISUAL_CFG[s])
}
