// Motor de envio das campanhas de /disparos (lib/disparo/campanhas.ts), modo progressivo e o
// registro de quem já recebeu. Uazapi, banco e relógio são falsos — nenhum envio real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => {
  class UazapiRateLimitError extends Error {}
  return { UazapiRateLimitError, sendText: vi.fn(), sendPresence: vi.fn(), ordem: [] as string[] }
})

vi.mock('@/lib/uazapi', () => ({
  sendText: mocks.sendText,
  sendPresence: mocks.sendPresence,
  UazapiRateLimitError: mocks.UazapiRateLimitError,
}))

import { processarCampanhas } from '@/lib/disparo/campanhas'

const CONTA = 'conta-1'
const CAMP = 'camp-1'

function cenario(opts: {
  campanha?: Record<string, unknown>
  contatos?: number
  destinatarios?: Record<string, unknown>[]
  disparados?: Record<string, unknown>[]
} = {}) {
  const contatos = opts.destinatarios ?? Array.from({ length: opts.contatos ?? 30 }, (_, i) => ({
    id: `d${i}`, campanha_id: CAMP, conta_id: CONTA, celular: `55219999900${String(i).padStart(2, '0')}`,
    nome: `Contato ${i}`, ordem: i, status: 'pendente', agendado_para: null, variaveis: null,
  }))
  return new FakeDb({
    campanhas_wa: [{
      id: CAMP, conta_id: CONTA, tipo: 'progressivo', status: 'enviando', iniciado_em: '2026-10-01T00:00:00Z',
      mensagem: 'Oi {{nome}}!', variacoes: ['Olá {{nome}}!'], janela_inicio: '09:00:00', janela_fim: '18:00:00',
      prog_inicio: 1, prog_maximo: 3, prog_dia: 0, prog_planejado_em: null,
      registrar_enviados: false, excluir_ja_enviados: false, modelos_wa: null,
      total_enviados: 0, total_falhas: 0, total_pulados: 0,
      ...opts.campanha,
    }],
    campanha_destinatarios: contatos,
    contatos_disparados: opts.disparados ?? [],
  })
}

/** Roda o motor avançando o relógio falso (a digitação de 20s é um sleep). */
async function rodar(db: FakeDb, budgetMs = 270_000) {
  const p = processarCampanhas(db.cliente() as any, CONTA, 'tok', undefined, Date.now(), budgetMs)
  await vi.advanceTimersByTimeAsync(300_000)
  return p
}

const agendados = (db: FakeDb) => db.linhas('campanha_destinatarios').filter(d => d.agendado_para)
const campanha  = (db: FakeDb) => db.linhas('campanhas_wa')[0]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T11:00:00Z')) // 08:00 em SP, antes da janela
  mocks.ordem.length = 0
  mocks.sendPresence.mockReset().mockImplementation(async () => { mocks.ordem.push('digitando') })
  mocks.sendText.mockReset().mockImplementation(async () => { mocks.ordem.push('enviou') })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('planejamento do dia', () => {
  it('no dia 1 sorteia 1 horário dentro da janela de hoje', async () => {
    const db = cenario()
    await rodar(db)
    const [d] = agendados(db)
    expect(agendados(db)).toHaveLength(1)
    expect(d.id).toBe('d0') // a lista é seguida na ordem colada
    expect(new Date(d.agendado_para).getTime()).toBeGreaterThanOrEqual(new Date('2026-10-23T12:00:00Z').getTime()) // ≥ 09:00 SP
    expect(new Date(d.agendado_para).getTime()).toBeLessThanOrEqual(new Date('2026-10-23T21:00:00Z').getTime())   // ≤ 18:00 SP
    expect(campanha(db)).toMatchObject({ prog_dia: 1, prog_planejado_em: '2026-10-23' })
  })

  it('não planeja de novo no mesmo dia (duas execuções = um planejamento só)', async () => {
    const db = cenario()
    await rodar(db)
    await rodar(db)
    expect(agendados(db)).toHaveLength(1)
    expect(campanha(db).prog_dia).toBe(1)
  })

  it('leitura velha: se outra execução planejou o dia depois que esta leu a campanha, não planeja de novo', async () => {
    const db = cenario()
    const cli = db.cliente() as any
    let primeira = true
    const comOutraExecucao = {
      ...cli,
      from: (tabela: string) => {
        const q = cli.from(tabela)
        if (tabela !== 'campanhas_wa' || !primeira) return q
        primeira = false
        const then = q.then
        q.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => then((v: unknown) => {
          // Entre a leitura e a reserva, outra execução planejou hoje e agendou d0.
          Object.assign(db.linhas('campanhas_wa')[0], { prog_dia: 1, prog_planejado_em: '2026-10-23' })
          db.linhas('campanha_destinatarios')[0].agendado_para = '2026-10-23T15:00:00.000Z'
          return ok(v)
        }, err)
        return q
      },
    }
    const p = processarCampanhas(comOutraExecucao, CONTA, 'tok', undefined, Date.now(), 270_000)
    await vi.advanceTimersByTimeAsync(300_000)
    await p
    expect(campanha(db).prog_dia).toBe(1)
    expect(agendados(db).map(d => d.id)).toEqual(['d0'])
  })

  it('duas execuções planejando ao mesmo tempo: o dia é planejado uma vez só', async () => {
    const db = cenario()
    const cli = db.cliente() as any
    const p = Promise.all([
      processarCampanhas(cli, CONTA, 'tok', undefined, Date.now(), 270_000),
      processarCampanhas(cli, CONTA, 'tok', undefined, Date.now(), 270_000),
    ])
    await vi.advanceTimersByTimeAsync(300_000)
    await p
    expect(campanha(db).prog_dia).toBe(1)
    expect(agendados(db)).toHaveLength(1)
  })

  it('dia 2 leva 2, dia 3 leva 3 e, com máximo 3, o dia 4 volta para 1', async () => {
    const cotas: number[] = []
    for (const [dia, data] of [[1, '2026-10-24'], [2, '2026-10-25'], [3, '2026-10-26']] as const) {
      const db = cenario({ campanha: { prog_dia: dia, prog_planejado_em: '2026-10-01' } })
      vi.setSystemTime(new Date(`${data}T11:00:00Z`))
      await rodar(db)
      cotas.push(agendados(db).length)
    }
    expect(cotas).toEqual([2, 3, 1])
  })

  it('começando depois que a janela de hoje acabou, não gasta o dia: fica para amanhã', async () => {
    vi.setSystemTime(new Date('2026-10-23T21:30:00Z')) // 18:30 em SP
    const db = cenario()
    await rodar(db)
    expect(agendados(db)).toHaveLength(0)
    expect(campanha(db).prog_dia).toBe(0)
  })

  it('horário de um dia anterior que não saiu volta para o sorteio de hoje', async () => {
    const db = cenario({
      campanha: { prog_dia: 1, prog_planejado_em: '2026-10-22' },
      destinatarios: [
        { id: 'ontem', campanha_id: CAMP, conta_id: CONTA, celular: '5521999990001', nome: null, ordem: 0, status: 'pendente', agendado_para: '2026-10-22T15:00:00.000Z', variaveis: null },
        { id: 'novo',  campanha_id: CAMP, conta_id: CONTA, celular: '5521999990002', nome: null, ordem: 1, status: 'pendente', agendado_para: null, variaveis: null },
      ],
    })
    await rodar(db)
    const hoje = agendados(db).filter(d => d.agendado_para >= '2026-10-23')
    expect(hoje.map(d => d.id).sort()).toEqual(['novo', 'ontem'])
  })
})

describe('envio no horário sorteado', () => {
  it('antes do horário não envia nada', async () => {
    const db = cenario()
    await rodar(db)
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('no horário: fica 20s "digitando" e só então envia, com o nome do contato', async () => {
    const db = cenario()
    await rodar(db)
    vi.setSystemTime(new Date(new Date(agendados(db)[0].agendado_para).getTime() + 1_000))
    await rodar(db)

    expect(mocks.ordem).toEqual(['digitando', 'enviou'])
    expect(mocks.sendPresence).toHaveBeenCalledWith('tok', '5521999990000', 20_000)
    expect(mocks.sendText).toHaveBeenCalledWith('tok', '5521999990000', 'Oi Contato 0!')
    expect(db.linhas('campanha_destinatarios')[0].status).toBe('enviado')
    expect(campanha(db).total_enviados).toBe(1)
  })

  it('fora da janela não envia nem atrasado', async () => {
    const db = cenario({
      campanha: { prog_dia: 1, prog_planejado_em: '2026-10-23' },
      destinatarios: [{ id: 'd0', campanha_id: CAMP, conta_id: CONTA, celular: '5521999990001', nome: null, ordem: 0, status: 'pendente', agendado_para: '2026-10-23T20:00:00.000Z', variaveis: null }],
    })
    vi.setSystemTime(new Date('2026-10-23T21:10:00Z')) // 18:10 em SP, janela fechou às 18:00
    await rodar(db)
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('duas execuções ao mesmo tempo mandam uma mensagem só', async () => {
    const db = cenario()
    await rodar(db)
    vi.setSystemTime(new Date(new Date(agendados(db)[0].agendado_para).getTime() + 1_000))
    const cli = db.cliente() as any
    const p = Promise.all([
      processarCampanhas(cli, CONTA, 'tok', undefined, Date.now(), 270_000),
      processarCampanhas(cli, CONTA, 'tok', undefined, Date.now(), 270_000),
    ])
    await vi.advanceTimersByTimeAsync(300_000)
    await p
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
  })

  it('campanha pausada não envia', async () => {
    const db = cenario({
      campanha: { status: 'pausada', prog_dia: 1, prog_planejado_em: '2026-10-23' },
      destinatarios: [{ id: 'd0', campanha_id: CAMP, conta_id: CONTA, celular: '5521999990001', nome: null, ordem: 0, status: 'pendente', agendado_para: '2026-10-23T12:30:00.000Z', variaveis: null }],
    })
    vi.setSystemTime(new Date('2026-10-23T13:00:00Z'))
    await rodar(db)
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('rate limit da uazapi devolve o contato para pendente', async () => {
    mocks.sendText.mockRejectedValue(new mocks.UazapiRateLimitError('429'))
    const db = cenario({
      campanha: { prog_dia: 1, prog_planejado_em: '2026-10-23' },
      destinatarios: [{ id: 'd0', campanha_id: CAMP, conta_id: CONTA, celular: '5521999990001', nome: null, ordem: 0, status: 'pendente', agendado_para: '2026-10-23T12:30:00.000Z', variaveis: null }],
    })
    vi.setSystemTime(new Date('2026-10-23T13:00:00Z'))
    await rodar(db)
    expect(db.linhas('campanha_destinatarios')[0]).toMatchObject({ status: 'pendente', enviado_em: null })
  })

  it('acabou a lista: o disparo fica concluído', async () => {
    const db = cenario({
      campanha: { prog_dia: 1, prog_planejado_em: '2026-10-23' },
      destinatarios: [{ id: 'd0', campanha_id: CAMP, conta_id: CONTA, celular: '5521999990001', nome: null, ordem: 0, status: 'pendente', agendado_para: '2026-10-23T12:30:00.000Z', variaveis: null }],
    })
    vi.setSystemTime(new Date('2026-10-23T13:00:00Z'))
    await rodar(db)
    expect(campanha(db).status).toBe('concluida')
  })
})

describe('registro de quem já recebeu', () => {
  const umAgendado = (celular = '5521999990001') => [{
    id: 'd0', campanha_id: CAMP, conta_id: CONTA, celular, nome: 'Maria', ordem: 0,
    status: 'pendente', agendado_para: '2026-10-23T12:30:00.000Z', variaveis: null,
  }]

  it('com "registrar" ligado, quem recebeu entra em contatos_disparados', async () => {
    const db = cenario({ campanha: { registrar_enviados: true, prog_dia: 1, prog_planejado_em: '2026-10-23' }, destinatarios: umAgendado() })
    vi.setSystemTime(new Date('2026-10-23T13:00:00Z'))
    await rodar(db)
    expect(db.linhas('contatos_disparados')).toEqual([
      expect.objectContaining({ conta_id: CONTA, celular: '5521999990001', nome: 'Maria', campanha_id: CAMP }),
    ])
  })

  it('com "registrar" desligado, não registra', async () => {
    const db = cenario({ campanha: { prog_dia: 1, prog_planejado_em: '2026-10-23' }, destinatarios: umAgendado() })
    vi.setSystemTime(new Date('2026-10-23T13:00:00Z'))
    await rodar(db)
    expect(db.linhas('contatos_disparados')).toEqual([])
  })

  it('com "não enviar para quem já recebeu", o número registrado é pulado e não recebe', async () => {
    const db = cenario({
      campanha: { excluir_ja_enviados: true, prog_dia: 1, prog_planejado_em: '2026-10-23' },
      destinatarios: umAgendado(),
      disparados: [{ id: 'x', conta_id: CONTA, celular: '5521999990001' }],
    })
    vi.setSystemTime(new Date('2026-10-23T13:00:00Z'))
    await rodar(db)
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(db.linhas('campanha_destinatarios')[0].status).toBe('pulado')
    expect(campanha(db).total_pulados).toBe(1)
  })

  it('registro de OUTRA conta não faz pular ninguém aqui', async () => {
    const db = cenario({
      campanha: { excluir_ja_enviados: true, prog_dia: 1, prog_planejado_em: '2026-10-23' },
      destinatarios: umAgendado(),
      disparados: [{ id: 'x', conta_id: 'outra-conta', celular: '5521999990001' }],
    })
    vi.setSystemTime(new Date('2026-10-23T13:00:00Z'))
    await rodar(db)
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
  })
})
