// {{periododia}} (lib/disparo/progressivo.ts): saudação pela hora de São Paulo no momento do
// envio — 05:00–11:59 Bom dia, 12:00–17:59 Boa tarde, 18:00–04:59 Boa noite.
import { describe, expect, it } from 'vitest'
import { montarTexto, periodoDoDia } from '@/lib/disparo/progressivo'

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

  it('vale também nas variações', () => {
    expect(montarTexto('a', ['{{periododia}}!'], 1, null, sp('06:00'))).toBe('Bom dia!')
  })
})
