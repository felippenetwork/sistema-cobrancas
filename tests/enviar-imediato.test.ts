// Regressões do envio imediato via Meta (lib/whatsapp/enviar-imediato.ts):
//  • conta uazapi: a notificação era reivindicada ('processando') e abandonada —
//    o cron da uazapi só lê 'fila', então a confirmação de pagamento e a
//    cobrança manual nunca saíam;
//  • pós-envio: uma exceção depois da Meta aceitar a mensagem devolvia a
//    notificação para 'fila' e o cron reenviava (cliente recebia 2x).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => ({
  db: { atual: null as unknown },
  encontrarOuCriarAtendimento: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))
vi.mock('@/lib/atendimento/encontrar-ou-criar', () => ({ encontrarOuCriarAtendimento: mocks.encontrarOuCriarAtendimento }))

import { enviarWhatsAppImediato } from '@/lib/whatsapp/enviar-imediato'

const CONTA = 'conta-1'
const CLIENTE = 'cli-1'
const PARCELA = 'parc-1'

function cenario(opts: { meta: boolean; cliente?: Record<string, unknown> | null; statusNotif?: string } = { meta: true }) {
  const db = new FakeDb({
    configuracoes: [opts.meta
      ? { conta_id: CONTA, meta_api_ativo: true, meta_access_token: 'tok', meta_phone_number_id: '123' }
      : { conta_id: CONTA, meta_api_ativo: null, meta_access_token: null, meta_phone_number_id: null }],
    notificacoes_config: [],
    clientes: opts.cliente === null ? [] : [{ id: CLIENTE, conta_id: CONTA, celular: '5521900000001', nome: 'Maria', deleted_at: null, ...opts.cliente }],
    parcelas: [{ id: PARCELA, conta_id: CONTA, valor: 150, data_vencimento: '2026-10-05', status: 'paga' }],
    notificacoes_enviadas: [{ id: 'n1', conta_id: CONTA, status: opts.statusNotif ?? 'fila' }],
    mensagens_wa: [],
  })
  mocks.db.atual = db.cliente()
  return db
}

const enviar = (tipo = 'pagamento_confirmado') => enviarWhatsAppImediato(CONTA, 'n1', PARCELA, null, CLIENTE, tipo)
const statusFinal = (db: FakeDb) => db.linhas('notificacoes_enviadas')[0].status

beforeEach(() => {
  mocks.encontrarOuCriarAtendimento.mockReset().mockResolvedValue('atend-1')
  mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', mocks.fetch)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('enviarWhatsAppImediato — conta sem Meta (uazapi)', () => {
  it('não reivindica a notificação: ela continua em "fila" para o cron da uazapi enviar', async () => {
    const db = cenario({ meta: false })
    expect(await enviar('pagamento_confirmado')).toBe(false)
    expect(statusFinal(db)).toBe('fila')
    expect(db.updates('notificacoes_enviadas')).toHaveLength(0)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('vale também para a cobrança manual ("Cobrar agora")', async () => {
    const db = cenario({ meta: false })
    await enviar('manual')
    expect(statusFinal(db)).toBe('fila')
  })
})

describe('enviarWhatsAppImediato — conta com Meta', () => {
  it('envia, marca "enviado" com o texto e registra a mensagem no histórico', async () => {
    const db = cenario()
    expect(await enviar()).toBe(true)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const nota = db.linhas('notificacoes_enviadas')[0]
    expect(nota.status).toBe('enviado')
    expect(nota.mensagem_final).toContain('Maria')
    expect(nota.enviado_em).toBeTruthy()
    expect(db.linhas('mensagens_wa')).toHaveLength(1)
  })

  it('não envia se outro processo já reivindicou a notificação', async () => {
    const db = cenario({ meta: true, statusNotif: 'processando' })
    expect(await enviar()).toBe(false)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(statusFinal(db)).toBe('processando')
  })

  it('cliente apagado: devolve para "fila" em vez de deixar presa em "processando"', async () => {
    const db = cenario({ meta: true, cliente: { deleted_at: '2026-09-01T00:00:00Z' } })
    expect(await enviar()).toBe(false)
    expect(statusFinal(db)).toBe('fila')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('cliente sem celular: devolve para "fila"', async () => {
    const db = cenario({ meta: true, cliente: { celular: null } })
    await enviar()
    expect(statusFinal(db)).toBe('fila')
  })

  it('tipo sem template Meta: devolve para "fila"', async () => {
    const db = cenario()
    await enviar('agendada')
    expect(statusFinal(db)).toBe('fila')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('a Meta recusa o envio: devolve para "fila" para o cron tentar de novo', async () => {
    const db = cenario()
    mocks.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'inválido' } }) })
    expect(await enviar()).toBe(false)
    expect(statusFinal(db)).toBe('fila')
  })

  it('erro DEPOIS do envio (histórico de atendimento) não devolve para "fila" — senão o cliente recebe 2x', async () => {
    const db = cenario()
    mocks.encontrarOuCriarAtendimento.mockRejectedValue(new Error('banco caiu'))
    expect(await enviar()).toBe(true)
    expect(statusFinal(db)).toBe('enviado')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('falha ao gravar "enviado" é repetida e nunca reenvia a mensagem', async () => {
    vi.useFakeTimers()
    const db = cenario()
    db.falhas.push({ tabela: 'notificacoes_enviadas', operacao: 'update', quando: c => c.patch?.status === 'enviado', vezes: 2 })
    const promessa = enviar()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await promessa).toBe(true)
    expect(statusFinal(db)).toBe('enviado')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
