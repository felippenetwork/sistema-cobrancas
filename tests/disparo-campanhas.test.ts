// Motor de envio das campanhas de /disparos (lib/disparo/campanhas.ts), modo progressivo e o
// registro de quem já recebeu. Uazapi, banco e relógio são falsos — nenhum envio real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => {
  class UazapiRateLimitError extends Error {}
  return {
    UazapiRateLimitError, sendText: vi.fn(), sendPresence: vi.fn(), sendMedia: vi.fn(), setChatLabel: vi.fn(),
    archiveChat: vi.fn(), pinChat: vi.fn(), pinMessage: vi.fn(), labelsDoChat: vi.fn(), muteChat: vi.fn(),
    readChat: vi.fn(), addContact: vi.fn(), editNotes: vi.fn(), ordem: [] as string[],
  }
})

vi.mock('@/lib/uazapi', () => ({
  sendText: mocks.sendText,
  sendPresence: mocks.sendPresence,
  sendMedia: mocks.sendMedia,
  setChatLabel: mocks.setChatLabel,
  archiveChat: mocks.archiveChat, pinChat: mocks.pinChat, pinMessage: mocks.pinMessage, labelsDoChat: mocks.labelsDoChat,
  muteChat: mocks.muteChat, readChat: mocks.readChat, addContact: mocks.addContact, editNotes: mocks.editNotes,
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
  mocks.sendMedia.mockReset().mockImplementation(async () => { mocks.ordem.push('midia') })
  mocks.setChatLabel.mockReset().mockImplementation(async (_t: string, _n: string, acao: string, id: string) => { mocks.ordem.push(`etiqueta ${acao} ${id}`) })
  for (const fn of [mocks.archiveChat, mocks.pinChat, mocks.pinMessage, mocks.muteChat, mocks.readChat, mocks.addContact, mocks.editNotes]) fn.mockReset().mockResolvedValue(undefined)
  mocks.labelsDoChat.mockReset().mockResolvedValue([])
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
    expect(mocks.sendPresence).toHaveBeenCalledWith('tok', '5521999990000', 20_000, 'composing')
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

  it('quem mandou SAIR para o robô é pulado sempre (mesmo sem as opções de registro e sem o 9 no número)', async () => {
    const db = cenario({ campanha: { prog_dia: 1, prog_planejado_em: '2026-10-23' }, destinatarios: umAgendado() })
    db.linhas('bot_conversas').push({ id: 'b1', conta_id: CONTA, celular: '552199990001', status: 'descadastrado' })
    vi.setSystemTime(new Date('2026-10-23T13:00:00Z'))
    await rodar(db)
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(db.linhas('campanha_destinatarios')[0]).toMatchObject({ status: 'pulado', erro: 'Pediu para não receber mensagens' })
  })

  it('SAIR de OUTRA conta não pula ninguém aqui', async () => {
    const db = cenario({ campanha: { prog_dia: 1, prog_planejado_em: '2026-10-23' }, destinatarios: umAgendado() })
    db.linhas('bot_conversas').push({ id: 'b1', conta_id: 'outra-conta', celular: '5521999990001', status: 'descadastrado' })
    vi.setSystemTime(new Date('2026-10-23T13:00:00Z'))
    await rodar(db)
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
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

describe('sequência de mensagens (caixinhas)', () => {
  const agendado = () => [{
    id: 'd0', campanha_id: CAMP, conta_id: CONTA, celular: '5521999990001', nome: 'Maria', ordem: 0,
    status: 'pendente', agendado_para: '2026-10-23T12:30:00.000Z', variaveis: null,
  }]
  const PASSOS = [
    { tipo: 'texto', texto: 'Oi {{nome}}!', variacoes: [], digitacao_seg: 20 },
    { tipo: 'imagem', caminho: `contas/${CONTA}/foto.jpg`, nome_arquivo: 'foto.jpg', legenda: 'Para você, {{nome}}', digitacao_seg: 5 },
    { tipo: 'audio', caminho: `contas/${CONTA}/audio.ogg`, nome_arquivo: 'audio.ogg', legenda: null, digitacao_seg: 8 },
  ]
  const comPassos = (extra: Record<string, unknown> = {}) =>
    cenario({ campanha: { passos: PASSOS, prog_dia: 1, prog_planejado_em: '2026-10-23', ...extra }, destinatarios: agendado() })

  beforeEach(() => vi.setSystemTime(new Date('2026-10-23T13:00:00Z')))

  it('envia cada caixinha na ordem, com o próprio tempo de digitação antes de cada uma', async () => {
    const db = comPassos()
    await rodar(db)
    expect(mocks.ordem).toEqual(['digitando', 'enviou', 'digitando', 'midia', 'digitando', 'midia'])
    expect(mocks.sendPresence.mock.calls.map(c => [c[2], c[3]])).toEqual([[20_000, 'composing'], [5_000, 'composing'], [8_000, 'recording']])
    expect(mocks.sendText).toHaveBeenCalledWith('tok', '5521999990001', 'Oi Maria!')
  })

  it('disparo normal só com a cópia da sequência do modelo (sem texto avulso) também envia', async () => {
    const db = cenario({
      campanha: { tipo: 'normal', mensagem: null, variacoes: [], modelos_wa: null, passos: PASSOS },
      destinatarios: [{ ...agendado()[0], agendado_para: null }],
    })
    await rodar(db)
    expect(mocks.ordem).toEqual(['digitando', 'enviou', 'digitando', 'midia', 'digitando', 'midia'])
    expect(db.linhas('campanha_destinatarios')[0].status).toBe('enviado')
  })

  it('mídia vai por link assinado do bucket privado, com {{nome}} na legenda e áudio como voz', async () => {
    const db = comPassos()
    await rodar(db)
    expect(db.urlsAssinadas).toEqual([`disparo-midia/contas/${CONTA}/foto.jpg`, `disparo-midia/contas/${CONTA}/audio.ogg`])
    expect(mocks.sendMedia).toHaveBeenNthCalledWith(1, 'tok', '5521999990001', 'image', expect.stringContaining('foto.jpg'), { legenda: 'Para você, Maria', nomeArquivo: 'foto.jpg' })
    expect(mocks.sendMedia).toHaveBeenNthCalledWith(2, 'tok', '5521999990001', 'ptt', expect.stringContaining('audio.ogg'), { legenda: null, nomeArquivo: 'audio.ogg' })
  })

  it('falha no meio da sequência: não volta para pendente (não reenvia o começo) e registra o aviso', async () => {
    mocks.sendMedia.mockRejectedValueOnce(new Error('arquivo inválido'))
    const db = comPassos()
    await rodar(db)
    const d = db.linhas('campanha_destinatarios')[0]
    expect(d.status).toBe('enviado')
    expect(d.aviso).toContain('Enviou 1 de 3 mensagens')
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
  })

  it('storage fora do ar antes de qualquer envio: o contato volta para pendente', async () => {
    const db = cenario({
      campanha: { passos: [PASSOS[1]], prog_dia: 1, prog_planejado_em: '2026-10-23' },
      destinatarios: agendado(),
    })
    db.storageFalhando = true
    await rodar(db)
    expect(mocks.sendMedia).not.toHaveBeenCalled()
    expect(db.linhas('campanha_destinatarios')[0]).toMatchObject({ status: 'pendente', enviado_em: null })
  })

  it('não começa um contato cuja sequência não cabe no tempo que resta da execução', async () => {
    const db = comPassos()
    const p = processarCampanhas(db.cliente() as any, CONTA, 'tok', undefined, Date.now(), 20_000) // 20s de orçamento
    await vi.advanceTimersByTimeAsync(300_000)
    await p
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(db.linhas('campanha_destinatarios')[0].status).toBe('pendente')
  })
})

describe('etiquetas do WhatsApp Business', () => {
  const agendado = () => [{
    id: 'd0', campanha_id: CAMP, conta_id: CONTA, celular: '5521999990001', nome: null, ordem: 0,
    status: 'pendente', agendado_para: '2026-10-23T12:30:00.000Z', variaveis: null,
  }]
  beforeEach(() => vi.setSystemTime(new Date('2026-10-23T13:00:00Z')))

  it('depois do envio tira a etiqueta escolhida e põe a nova', async () => {
    const db = cenario({ campanha: { etiqueta_remover: 'L1', etiqueta_adicionar: 'L2', prog_dia: 1, prog_planejado_em: '2026-10-23' }, destinatarios: agendado() })
    await rodar(db)
    expect(mocks.setChatLabel.mock.calls).toEqual([
      ['tok', '5521999990001', 'remover', 'L1'],
      ['tok', '5521999990001', 'adicionar', 'L2'],
    ])
  })

  it('erro na etiqueta não desfaz o envio: vira aviso', async () => {
    mocks.setChatLabel.mockRejectedValue(new Error('etiqueta não existe'))
    const db = cenario({ campanha: { etiqueta_adicionar: 'L2', prog_dia: 1, prog_planejado_em: '2026-10-23' }, destinatarios: agendado() })
    await rodar(db)
    const d = db.linhas('campanha_destinatarios')[0]
    expect(d.status).toBe('enviado')
    expect(d.aviso).toContain('etiqueta')
  })

  it('sem etiqueta escolhida não chama a uazapi', async () => {
    const db = cenario({ campanha: { prog_dia: 1, prog_planejado_em: '2026-10-23' }, destinatarios: agendado() })
    await rodar(db)
    expect(mocks.setChatLabel).not.toHaveBeenCalled()
  })
})

describe('ações depois do envio (lista ordenada)', () => {
  const agendado = () => [{
    id: 'd0', campanha_id: CAMP, conta_id: CONTA, celular: '5521999990001', nome: 'Maria', ordem: 0,
    status: 'pendente', agendado_para: '2026-10-23T12:30:00.000Z', variaveis: null,
  }]
  const comAcoes = (acoes: unknown[], extra: Record<string, unknown> = {}) =>
    cenario({ campanha: { acoes, prog_dia: 1, prog_planejado_em: '2026-10-23', ...extra }, destinatarios: agendado() })
  beforeEach(() => vi.setSystemTime(new Date('2026-10-23T13:00:00Z')))

  it('executa na ordem escolhida, depois da mensagem', async () => {
    mocks.archiveChat.mockImplementation(async () => { mocks.ordem.push('arquivou') })
    mocks.labelsDoChat.mockResolvedValue(['5521:3', '5521:7'])
    await rodar(comAcoes([{ tipo: 'etiquetas_tirar_todas' }, { tipo: 'etiqueta_por', id: 'L9', nome: 'Novo' }, { tipo: 'arquivar' }]))
    expect(mocks.ordem.slice(mocks.ordem.indexOf('enviou'))).toEqual(['enviou', 'etiqueta remover 3', 'etiqueta remover 7', 'etiqueta adicionar L9', 'arquivou'])
  })

  it('fixa a mensagem que acabou de sair (id devolvido pelo envio)', async () => {
    mocks.sendText.mockResolvedValue('5521:ABC123')
    await rodar(comAcoes([{ tipo: 'fixar_mensagem', dias: 7 }]))
    expect(mocks.pinMessage).toHaveBeenCalledWith('tok', '5521:ABC123', 7)
  })

  it('uma ação que falha vira aviso e as seguintes continuam; o envio vale', async () => {
    mocks.pinChat.mockRejectedValue(new Error('não deu'))
    const db = comAcoes([{ tipo: 'fixar_conversa' }, { tipo: 'silenciar', horas: 168 }, { tipo: 'salvar_contato' }])
    await rodar(db)
    expect(mocks.muteChat).toHaveBeenCalledWith('tok', '5521999990001', 168)
    expect(mocks.addContact).toHaveBeenCalledWith('tok', '5521999990001', 'Maria')
    const d = db.linhas('campanha_destinatarios')[0]
    expect(d.status).toBe('enviado')
    expect(d.aviso).toContain('fixa a conversa')
  })

  it('com a lista preenchida, as etiquetas antigas do disparo não são usadas', async () => {
    await rodar(comAcoes([{ tipo: 'marcar_lida' }], { etiqueta_adicionar: 'VELHA' }))
    expect(mocks.readChat).toHaveBeenCalledWith('tok', '5521999990001', true)
    expect(mocks.setChatLabel).not.toHaveBeenCalled()
  })

  it('nota usa {{nome}} do contato', async () => {
    await rodar(comAcoes([{ tipo: 'nota', texto: 'Recebeu campanha, {{nome}}' }]))
    expect(mocks.editNotes).toHaveBeenCalledWith('tok', '5521999990001', 'Recebeu campanha, Maria')
  })
})