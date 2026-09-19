// "Forçar envio" do Log (app/(app)/log/_actions/log.ts).
// Bug: a action marca a notificação como 'cancelado' ao reivindicá-la e, se algo
// falhava depois (WhatsApp desconectado, erro de rede, template ausente...), ela
// ficava CANCELADA — um lembrete que estava na fila era perdido em silêncio.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => ({
  db: { atual: null as unknown },
  encontrarOuCriarAtendimento: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'conta-1' } }) }) }) }),
  }),
}))
vi.mock('@/lib/atendimento/encontrar-ou-criar', () => ({ encontrarOuCriarAtendimento: mocks.encontrarOuCriarAtendimento }))

import { forcarEnvioAction } from '@/app/(app)/log/_actions/log'

const CONTA = 'conta-1'
const NOME_INSTANCIA = 'quitaconta1' // quita + conta_id sem hífens, 10 primeiros caracteres

function cenario(opts: { status?: string; meta?: boolean; tipo?: string; contaDaNotif?: string } = {}) {
  const db = new FakeDb({
    notificacoes_enviadas: [{
      id: 'n1', conta_id: opts.contaDaNotif ?? CONTA, canal: 'whatsapp', status: opts.status ?? 'fila',
      tipo: opts.tipo ?? '3d', parcela_id: 'p1', cobranca_id: null, cliente_id: 'c1', mensagem_final: null,
    }],
    clientes: [{ id: 'c1', conta_id: CONTA, celular: '5521900000001', nome: 'Maria', sobrenome: 'Silva', deleted_at: null }],
    parcelas: [{ id: 'p1', conta_id: CONTA, valor: 150, data_vencimento: '2026-10-05' }],
    saudacoes: [],
    meios_pagamento: [],
    notificacoes_config: [{ conta_id: CONTA, tipo: '3d', template_whatsapp: 'Olá #NOME#, #VALOR#' }],
    configuracoes: [opts.meta
      ? { conta_id: CONTA, meta_api_ativo: true, meta_access_token: 'meta-tok', meta_phone_number_id: '123' }
      : { conta_id: CONTA, meta_api_ativo: false, meta_access_token: null, meta_phone_number_id: null }],
    mensagens_wa: [],
  })
  mocks.db.atual = db.cliente()
  return db
}
const status = (db: FakeDb) => db.linhas('notificacoes_enviadas')[0].status

/** Respostas da uazapi: lista de instâncias e envio. */
function uazapi(opts: { conectada?: boolean; envioOk?: boolean } = {}) {
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/instance/all')) {
      return { ok: true, json: async () => [{ name: NOME_INSTANCIA, status: opts.conectada === false ? 'disconnected' : 'connected', token: 'tok' }] }
    }
    if (url.endsWith('/send/text')) {
      return opts.envioOk === false
        ? { ok: false, status: 500, json: async () => ({ error: 'stack trace interno da uazapi' }) }
        : { ok: true, json: async () => ({}) }
    }
    throw new Error(`fetch inesperado: ${url}`)
  })
}

beforeEach(() => {
  process.env.UAZAPI_URL = 'https://uazapi.exemplo.test'
  process.env.UAZAPI_ADMIN_TOKEN = 'admin'
  mocks.encontrarOuCriarAtendimento.mockReset().mockResolvedValue('atend-1')
  mocks.fetch.mockReset()
  vi.stubGlobal('fetch', mocks.fetch)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.UAZAPI_URL
  delete process.env.UAZAPI_ADMIN_TOKEN
})

describe('forcarEnvioAction — uazapi', () => {
  it('envia, marca "enviado" e registra o texto', async () => {
    const db = cenario()
    uazapi()
    expect(await forcarEnvioAction('n1')).toEqual({})
    expect(status(db)).toBe('enviado')
    expect(db.linhas('notificacoes_enviadas')[0].mensagem_final).toMatch(/^Olá Maria, R\$\s150,00$/)
  })

  it('WhatsApp desconectado: devolve erro e a notificação VOLTA para "fila" (não fica cancelada)', async () => {
    const db = cenario({ status: 'fila' })
    uazapi({ conectada: false })
    const res = await forcarEnvioAction('n1')
    expect(res.error).toMatch(/desconectado/i)
    expect(status(db)).toBe('fila')
  })

  // Achado real (2026-09-19): a versão antiga fazia o próprio fetch em
  // '/instance/all' e tratava QUALQUER falha (rede, 429 de rate limit da
  // uazapi) como "instância não encontrada" — reportando "WhatsApp
  // desconectado" mesmo com a conexão ok, só porque a checagem em si esbarrou
  // num rate limit transitório. Corrigido reutilizando getAllInstances()/
  // UazapiRateLimitError de lib/uazapi.ts (mesmo helper do cron).
  it('rate limit (429) ao consultar instâncias: NÃO reporta "desconectado", pede para tentar de novo', async () => {
    const db = cenario({ status: 'fila' })
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/instance/all')) return { status: 429, ok: false }
      throw new Error(`fetch inesperado: ${url}`)
    })
    const res = await forcarEnvioAction('n1')
    expect(res.error).toMatch(/rate limit/i)
    expect(res.error).not.toMatch(/desconectado/i)
    expect(status(db)).toBe('fila')
  })

  it('rate limit (429) ao enviar: NÃO reporta como recusa definitiva, pede para tentar de novo', async () => {
    const db = cenario({ status: 'fila' })
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/instance/all')) return { ok: true, json: async () => [{ name: NOME_INSTANCIA, status: 'connected', token: 'tok' }] }
      if (url.endsWith('/send/text'))    return { status: 429, ok: false }
      throw new Error(`fetch inesperado: ${url}`)
    })
    const res = await forcarEnvioAction('n1')
    expect(res.error).toMatch(/rate limit/i)
    expect(status(db)).toBe('fila')
  })

  it('forçar uma notificação CANCELADA que falha continua cancelada (não vira "fila" e sai sozinha depois)', async () => {
    const db = cenario({ status: 'cancelado' })
    uazapi({ conectada: false })
    await forcarEnvioAction('n1')
    expect(status(db)).toBe('cancelado')
  })

  it('uazapi recusa o envio: restaura o status e NÃO devolve o texto cru da uazapi para a tela', async () => {
    const db = cenario({ status: 'fila' })
    uazapi({ envioOk: false })
    const res = await forcarEnvioAction('n1')
    expect(res.error).toBeTruthy()
    expect(res.error).not.toContain('stack trace')
    expect(status(db)).toBe('fila')
  })

  it('erro de rede ao enviar: restaura o status', async () => {
    const db = cenario({ status: 'fila' })
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/instance/all')) return { ok: true, json: async () => [{ name: NOME_INSTANCIA, status: 'connected', token: 'tok' }] }
      throw new Error('ECONNRESET')
    })
    expect((await forcarEnvioAction('n1')).error).toMatch(/rede/i)
    expect(status(db)).toBe('fila')
  })

  it('banco indisponível ao montar o texto: não envia e restaura o status', async () => {
    const db = cenario({ status: 'fila' })
    uazapi()
    db.falhas.push({ tabela: 'parcelas', operacao: 'select', vezes: 1 })
    const res = await forcarEnvioAction('n1')
    expect(res.error).toMatch(/tente novamente/i)
    expect(status(db)).toBe('fila')
    expect(mocks.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/send/text'), expect.anything())
  })

  it('template não configurado: restaura o status', async () => {
    const db = cenario({ status: 'fila' })
    db.linhas('notificacoes_config').length = 0
    expect((await forcarEnvioAction('n1')).error).toMatch(/template/i)
    expect(status(db)).toBe('fila')
  })

  it('cliente apagado: restaura o status', async () => {
    const db = cenario({ status: 'fila' })
    db.linhas('clientes')[0].deleted_at = '2026-09-01T00:00:00Z'
    expect((await forcarEnvioAction('n1')).error).toMatch(/cliente/i)
    expect(status(db)).toBe('fila')
  })

  it('não mexe em notificação de OUTRA conta', async () => {
    const db = cenario({ contaDaNotif: 'conta-2' })
    expect((await forcarEnvioAction('n1')).error).toMatch(/não encontrada/i)
    expect(status(db)).toBe('fila')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('não reenvia notificação que já foi enviada', async () => {
    const db = cenario({ status: 'enviado' })
    uazapi()
    expect((await forcarEnvioAction('n1')).error).toMatch(/não encontrada/i)
    expect(status(db)).toBe('enviado')
  })

  it('falha ao gravar "enviado" é repetida e a mensagem não é reenviada', async () => {
    vi.useFakeTimers()
    const db = cenario()
    uazapi()
    db.falhas.push({ tabela: 'notificacoes_enviadas', operacao: 'update', quando: c => c.patch?.status === 'enviado', vezes: 2 })
    const promessa = forcarEnvioAction('n1')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await promessa).toEqual({})
    expect(status(db)).toBe('enviado')
    expect(mocks.fetch.mock.calls.filter(([u]) => String(u).endsWith('/send/text'))).toHaveLength(1)
    vi.useRealTimers()
  })
})

describe('forcarEnvioAction — Meta Cloud API', () => {
  it('Meta recusa o envio: restaura o status original em vez de forçar "fila"', async () => {
    const db = cenario({ meta: true, status: 'cancelado' })
    mocks.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'inválido' } }) })
    expect((await forcarEnvioAction('n1')).error).toMatch(/Meta/)
    expect(status(db)).toBe('cancelado')
  })

  it('erro de rede na Meta: restaura o status', async () => {
    const db = cenario({ meta: true, status: 'fila' })
    mocks.fetch.mockRejectedValue(new Error('ECONNRESET'))
    await forcarEnvioAction('n1')
    expect(status(db)).toBe('fila')
  })

  it('erro ao ler a parcela: não envia com valor em branco e restaura o status', async () => {
    const db = cenario({ meta: true, status: 'fila' })
    db.falhas.push({ tabela: 'parcelas', operacao: 'select', vezes: 1 })
    expect((await forcarEnvioAction('n1')).error).toMatch(/parcela/i)
    expect(status(db)).toBe('fila')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('erro no histórico de atendimento depois do envio não reverte o status', async () => {
    const db = cenario({ meta: true })
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    mocks.encontrarOuCriarAtendimento.mockRejectedValue(new Error('banco caiu'))
    expect(await forcarEnvioAction('n1')).toEqual({})
    expect(status(db)).toBe('enviado')
  })
})
