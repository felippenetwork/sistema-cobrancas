/**
 * Testes unitários das funções utilitárias puras.
 * Sem I/O, sem Supabase — apenas lógica de negócio.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  calcularVencimento,
  gerarParcelasFixas,
  calcularStatusVisual,
  badgesCobranca,
} from '@/lib/utils/parcelas'
import { substituirVariaveis } from '@/lib/utils/variaveis'
import { parseMes, getMesBounds } from '@/lib/utils/mes'
import { formatBRL, somarValores, formatData, formatMesAno } from '@/lib/utils/format'

// ── calcularVencimento ───────────────────────────────────────────────────────

describe('calcularVencimento', () => {
  it('retorna o dia exato quando existe no mês alvo', () => {
    const inicio = new Date(2025, 0, 1) // jan 2025
    const result = calcularVencimento(inicio, 15, 0)
    expect(result.getFullYear()).toBe(2025)
    expect(result.getMonth()).toBe(0)     // janeiro
    expect(result.getDate()).toBe(15)
  })

  it('avança meses pelo offset', () => {
    const inicio = new Date(2025, 0, 1) // jan 2025
    const result = calcularVencimento(inicio, 10, 2) // março 2025
    expect(result.getMonth()).toBe(2)
    expect(result.getDate()).toBe(10)
  })

  it('cruza virada de ano', () => {
    const inicio = new Date(2025, 11, 1) // dez 2025
    const result = calcularVencimento(inicio, 5, 1) // jan 2026
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(0)
    expect(result.getDate()).toBe(5)
  })

  it('dia 31 em abril → dia 30 (último do mês)', () => {
    const inicio = new Date(2025, 3, 1) // abr 2025
    const result = calcularVencimento(inicio, 31, 0)
    expect(result.getDate()).toBe(30)
  })

  it('dia 31 em fevereiro (ano comum) → dia 28', () => {
    const inicio = new Date(2025, 1, 1) // fev 2025 (não bissexto)
    const result = calcularVencimento(inicio, 31, 0)
    expect(result.getDate()).toBe(28)
  })

  it('dia 31 em fevereiro (ano bissexto) → dia 29', () => {
    const inicio = new Date(2024, 1, 1) // fev 2024 (bissexto)
    const result = calcularVencimento(inicio, 31, 0)
    expect(result.getDate()).toBe(29)
  })

  it('dia 28 em fevereiro não é alterado', () => {
    const inicio = new Date(2025, 1, 1)
    const result = calcularVencimento(inicio, 28, 0)
    expect(result.getDate()).toBe(28)
  })
})

// ── gerarParcelasFixas ───────────────────────────────────────────────────────

describe('gerarParcelasFixas', () => {
  const CONTA   = 'conta-123'
  const COB     = 'cobranca-456'
  const INICIO  = new Date(2025, 0, 1) // jan 2025

  it('gera a quantidade exata de parcelas', () => {
    const result = gerarParcelasFixas(COB, CONTA, INICIO, 10, 150, 6)
    expect(result).toHaveLength(6)
  })

  it('numeração começa em 1 e é sequencial', () => {
    const result = gerarParcelasFixas(COB, CONTA, INICIO, 10, 150, 3)
    expect(result.map(p => p.numero)).toEqual([1, 2, 3])
  })

  it('preenche conta_id e cobranca_id', () => {
    const result = gerarParcelasFixas(COB, CONTA, INICIO, 10, 150, 1)
    expect(result[0].conta_id).toBe(CONTA)
    expect(result[0].cobranca_id).toBe(COB)
  })

  it('valor é o informado em todas as parcelas', () => {
    const result = gerarParcelasFixas(COB, CONTA, INICIO, 10, 199.9, 3)
    expect(result.every(p => p.valor === 199.9)).toBe(true)
  })

  it('status é sempre "aberta"', () => {
    const result = gerarParcelasFixas(COB, CONTA, INICIO, 10, 100, 4)
    expect(result.every(p => p.status === 'aberta')).toBe(true)
  })

  it('datas avançam mês a mês', () => {
    const result = gerarParcelasFixas(COB, CONTA, INICIO, 10, 100, 3)
    expect(result[0].data_vencimento).toBe('2025-01-10')
    expect(result[1].data_vencimento).toBe('2025-02-10')
    expect(result[2].data_vencimento).toBe('2025-03-10')
  })

  it('dia 31 em fevereiro é ajustado para o último dia', () => {
    const result = gerarParcelasFixas(COB, CONTA, INICIO, 31, 100, 2)
    expect(result[0].data_vencimento).toBe('2025-01-31')
    expect(result[1].data_vencimento).toBe('2025-02-28') // fev 2025
  })
})

// ── calcularStatusVisual ─────────────────────────────────────────────────────

describe('calcularStatusVisual', () => {
  beforeEach(() => {
    // Fixa "hoje" em 2025-06-15 (SP = UTC-3; usar hora 12:00 SP para evitar ambiguidade)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15T15:00:00Z')) // 12:00 SP
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('data futura → em_dia', () => {
    expect(calcularStatusVisual('2025-06-20')).toBe('em_dia')
  })

  it('hoje → vence_hoje', () => {
    expect(calcularStatusVisual('2025-06-15')).toBe('vence_hoje')
  })

  it('data passada → vencido', () => {
    expect(calcularStatusVisual('2025-06-10')).toBe('vencido')
  })

  it('dia anterior → vencido', () => {
    expect(calcularStatusVisual('2025-06-14')).toBe('vencido')
  })

  it('dia seguinte → em_dia', () => {
    expect(calcularStatusVisual('2025-06-16')).toBe('em_dia')
  })
})

// ── badgesCobranca ───────────────────────────────────────────────────────────

describe('badgesCobranca', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15T15:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sem parcelas abertas → badges vazio', () => {
    expect(badgesCobranca([])).toHaveLength(0)
  })

  it('só parcelas em dia → 1 badge em_dia', () => {
    const badges = badgesCobranca([
      { data_vencimento: '2025-06-20' },
      { data_vencimento: '2025-07-01' },
    ])
    expect(badges).toHaveLength(1)
    expect(badges[0].label).toBe('Em dia')
  })

  it('parcela vencida + parcela em dia → 2 badges (§5)', () => {
    const badges = badgesCobranca([
      { data_vencimento: '2025-06-01' }, // vencido
      { data_vencimento: '2025-06-20' }, // em dia
    ])
    expect(badges).toHaveLength(2)
    const labels = badges.map(b => b.label)
    expect(labels).toContain('Vencido')
    expect(labels).toContain('Em dia')
  })

  it('deduplicação — dois vencidos → 1 badge', () => {
    const badges = badgesCobranca([
      { data_vencimento: '2025-06-01' },
      { data_vencimento: '2025-06-05' },
    ])
    expect(badges).toHaveLength(1)
    expect(badges[0].label).toBe('Vencido')
  })
})

// ── substituirVariaveis ──────────────────────────────────────────────────────

describe('substituirVariaveis', () => {
  const vars = {
    valor:        'R$ 150,00',
    nomecompleto: 'João Silva',
    nome:         'João',
    pix:          '00.000.000/0001-00',
    saudacao:     'Olá!',
    vencimento:   '15/06/2025',
  }

  it('substitui todas as variáveis', () => {
    const t = 'Olá #NOME#, seu vencimento é #VENCIMENTO# e o valor é #VALOR#.'
    expect(substituirVariaveis(t, vars)).toBe(
      'Olá João, seu vencimento é 15/06/2025 e o valor é R$ 150,00.',
    )
  })

  it('template sem variáveis fica inalterado', () => {
    const t = 'Mensagem simples sem tags.'
    expect(substituirVariaveis(t, vars)).toBe(t)
  })

  it('substitui múltiplas ocorrências da mesma variável', () => {
    const t = '#NOME# e #NOME# novamente'
    expect(substituirVariaveis(t, vars)).toBe('João e João novamente')
  })

  it('substitui #NOMECOMPLETO# independente de #NOME#', () => {
    const t = '#NOMECOMPLETO# (#NOME#)'
    expect(substituirVariaveis(t, vars)).toBe('João Silva (João)')
  })

  it('substitui #PIX# e #SAUDACAO#', () => {
    const t = '#SAUDACAO# Pix: #PIX#'
    expect(substituirVariaveis(t, vars)).toBe('Olá! Pix: 00.000.000/0001-00')
  })

  it('valor vazio substitui por string vazia', () => {
    const result = substituirVariaveis('#NOME#', { ...vars, nome: '' })
    expect(result).toBe('')
  })
})

// ── parseMes ─────────────────────────────────────────────────────────────────

describe('parseMes', () => {
  it('string válida YYYY-MM é interpretada', () => {
    expect(parseMes('2025-06')).toEqual({ ano: 2025, mes: 6, param: '2025-06' })
  })

  it('mês 1 (janeiro) é válido', () => {
    expect(parseMes('2025-01')).toEqual({ ano: 2025, mes: 1, param: '2025-01' })
  })

  it('mês 12 (dezembro) é válido', () => {
    expect(parseMes('2025-12')).toEqual({ ano: 2025, mes: 12, param: '2025-12' })
  })

  it('undefined → mês atual', () => {
    const now = new Date()
    const { ano, mes } = parseMes(undefined)
    expect(ano).toBe(now.getFullYear())
    expect(mes).toBe(now.getMonth() + 1)
  })

  it('string inválida → mês atual', () => {
    const now = new Date()
    const { ano, mes } = parseMes('invalid')
    expect(ano).toBe(now.getFullYear())
    expect(mes).toBe(now.getMonth() + 1)
  })

  it('mês 13 → inválido → mês atual', () => {
    const now = new Date()
    const { mes } = parseMes('2025-13')
    expect(mes).toBe(now.getMonth() + 1)
  })

  it('mês 0 → inválido → mês atual', () => {
    const now = new Date()
    const { mes } = parseMes('2025-00')
    expect(mes).toBe(now.getMonth() + 1)
  })
})

// ── getMesBounds ─────────────────────────────────────────────────────────────

describe('getMesBounds', () => {
  it('janeiro tem 31 dias', () => {
    expect(getMesBounds(2025, 1)).toEqual({ inicio: '2025-01-01', fim: '2025-01-31' })
  })

  it('fevereiro de ano comum tem 28 dias', () => {
    expect(getMesBounds(2025, 2)).toEqual({ inicio: '2025-02-01', fim: '2025-02-28' })
  })

  it('fevereiro de ano bissexto tem 29 dias', () => {
    expect(getMesBounds(2024, 2)).toEqual({ inicio: '2024-02-01', fim: '2024-02-29' })
  })

  it('abril tem 30 dias', () => {
    expect(getMesBounds(2025, 4)).toEqual({ inicio: '2025-04-01', fim: '2025-04-30' })
  })

  it('dezembro tem 31 dias', () => {
    expect(getMesBounds(2025, 12)).toEqual({ inicio: '2025-12-01', fim: '2025-12-31' })
  })
})

// ── formatBRL ────────────────────────────────────────────────────────────────

describe('formatBRL', () => {
  it('formata inteiro', () => {
    expect(formatBRL(1234)).toBe('R$ 1.234,00')
  })

  it('formata decimal com 2 casas', () => {
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50')
  })

  it('formata zero', () => {
    expect(formatBRL(0)).toBe('R$ 0,00')
  })

  it('aceita string numérica', () => {
    expect(formatBRL('150.00')).toBe('R$ 150,00')
  })

  it('string não numérica → R$ 0,00', () => {
    expect(formatBRL('abc')).toBe('R$ 0,00')
  })
})

// ── somarValores ─────────────────────────────────────────────────────────────

describe('somarValores', () => {
  it('soma array com números', () => {
    expect(somarValores([{ valor: 100 }, { valor: 50 }, { valor: 25 }])).toBe(175)
  })

  it('soma array com strings numéricas (retorno Supabase)', () => {
    expect(somarValores([{ valor: '100.00' }, { valor: '50.50' }])).toBeCloseTo(150.5)
  })

  it('array vazio → 0', () => {
    expect(somarValores([])).toBe(0)
  })

  it('valor null é tratado como 0', () => {
    expect(somarValores([{ valor: null }, { valor: 50 }])).toBe(50)
  })
})

// ── formatData ───────────────────────────────────────────────────────────────

describe('formatData', () => {
  it('null → "—"', () => {
    expect(formatData(null)).toBe('—')
  })

  it('undefined → "—"', () => {
    expect(formatData(undefined)).toBe('—')
  })

  it('YYYY-MM-DD → dd/mm/aaaa', () => {
    expect(formatData('2025-06-15')).toBe('15/06/2025')
  })
})

// ── formatMesAno ─────────────────────────────────────────────────────────────

describe('formatMesAno', () => {
  it('"2026-01" → "Janeiro 2026"', () => {
    expect(formatMesAno('2026-01')).toBe('Janeiro 2026')
  })

  it('"2025-06" → "Junho 2025"', () => {
    expect(formatMesAno('2025-06')).toBe('Junho 2025')
  })

  it('"2025-12" → "Dezembro 2025"', () => {
    expect(formatMesAno('2025-12')).toBe('Dezembro 2025')
  })
})
