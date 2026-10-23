// Regras puras do disparo progressivo (lib/disparo/progressivo.ts): cota do dia em ciclo,
// horários espalhados dentro da janela, leitura da lista colada e texto com {{nome}}/variações.
import { describe, expect, it } from 'vitest'
import {
  ESPACO_MINIMO_MS,
  dataSP,
  instanteSP,
  interpretarLista,
  montarTexto,
  normalizarCelular,
  quotaDoDia,
  sortearHorarios,
} from '@/lib/disparo/progressivo'

describe('cota do dia (1, 2, 3… até o máximo, e recomeça)', () => {
  it('começa em 1 e sobe 1 por dia até 20', () => {
    expect([0, 1, 2, 18, 19].map(d => quotaDoDia(d, 1, 20))).toEqual([1, 2, 3, 19, 20])
  })

  it('depois de chegar em 20 volta para 1, 2, 3…', () => {
    expect([20, 21, 22, 39, 40].map(d => quotaDoDia(d, 1, 20))).toEqual([1, 2, 3, 20, 1])
  })

  it('respeita um início diferente de 1 (3 → 5 → 3)', () => {
    expect([0, 1, 2, 3, 4].map(d => quotaDoDia(d, 3, 5))).toEqual([3, 4, 5, 3, 4])
  })

  it('início igual ao máximo é sempre a mesma cota', () => {
    expect([0, 1, 7].map(d => quotaDoDia(d, 10, 10))).toEqual([10, 10, 10])
  })
})

describe('horários sorteados dentro da janela', () => {
  const de  = new Date('2026-10-23T12:00:00Z') // 09:00 em SP
  const ate = new Date('2026-10-23T23:00:00Z') // 20:00 em SP

  it('devolve exatamente a cota, em ordem e dentro da janela', () => {
    const h = sortearHorarios(20, de, ate)
    expect(h).toHaveLength(20)
    for (let i = 0; i < h.length; i++) {
      expect(h[i].getTime()).toBeGreaterThanOrEqual(de.getTime())
      expect(h[i].getTime()).toBeLessThanOrEqual(ate.getTime())
      if (i > 0) expect(h[i].getTime()).toBeGreaterThan(h[i - 1].getTime())
    }
  })

  it('nunca cola dois envios, nem no pior sorteio (fim de uma fatia, começo da seguinte)', () => {
    let alterna = 0
    const piorCaso = () => (alterna++ % 2 === 0 ? 1 : 0)
    const h = sortearHorarios(20, de, ate, piorCaso)
    const fatia = (ate.getTime() - de.getTime()) / 20
    for (let i = 1; i < h.length; i++) {
      expect(h[i].getTime() - h[i - 1].getTime()).toBeGreaterThanOrEqual(Math.floor(fatia * 0.2))
    }
  })

  it('janela curta demais para a cota: manda menos no dia, com o espaço mínimo entre eles', () => {
    const curta = new Date(de.getTime() + 10 * 60_000) // 10 minutos
    const h = sortearHorarios(20, de, curta, () => 0.5)
    expect(h).toHaveLength(Math.floor((10 * 60_000) / ESPACO_MINIMO_MS))
  })

  it('janela vazia ou cota zero não sorteia nada', () => {
    expect(sortearHorarios(5, ate, de)).toEqual([])
    expect(sortearHorarios(0, de, ate)).toEqual([])
  })
})

describe('datas em São Paulo', () => {
  it('converte HH:MM de São Paulo para o instante UTC (UTC-3)', () => {
    expect(instanteSP('2026-10-23', '09:00').toISOString()).toBe('2026-10-23T12:00:00.000Z')
    expect(instanteSP('2026-10-23', '20:30:00').toISOString()).toBe('2026-10-23T23:30:00.000Z')
  })

  it('o dia em São Paulo não vira antes da meia-noite local (servidor em UTC)', () => {
    expect(dataSP(new Date('2026-10-24T02:59:00Z'))).toBe('2026-10-23') // 23:59 em SP
    expect(dataSP(new Date('2026-10-24T03:00:00Z'))).toBe('2026-10-24') // 00:00 em SP
  })
})

describe('lista colada', () => {
  it('aceita nome e número em qualquer ordem e separador', () => {
    const { contatos, invalidas } = interpretarLista([
      'Maria Souza; (21) 99999-0001',
      '5521999990002, João',
      '21 99999-0003\tAna',
      '21999990004',
    ].join('\n'))
    expect(invalidas).toEqual([])
    expect(contatos).toEqual([
      { celular: '5521999990001', nome: 'Maria Souza' },
      { celular: '5521999990002', nome: 'João' },
      { celular: '5521999990003', nome: 'Ana' },
      { celular: '5521999990004', nome: null },
    ])
  })

  it('número repetido entra uma vez só (a primeira)', () => {
    const { contatos } = interpretarLista('Maria 21999990001\nOutra Maria 5521999990001')
    expect(contatos).toEqual([{ celular: '5521999990001', nome: 'Maria' }])
  })

  it('linha sem número válido vai para a lista de inválidas, linha vazia é ignorada', () => {
    const { contatos, invalidas } = interpretarLista('Pedro\n\n12345\nLuiza 21999990005')
    expect(contatos).toHaveLength(1)
    expect(invalidas).toEqual(['Pedro', '12345'])
  })

  it('normaliza o celular: põe o 55 quando vier só DDD + número', () => {
    expect(normalizarCelular('(21) 99999-0001')).toBe('5521999990001')
    expect(normalizarCelular('2133330001')).toBe('552133330001')
    expect(normalizarCelular('+55 21 99999-0001')).toBe('5521999990001')
    expect(normalizarCelular('999')).toBeNull()
  })
})

describe('texto da mensagem', () => {
  it('troca {{nome}} pelo nome do contato', () => {
    expect(montarTexto('Oi {{nome}}, tudo bem?', [], 0, 'Maria')).toBe('Oi Maria, tudo bem?')
  })

  it('sem nome, some com o {{nome}} e com o espaço antes da pontuação', () => {
    expect(montarTexto('Oi {{ nome }}, tudo bem?', [], 0, null)).toBe('Oi, tudo bem?')
  })

  it('alterna entre a mensagem e as variações pela posição do contato', () => {
    const textos = [0, 1, 2, 3].map(i => montarTexto('A', ['B', 'C'], i, null))
    expect(textos).toEqual(['A', 'B', 'C', 'A'])
  })

  it('ignora variação em branco', () => {
    expect([0, 1, 2].map(i => montarTexto('A', ['  ', 'B'], i, null))).toEqual(['A', 'B', 'A'])
  })
})
