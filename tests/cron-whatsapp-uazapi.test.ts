// Rota de cron que dispara os lembretes via uazapi (app/api/cron/whatsapp-uazapi).
// Uazapi, banco e relógio são falsos — nenhuma mensagem real, nenhum sleep real.
// Cobre o que já causou incidente: envio duplo (commit 3a13093), lembrete para
// quem acabou de pagar e notificação presa em "processando".
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => {
  class UazapiRateLimitError extends Error {}
  return {
    db: { atual: null as unknown },
    UazapiRateLimitError,
    getAllInstances: vi.fn(),
    sendText: vi.fn(),
    sendPresence: vi.fn(),
    resolverVariaveis: vi.fn(),
    resolverVariaveisLeves: vi.fn(),
    encontrarOuCriarAtendimento: vi.fn(),
    // Por padrão (sem mockImplementation), lança — reproduz o after() de verdade
    // fora de uma requisição real do Next, que é a situação de todo teste aqui
    // (chamamos GET() direto). Testes que precisam do caminho "produção" trocam
    // a implementação para capturar o callback em vez de lançar.
    after: vi.fn((_cb: () => Promise<unknown>): void => {
      throw new Error('`after` was called outside a request scope.')
    }),
  }
})

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))
vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}))
vi.mock('@/lib/uazapi', () => ({
  instName: (contaId: string) => `inst-${contaId}`,
  getAllInstances: mocks.getAllInstances,
  sendText: mocks.sendText,
  sendPresence: mocks.sendPresence,
  UazapiRateLimitError: mocks.UazapiRateLimitError,
}))
vi.mock('@/lib/whatsapp/resolver-variaveis', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/resolver-variaveis')>()),
  resolverVariaveis: mocks.resolverVariaveis,
  resolverVariaveisLeves: mocks.resolverVariaveisLeves,
}))
vi.mock('@/lib/atendimento/encontrar-ou-criar', () => ({ encontrarOuCriarAtendimento: mocks.encontrarOuCriarAtendimento }))

import { GET } from '@/app/api/cron/whatsapp-uazapi/route'
import { VariaveisIndisponiveisError } from '@/lib/whatsapp/resolver-variaveis'

const CONTA = 'conta-1'
const CLIENTE = 'cli-1'
const PARCELA = 'parc-1'
const SEGREDO = 'segredo-cron-de-teste'
const MEIO_DIA_SP = '2026-09-19T15:00:00Z' // 12:00 em São Paulo (UTC-3)

function cenario(notif: Record<string, unknown> = {}, config: Record<string, unknown> = {}) {
  const db = new FakeDb({
    conexoes: [{ conta_id: CONTA, status: 'conectado', uazapi_instance_token: 'tok' }],
    configuracoes: [{
      conta_id: CONTA, horario_inicio: '09:00', horario_fim: '20:00',
      intervalo_min_seg: 45, intervalo_max_seg: 45, ...config,
    }],
    clientes: [{ id: CLIENTE, conta_id: CONTA, celular: '5521900000001', deleted_at: null }],
    parcelas: [{ id: PARCELA, conta_id: CONTA, status: 'aberta' }],
    notificacoes_config: [
      { conta_id: CONTA, tipo: '3d', template_whatsapp: 'Olá #NOME#' },
      { conta_id: CONTA, tipo: 'pagamento_confirmado', template_whatsapp: 'Recebemos, #NOME#' },
    ],
    notificacoes_enviadas: [{
      id: 'n1', conta_id: CONTA, canal: 'whatsapp', status: 'fila', tipo: '3d',
      parcela_id: PARCELA, cobranca_id: null, cliente_id: CLIENTE, mensagem_final: null,
      agendado_para: '2026-09-19T10:00:00.000Z', ...notif,
    }],
    campanhas_wa: [],
    mensagens_wa: [],
  })
  mocks.db.atual = db.cliente()
  return db
}

const requisicao = (autorizado = true) => new NextRequest('http://localhost/api/cron/whatsapp-uazapi', {
  headers: autorizado ? { authorization: `Bearer ${SEGREDO}` } : {},
})

/** Executa o cron avançando o relógio falso (digitação 15-20s + intervalo entre envios). */
async function rodarCron(quantas = 1) {
  const execucoes = Array.from({ length: quantas }, () => GET(requisicao()))
  await vi.advanceTimersByTimeAsync(400_000)
  return Promise.all(execucoes)
}

const nota = (db: FakeDb) => db.linhas('notificacoes_enviadas')[0]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(MEIO_DIA_SP))
  process.env.CRON_SECRET = SEGREDO

  mocks.getAllInstances.mockReset().mockResolvedValue([
    { name: `inst-${CONTA}`, status: 'connected', token: 'tok', owner: '5521900000000@s.whatsapp.net' },
  ])
  mocks.sendText.mockReset().mockResolvedValue(undefined)
  mocks.sendPresence.mockReset().mockResolvedValue(undefined)
  mocks.resolverVariaveis.mockReset().mockResolvedValue('mensagem pronta')
  mocks.resolverVariaveisLeves.mockReset().mockResolvedValue('mensagem avulsa pronta')
  mocks.encontrarOuCriarAtendimento.mockReset().mockResolvedValue('atend-1')
  mocks.after.mockReset().mockImplementation(() => {
    throw new Error('`after` was called outside a request scope.')
  })

  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete process.env.CRON_SECRET
})

// Achado real (2026-09-19): o cron-job.org (gatilho externo, ver skill
// whatsapp-uazapi) tem timeout FIXO de 30s no plano usado, bem menor que o
// ritmo anti-ban real (15-80s por mensagem) — toda execução com >0 mensagens
// na fila estourava esse tempo e o serviço passou a marcar a chamada como
// falha, travando os lembretes automáticos. Corrigido devolvendo a resposta
// já (via after()) e processando de verdade em segundo plano.
describe('resposta rápida ao cron externo (after) — timeout de 30s do cron-job.org', () => {
  it('em produção (after real): responde antes de enviar, e o envio de verdade acontece em segundo plano', async () => {
    const db = cenario()
    let callback: (() => Promise<unknown>) | undefined
    mocks.after.mockReset().mockImplementation((cb: () => Promise<unknown>) => { callback = cb })

    const resposta = await GET(requisicao())
    expect(await resposta.json()).toEqual({ ok: true, iniciado: true, contasElegiveis: 1 })
    // A resposta já voltou — nada foi enviado nem reivindicado ainda.
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(nota(db).status).toBe('fila')

    expect(callback).toBeDefined()
    const trabalho = callback!()
    await vi.advanceTimersByTimeAsync(400_000)
    await trabalho

    expect(mocks.sendText).toHaveBeenCalledTimes(1)
    expect(nota(db).status).toBe('enviado')
  })

  it('sem contas elegíveis: responde na hora sem sequer chamar after()', async () => {
    cenario({}, {}) // uma notificação em fila, mas sem conta conectada isolada abaixo
    mocks.getAllInstances.mockResolvedValue([]) // nenhuma instância conectada
    const db = new FakeDb({ conexoes: [], configuracoes: [], notificacoes_enviadas: [] })
    mocks.db.atual = db.cliente()

    const resposta = await GET(requisicao())
    expect(await resposta.json()).toEqual({ ok: true, enviadas: 0 })
    expect(mocks.after).not.toHaveBeenCalled()
  })
})

describe('autenticação', () => {
  it('recusa sem o header Authorization', async () => {
    cenario()
    expect((await GET(requisicao(false))).status).toBe(401)
  })

  it('recusa "Bearer undefined" quando CRON_SECRET não está configurado no servidor', async () => {
    cenario()
    delete process.env.CRON_SECRET
    const res = await GET(new NextRequest('http://localhost/x', { headers: { authorization: 'Bearer undefined' } }))
    expect(res.status).toBe(401)
    expect(mocks.sendText).not.toHaveBeenCalled()
  })
})

describe('envio de lembrete', () => {
  it('envia a mensagem, marca "enviado" e registra no histórico de atendimento', async () => {
    const db = cenario()
    await rodarCron()
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
    expect(mocks.sendText).toHaveBeenCalledWith('tok', '5521900000001', 'mensagem pronta')
    expect(nota(db).status).toBe('enviado')
    expect(nota(db).mensagem_final).toBe('mensagem pronta')
    expect(db.linhas('mensagens_wa')).toHaveLength(1)
  })

  it('simula digitação ANTES de enviar', async () => {
    cenario()
    const ordem: string[] = []
    mocks.sendPresence.mockImplementation(async () => { ordem.push('presence') })
    mocks.sendText.mockImplementation(async () => { ordem.push('texto') })
    await rodarCron()
    expect(ordem).toEqual(['presence', 'texto'])
  })

  it('duas execuções do cron sobrepostas enviam a mesma notificação UMA vez só (claim atômico)', async () => {
    const db = cenario()
    await rodarCron(2)
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
    expect(nota(db).status).toBe('enviado')
  })

  it('não reenvia notificação já enviada nem em "processando"', async () => {
    cenario({ status: 'enviado' })
    await rodarCron()
    cenario({ status: 'processando' })
    await rodarCron()
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('só envia depois do horário agendado', async () => {
    cenario({ agendado_para: '2026-09-19T18:00:00.000Z' })
    await rodarCron()
    expect(mocks.sendText).not.toHaveBeenCalled()
  })
})

describe('não cobrar quem já pagou', () => {
  it('parcela paga DURANTE a simulação de digitação: não envia e cancela a notificação', async () => {
    const db = cenario()
    // A baixa cancela só notificações em "fila"; esta já está "processando" esperando a digitação.
    mocks.sendPresence.mockImplementation(async () => { db.linhas('parcelas')[0].status = 'paga' })
    await rodarCron()
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(nota(db).status).toBe('cancelado')
  })

  it('confirmação de pagamento é enviada mesmo com a parcela paga (é o objetivo dela)', async () => {
    const db = cenario({ tipo: 'pagamento_confirmado' })
    db.linhas('parcelas')[0].status = 'paga'
    await rodarCron()
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
    expect(nota(db).status).toBe('enviado')
  })

  it('erro ao consultar a parcela: não envia e devolve para "fila" (nunca arrisca cobrar quem pagou)', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'parcelas', operacao: 'select', vezes: 1 })
    await rodarCron()
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(nota(db).status).toBe('fila')
  })
})

describe('janela de envio 09:00–20:00 (America/Sao_Paulo)', () => {
  const noHorario = async (iso: string) => {
    vi.setSystemTime(new Date(iso))
    cenario()
    await rodarCron()
    return mocks.sendText.mock.calls.length
  }

  it('08:59 → não envia', async () => { expect(await noHorario('2026-09-19T11:59:00Z')).toBe(0) })
  it('09:00 → envia',     async () => { expect(await noHorario('2026-09-19T12:00:00Z')).toBe(1) })
  it('19:59 → envia',     async () => { expect(await noHorario('2026-09-19T22:59:00Z')).toBe(1) })
  it('20:00 → não envia', async () => { expect(await noHorario('2026-09-19T23:00:00Z')).toBe(0) })
  it('20:01 → não envia', async () => { expect(await noHorario('2026-09-19T23:01:00Z')).toBe(0) })

  it('respeita o horário configurado pela conta', async () => {
    vi.setSystemTime(new Date('2026-09-19T21:00:00Z')) // 18:00 SP
    cenario({}, { horario_fim: '17:00' })
    await rodarCron()
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it.each(['pagamento_confirmado', 'boasvindas', 'manual'])('%s ignora a janela (transacional)', async tipo => {
    vi.setSystemTime(new Date('2026-09-19T05:00:00Z')) // 02:00 SP
    const db = cenario({ tipo, agendado_para: '2026-09-19T04:00:00.000Z' }, {})
    if (!db.linhas('notificacoes_config').some(c => c.tipo === tipo)) {
      db.linhas('notificacoes_config').push({ conta_id: CONTA, tipo, template_whatsapp: 'oi' })
    }
    await rodarCron()
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
  })
})

describe('falhas de envio', () => {
  it('falha genérica: marca "falhou" e não trava', async () => {
    const db = cenario()
    mocks.sendText.mockRejectedValue(new Error('uazapi fora do ar'))
    await rodarCron()
    expect(nota(db).status).toBe('falhou')
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
  })

  it('rate limit da uazapi: devolve para "fila", para a conta neste tick e NÃO marca como falha', async () => {
    const db = cenario()
    mocks.sendText.mockRejectedValue(new mocks.UazapiRateLimitError('429'))
    await rodarCron()
    expect(nota(db).status).toBe('fila')
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
  })

  it('cliente apagado: cancela sem tentar enviar', async () => {
    const db = cenario()
    db.linhas('clientes')[0].deleted_at = '2026-09-01T00:00:00Z'
    await rodarCron()
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(nota(db).status).toBe('cancelado')
  })

  it('template inexistente: marca "falhou" em vez de deixar presa em "processando"', async () => {
    const db = cenario()
    db.linhas('notificacoes_config').length = 0
    await rodarCron()
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(nota(db).status).toBe('falhou')
  })

  it('o banco recusa gravar a falha: registra o erro em vez de ignorar', async () => {
    const db = cenario()
    mocks.sendText.mockRejectedValue(new Error('boom'))
    db.falhas.push({ tabela: 'notificacoes_enviadas', operacao: 'update', quando: c => c.patch?.status === 'falhou', vezes: 1 })
    await rodarCron()
    expect(console.error).toHaveBeenCalledWith(
      '[status-notificacao] update falhou',
      expect.objectContaining({ notifId: 'n1', etapa: 'envio_falhou' }),
    )
  })
})

describe('montagem do texto da mensagem', () => {
  it('banco indisponível ao resolver variáveis: NÃO envia texto errado, volta para "fila" e tenta no próximo tick', async () => {
    const db = cenario()
    mocks.resolverVariaveis.mockRejectedValue(new VariaveisIndisponiveisError('erro_banco', 'parcela: timeout'))
    await rodarCron()
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(nota(db).status).toBe('fila')
  })

  it('parcela apagada ao resolver variáveis: cancela (não fica tentando para sempre)', async () => {
    const db = cenario()
    mocks.resolverVariaveis.mockRejectedValue(new VariaveisIndisponiveisError('nao_encontrado', 'parcela'))
    await rodarCron()
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(nota(db).status).toBe('cancelado')
  })

  it('mensagem avulsa (agendada) com banco indisponível: volta para "fila"', async () => {
    const db = cenario({ tipo: 'agendada', parcela_id: null, mensagem_final: 'Oi #NOME#' })
    mocks.resolverVariaveisLeves.mockRejectedValue(new VariaveisIndisponiveisError('erro_banco', 'cliente'))
    await rodarCron()
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(nota(db).status).toBe('fila')
  })

  it('uma notificação com problema não trava as seguintes da mesma conta', async () => {
    const db = cenario()
    db.linhas('notificacoes_enviadas').push({
      id: 'n2', conta_id: CONTA, canal: 'whatsapp', status: 'fila', tipo: '3d',
      parcela_id: PARCELA, cobranca_id: null, cliente_id: CLIENTE, mensagem_final: null,
      agendado_para: '2026-09-19T10:05:00.000Z',
    })
    mocks.resolverVariaveis
      .mockRejectedValueOnce(new VariaveisIndisponiveisError('nao_encontrado', 'parcela'))
      .mockResolvedValue('mensagem pronta')
    await rodarCron()
    expect(db.linhas('notificacoes_enviadas').map(n => n.status)).toEqual(['cancelado', 'enviado'])
  })
})

describe('depois que a mensagem foi enviada', () => {
  it('falha ao gravar "enviado" é repetida e a mensagem NÃO é reenviada', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'notificacoes_enviadas', operacao: 'update', quando: c => c.patch?.status === 'enviado', vezes: 2 })
    await rodarCron()
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
    expect(nota(db).status).toBe('enviado')
  })

  it('se o banco nunca aceitar o status, avisa em voz alta e mesmo assim não reenvia', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'notificacoes_enviadas', operacao: 'update', quando: c => c.patch?.status === 'enviado', vezes: 99 })
    await rodarCron()
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
    expect(nota(db).status).toBe('processando')
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('MENSAGEM ENVIADA MAS STATUS NÃO GRAVADO'),
      expect.objectContaining({ notifId: 'n1' }),
    )
  })

  it('erro no histórico de atendimento não desfaz nem repete o envio', async () => {
    const db = cenario()
    mocks.encontrarOuCriarAtendimento.mockRejectedValue(new Error('banco caiu'))
    await rodarCron()
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
    expect(nota(db).status).toBe('enviado')
  })
})

describe('isolamento entre contas', () => {
  it('conta desconectada não envia', async () => {
    const db = cenario()
    db.linhas('conexoes')[0].status = 'desconectado'
    mocks.getAllInstances.mockResolvedValue([])
    await rodarCron()
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('não usa o token/instância de outra conta', async () => {
    const db = cenario()
    db.linhas('conexoes').push({ conta_id: 'conta-2', status: 'conectado', uazapi_instance_token: 'tok-2' })
    db.linhas('configuracoes').push({ conta_id: 'conta-2', horario_inicio: '09:00', horario_fim: '20:00', intervalo_min_seg: 45, intervalo_max_seg: 45 })
    mocks.getAllInstances.mockResolvedValue([
      { name: `inst-${CONTA}`, status: 'connected', token: 'tok', owner: '5521900000000@s.whatsapp.net' },
      { name: 'inst-conta-2', status: 'connected', token: 'tok-2', owner: '5521900000009@s.whatsapp.net' },
    ])
    await rodarCron()
    // só a notificação da conta 1 existe: deve sair pelo token 'tok', nunca 'tok-2'
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
    expect(mocks.sendText.mock.calls[0][0]).toBe('tok')
  })
})
