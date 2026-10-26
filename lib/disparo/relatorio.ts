// Relatório de um disparo (/disparos → "Relatório"): rótulos, resumo e a planilha CSV.
// Puro, testado em tests/disparo-relatorio.test.ts.

export type LinhaRelatorio = {
  nome: string | null
  celular: string
  status: string
  enviado_em: string | null
  erro: string | null
  aviso: string | null
}

export const ROTULO_STATUS: Record<string, string> = {
  enviado: 'Enviado',
  falhou: 'Falhou',
  pulado: 'Pulado',
  pendente: 'Não enviado',
}

export function resumoRelatorio(linhas: LinhaRelatorio[]) {
  const conta = (s: string) => linhas.filter(l => l.status === s).length
  const horarios = linhas.map(l => l.enviado_em).filter((h): h is string => !!h).sort()
  return {
    total: linhas.length,
    enviados: conta('enviado'),
    falharam: conta('falhou'),
    pulados: conta('pulado'),
    naoEnviados: conta('pendente'),
    comAviso: linhas.filter(l => l.status === 'enviado' && l.aviso).length,
    primeiro: horarios[0] ?? null,
    ultimo: horarios[horarios.length - 1] ?? null,
  }
}

const dataHoraSP = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * Célula do CSV: aspas quando precisa e, contra injeção de fórmula no Excel, um apóstrofo antes
 * de texto que começa com = + - @ (um nome "=HYPERLINK(…)" não vira fórmula).
 */
function celula(valor: string): string {
  const seguro = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor
  return /[;"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}

/** "5521999990001" → "55 21 99999-0001" (o Excel lê como texto, sem virar 5,52E+12). */
export function celularLegivel(c: string): string {
  const m = c.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/)
  return m ? `${m[1]} ${m[2]} ${m[3]}-${m[4]}` : c
}

/** Planilha do relatório: ";" como separador e BOM, para o Excel em português abrir certo. */
export function relatorioCsv(linhas: LinhaRelatorio[]): string {
  const cabecalho = ['Nome', 'Número', 'Situação', 'Enviado em', 'Motivo', 'Avisos']
  const corpo = linhas.map(l => [
    l.nome ?? '',
    celularLegivel(l.celular),
    ROTULO_STATUS[l.status] ?? l.status,
    l.enviado_em ? dataHoraSP(l.enviado_em) : '',
    l.status === 'enviado' ? '' : l.erro ?? '',
    l.aviso ?? '',
  ].map(celula).join(';'))
  return '\uFEFF' + [cabecalho.join(';'), ...corpo].join('\r\n')
}
