// Relatório do disparo (lib/disparo/relatorio.ts): resumo e planilha. Dados sintéticos.
import { describe, expect, it } from 'vitest'
import { relatorioCsv, resumoRelatorio, type LinhaRelatorio } from '@/lib/disparo/relatorio'

const linhas: LinhaRelatorio[] = [
  { nome: 'Maria', celular: '5521999990001', status: 'enviado', enviado_em: '2026-10-26T13:05:00Z', erro: null, aviso: null },
  { nome: 'João; Silva', celular: '5521999990002', status: 'enviado', enviado_em: '2026-10-26T18:40:00Z', erro: null, aviso: 'Não conseguiu: arquiva' },
  { nome: null, celular: '5521999990003', status: 'falhou', enviado_em: null, erro: 'número não tem WhatsApp', aviso: null },
  { nome: '=HYPERLINK("x")', celular: '5521999990004', status: 'pulado', enviado_em: null, erro: 'Já recebeu um disparo antes', aviso: null },
  { nome: 'Ana', celular: '5521999990005', status: 'pendente', enviado_em: null, erro: null, aviso: null },
]

describe('resumo', () => {
  it('conta cada situação, os avisos e o primeiro/último envio', () => {
    expect(resumoRelatorio(linhas)).toEqual({
      total: 5, enviados: 2, falharam: 1, pulados: 1, naoEnviados: 1, comAviso: 1,
      primeiro: '2026-10-26T13:05:00Z', ultimo: '2026-10-26T18:40:00Z',
    })
  })
})

describe('planilha', () => {
  const csv = relatorioCsv(linhas)
  const linhasCsv = csv.replace(/^\uFEFF/, '').split('\r\n')

  it('abre certo no Excel em português: BOM, ";" e cabeçalho', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(linhasCsv[0]).toBe('Nome;Número;Situação;Enviado em;Motivo;Avisos')
  })

  it('hora em São Paulo, situação em português e motivo só quando não foi enviado', () => {
    expect(linhasCsv[1]).toBe('Maria;55 21 99999-0001;Enviado;26/10/2026, 10:05;;')
    expect(linhasCsv[3]).toBe(';55 21 99999-0003;Falhou;;número não tem WhatsApp;')
  })

  it('protege ";" e aspas, e impede que um nome vire fórmula', () => {
    expect(linhasCsv[2].startsWith('"João; Silva";')).toBe(true)
    expect(linhasCsv[4].startsWith(`"'=HYPERLINK(""x"")";`)).toBe(true)
  })
})
