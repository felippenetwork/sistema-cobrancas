// Envio agendado para uma pessoa (lib/disparo/agendados.ts, tabela envios_agendados). Uazapi,
// banco e relógio são falsos — nenhum envio real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => {
  class UazapiRateLimitError extends Error {}
  return {
    UazapiRateLimitError, sendText: vi.fn(), sendPresence: vi.fn(), sendMedia: vi.fn(), setChatLabel: vi.fn(),
    archiveChat: vi.fn(), pinChat: vi.fn(), pinMessage: vi.fn(), labelsDoChat: vi.fn(), muteChat: vi.fn(),
    readChat: vi.fn(), addContact: vi.fn(), editNotes: vi.fn(),
  }
})

vi.mock('@/lib/uazapi', () => ({ ...mocks }))

import { processarAgendados } from '@/lib/disparo/agendados'

const CONTA = 'conta-1'
const AGORA = new Date('2026-10-29T21:00:00Z') // 18:00 em SP

const texto = (t: string, digitacao_seg = 5) => ({ tipo: 'texto', texto: t, variacoes: [], digitacao_seg })

function agendado(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, conta_id: CONTA, celular: '5521999990001', nome: 'Maria', status: 'pendente',
    agendado_para: AGORA.toISOString(), passos: [texto('{{periododia}}, {{nome}}! Lembrete do horário.')],
    erro: null, aviso: null, enviado_em: null, ...extra,
  }
}

async function rodar(db: FakeDb, budgetMs = 270_000) {
  const p = processarAgendados(db.cliente() as any, CONTA, 'tok', undefined, Date.now(), budgetMs)
  await vi.advanceTimersByTimeAsync(600_000)
  return p
}

const linha = (db: FakeDb, id: string) => db.linhas('envios_agendados').find(l => l.id === id)!

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(AGORA)
  for (const fn of Object.values(mocks)) if (typeof fn === 'function' && 'mockReset' in fn) (fn as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined)
  mocks.sendText.mockResolvedValue('msg-1')
  mocks.labelsDoChat.mockResolvedValue([])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('envio agendado', () => {
  it('na hora marcada envia com o nome e o período do dia e marca como enviado', async () => {
    const db = new FakeDb({ envios_agendados: [agendado('a1')] })
    const r = await rodar(db)
    expect(r).toEqual({ enviados: 1, pararConta: false })
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
    const [, numero, mensagem] = mocks.sendText.mock.calls[0]
    expect(numero).toBe('5521999990001')
    expect(mensagem).toMatch(/^bo+a+ n/i) // uma das grafias de Boa noite (18h em SP)
    expect(mensagem).toContain('Maria! Lembrete do horário.')
    expect(mocks.sendPresence.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendText.mock.invocationCallOrder[0])
    expect(linha(db, 'a1')).toMatchObject({ status: 'enviado' })
    expect(linha(db, 'a1').enviado_em).toBeTruthy()
  })

  it('não envia antes da hora, nem o que foi cancelado ou é de outra conta', async () => {
    const db = new FakeDb({
      envios_agendados: [
        agendado('futuro', { agendado_para: new Date(AGORA.getTime() + 60_000).toISOString() }),
        agendado('cancelado', { status: 'cancelado' }),
        agendado('outra', { conta_id: 'conta-2' }),
      ],
    })
    expect(await rodar(db)).toEqual({ enviados: 0, pararConta: false })
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(linha(db, 'futuro').status).toBe('pendente')
  })

  it('sai fora do horário dos lembretes (ex.: 23h), porque a hora foi escolhida pelo dono', async () => {
    vi.setSystemTime(new Date('2026-10-30T02:00:00Z')) // 23:00 em SP
    const db = new FakeDb({ envios_agendados: [agendado('a1', { agendado_para: '2026-10-30T02:00:00.000Z' })] })
    expect((await rodar(db)).enviados).toBe(1)
  })

  it('mais de 6 h atrasado (WhatsApp estava desconectado) não sai: vira "não saiu" com o motivo', async () => {
    const db = new FakeDb({
      envios_agendados: [
        agendado('velho', { agendado_para: new Date(AGORA.getTime() - 6 * 3600_000 - 60_000).toISOString() }),
        agendado('recente', { agendado_para: new Date(AGORA.getTime() - 5 * 3600_000).toISOString() }),
      ],
    })
    expect((await rodar(db)).enviados).toBe(1)
    expect(linha(db, 'velho')).toMatchObject({ status: 'falhou', erro: expect.stringContaining('desconectado') })
    expect(linha(db, 'recente').status).toBe('enviado')
  })

  it('rate limit antes de sair volta para a fila e para a conta neste minuto', async () => {
    mocks.sendText.mockRejectedValueOnce(new mocks.UazapiRateLimitError('429'))
    const db = new FakeDb({ envios_agendados: [agendado('a1'), agendado('a2')] })
    expect(await rodar(db)).toEqual({ enviados: 0, pararConta: true })
    expect(linha(db, 'a1')).toMatchObject({ status: 'pendente', enviado_em: null })
    expect(linha(db, 'a2').status).toBe('pendente')
  })

  it('recusa do WhatsApp vira "não saiu" e o próximo segue', async () => {
    mocks.sendText.mockRejectedValueOnce(new Error('número não existe'))
    const db = new FakeDb({ envios_agendados: [agendado('a1'), agendado('a2', { agendado_para: new Date(AGORA.getTime() - 1000).toISOString() })] })
    expect((await rodar(db)).enviados).toBe(1)
    expect(linha(db, 'a2').status).toBe('falhou') // o mais antigo vai primeiro
    expect(linha(db, 'a2').erro).toContain('número não existe')
    expect(linha(db, 'a1').status).toBe('enviado')
  })

  it('depois que a primeira mensagem saiu, falha na segunda NUNCA devolve para a fila (não repete)', async () => {
    mocks.sendText.mockResolvedValueOnce('m1').mockRejectedValueOnce(new mocks.UazapiRateLimitError('429'))
    const db = new FakeDb({ envios_agendados: [agendado('a1', { passos: [texto('Oi'), texto('Tudo certo?')] })] })
    const r = await rodar(db)
    expect(r.pararConta).toBe(true)
    expect(linha(db, 'a1').status).toBe('enviado')
    expect(linha(db, 'a1').aviso).toContain('Enviou 1 de 2')
  })

  it('caixinha de ação no meio que falha vira aviso e a mensagem seguinte sai', async () => {
    mocks.archiveChat.mockRejectedValueOnce(new Error('falhou'))
    const db = new FakeDb({ envios_agendados: [agendado('a1', { passos: [texto('Oi'), { tipo: 'acao', acao: { tipo: 'arquivar' }, digitacao_seg: 0 }, texto('Fim')] })] })
    expect((await rodar(db)).enviados).toBe(1)
    expect(mocks.sendText).toHaveBeenCalledTimes(2)
    expect(linha(db, 'a1').aviso).toBeTruthy()
  })

  it('dois agendados na mesma hora: o segundo espera o intervalo anti-ban (45–80 s)', async () => {
    const db = new FakeDb({ envios_agendados: [agendado('a1'), agendado('a2')] })
    const momentos: number[] = []
    mocks.sendText.mockImplementation(async () => { momentos.push(Date.now()); return 'm' })
    expect((await rodar(db)).enviados).toBe(2)
    const espera = momentos[1] - momentos[0]
    expect(espera).toBeGreaterThanOrEqual(45_000 + 5_000) // intervalo + digitação do segundo
    expect(espera).toBeLessThanOrEqual(80_000 + 5_000)
  })

  it('se não couber no tempo desta execução, fica para o próximo minuto sem ser tocado', async () => {
    const db = new FakeDb({ envios_agendados: [agendado('a1', { passos: [texto('Oi', 60)] })] })
    expect((await rodar(db, 30_000)).enviados).toBe(0)
    expect(mocks.sendPresence).not.toHaveBeenCalled()
    expect(linha(db, 'a1').status).toBe('pendente')
  })

  it('duas execuções ao mesmo tempo enviam uma vez só', async () => {
    const db = new FakeDb({ envios_agendados: [agendado('a1')] })
    const p1 = processarAgendados(db.cliente() as any, CONTA, 'tok', undefined, Date.now(), 270_000)
    const p2 = processarAgendados(db.cliente() as any, CONTA, 'tok', undefined, Date.now(), 270_000)
    await vi.advanceTimersByTimeAsync(600_000)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.enviados + r2.enviados).toBe(1)
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
  })

  it('sequência inválida no banco não vai para o WhatsApp', async () => {
    const db = new FakeDb({ envios_agendados: [agendado('a1', { passos: [{ tipo: 'texto' }] })] })
    await rodar(db)
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(linha(db, 'a1')).toMatchObject({ status: 'falhou', erro: 'Mensagem inválida.' })
  })
})
