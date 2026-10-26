// {{periododia}} (lib/disparo/progressivo.ts): saudação pela hora de São Paulo no momento do
// envio — 05:00–11:59 Bom dia, 12:00–17:59 Boa tarde, 18:00–04:59 Boa noite.
import { describe, expect, it } from 'vitest'
import { montarTexto, periodoDoDia, saudacaoDoPeriodo, VARIACOES_PERIODO } from '@/lib/disparo/progressivo'

// São Paulo = UTC-3: 05:00 SP = 08:00Z.
const sp = (hhmm: string) => new Date(`2026-10-26T${hhmm}:00-03:00`)

describe('periodoDoDia', () => {
  it.each([
    ['04:59', 'Boa noite'], ['05:00', 'Bom dia'], ['11:59', 'Bom dia'],
    ['12:00', 'Boa tarde'], ['17:59', 'Boa tarde'], ['18:00', 'Boa noite'],
    ['23:59', 'Boa noite'], ['00:00', 'Boa noite'],
  ])('%s em São Paulo → %s', (hora, esperado) => {
    expect(periodoDoDia(sp(hora))).toBe(esperado)
  })

  it('usa o horário de São Paulo, não o do servidor (UTC)', () => {
    // 13:00 UTC = 10:00 em SP: ainda é manhã lá.
    expect(periodoDoDia(new Date('2026-10-26T13:00:00Z'))).toBe('Bom dia')
  })
})

describe('{{periododia}} no texto', () => {
  it('no começo da frase sai com maiúscula, junto do {{nome}}', () => {
    expect(montarTexto('{{periododia}}, {{nome}}! Tudo bem?', [], 0, 'Maria', sp('09:00'))).toBe('Bom dia, Maria! Tudo bem?')
  })

  it('no meio da frase sai em minúscula; depois de ponto ou quebra de linha, maiúscula', () => {
    expect(montarTexto('Oi {{nome}}, {{periododia}}!', [], 0, 'Ana', sp('15:00'))).toBe('Oi Ana, boa tarde!')
    expect(montarTexto('Oi Ana. {{PERIODODIA}}!', [], 0, null, sp('20:00'))).toBe('Oi Ana. Boa noite!')
    expect(montarTexto('Oi\n{{ periododia }}', [], 0, null, sp('20:00'))).toBe('Oi\nBoa noite')
  })

  it('vale também nas variações da mensagem', () => {
    expect(montarTexto('a', ['{{periododia}}!'], 1, null, sp('06:00'))).toBe('Bom diaa!')
  })
})

describe('cada contato recebe um jeito de escrever a saudação', () => {
  it('rodízio pela posição do contato, voltando ao começo depois do último', () => {
    const manha = [0, 1, 2, 3, 4, 5].map(i => saudacaoDoPeriodo(sp('09:00'), i))
    expect(manha).toEqual(['Bom dia', 'Bom diaa', 'Boom dia', 'Bom diaaa', 'Boom diaa', 'Bom dia'])
    expect(saudacaoDoPeriodo(sp('14:00'), 2)).toBe('Boaa tarde')
    expect(saudacaoDoPeriodo(sp('21:00'), 3)).toBe('Boa noiteee')
  })

  it('todas as grafias continuam sendo do período certo', () => {
    for (const [periodo, grafias] of Object.entries(VARIACOES_PERIODO)) {
      const primeira = periodo.toLowerCase().split(' ')[1].slice(0, 3) // dia / tar / noi
      expect(grafias.every(g => g.toLowerCase().replace(/(.)\1+/g, '$1').includes(primeira.replace(/(.)\1+/g, '$1')))).toBe(true)
    }
  })

  it('no meio da frase a grafia sai em minúscula', () => {
    expect(montarTexto('Oi {{nome}}, {{periododia}}!', [], 2, 'Ana', sp('10:00'))).toBe('Oi Ana, boom dia!')
  })
})
