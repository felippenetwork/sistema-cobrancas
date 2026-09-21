// Regressões do envio imediato via Meta (lib/whatsapp/enviar-imediato.ts):
//  • conta uazapi: a notificação era reivindicada ('processando') e abandonada —
//    o cron da uazapi só lê 'fila', então a confirmação de pagamento e a
//    cobrança manual nunca saíam;
//  • pós-envio: uma exceção depois da Meta aceitar a mensagem devolvia a
//    notificação para 'fila' e o cron reenviava (cliente recebia 2x).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => {
  class UazapiRateLimitError extends Error {}
  return {
    db: { atual: null as unknown },
    encontrarOuCriarAtendimento: vi.fn(),
    fetch: vi.fn(),
    UazapiRateLimitError,
    sendText: vi.fn(),
  }
})

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))
vi.mock('@/lib/atendimento/encontrar-ou-criar', () => ({ encontrarOuCriarAtendimento: mocks.encontrarOuCriarAtendimento }))
vi.mock('@/lib/uazapi', () => ({ sendText: mocks.sendText, UazapiRateLimitError: mocks.UazapiRateLimitError }))

import { enviarWhatsAppImediato } from '@/lib/whatsapp/enviar-imediato'

const CONTA = 'conta-1'
const CLIENTE = 'cli-1'
const PARCELA = 'parc-1'

function cenario(opts: {
  meta: boolean; cliente?: Record<string, unknown> | null; statusNotif?: string
  uazapiConectado?: boolean; templateUazapi?: string | null
} = { meta: true }) {
  const db = new FakeDb({
    configuracoes: [opts.meta
      ? { conta_id: CONTA, meta_api_ativo: true, meta_access_token: 'tok', meta_phone_number_id: '123' }
      : { conta_id: CONTA, meta_api_ativo: null, meta_access_token: null, meta_phone_number_id: null }],
    conexoes: [{
      conta_id: CONTA,
      status:   opts.uazapiConectado === false ? 'desconectado' : 'conectado',
      uazapi_instance_token: opts.uazapiConectado === false ? null : 'uaz-tok',
    }],
    notificacoes_config: opts.templateUazapi === undefined
      ? [{ conta_id: CONTA, tipo: 'pagamento_confirmado', template_whatsapp: 'Recebemos, #NOME#! Valor #VALOR#' }]
      : (opts.templateUazapi ? [{ conta_id: CONTA, tipo: 'pagamento_confirmado', template_whatsapp: opts.templateUazapi }] : []),
    saudacoes: [],
    meios_pagamento: [],
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
  mocks.sendText.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', mocks.fetch)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// Pedido do dono do projeto (2026-09-21): confirmação de pagamento e
// boas-vindas devem sair NA HORA também em conta uazapi (QR Code), não só
// Meta — antes ficavam sempre em "fila" esperando o próximo tick do cron,
// mesmo com o WhatsApp genuinamente conectado.
describe('enviarWhatsAppImediato — conta uazapi (sem Meta, QR Code conectado)', () => {
  it('envia na hora pela uazapi, marca "enviado" e registra no histórico', async () => {
    const db = cenario({ meta: false })
    expect(await enviar('pagamento_confirmado')).toBe(true)
    expect(mocks.sendText).toHaveBeenCalledWith('uaz-tok', '5521900000001', expect.stringContaining('Maria'))
    expect(mocks.fetch).not.toHaveBeenCalled() // não passa pela Meta
    const nota = db.linhas('notificacoes_enviadas')[0]
    expect(nota.status).toBe('enviado')
    expect(db.linhas('mensagens_wa')).toHaveLength(1)
  })

  it('vale também para a cobrança manual ("Cobrar agora")', async () => {
    const db = cenario({ meta: false, templateUazapi: 'Lembrete manual, #NOME#' })
    db.linhas('notificacoes_config')[0].tipo = 'manual'
    expect(await enviar('manual')).toBe(true)
    expect(statusFinal(db)).toBe('enviado')
  })

  it('uazapi desconectada: devolve/mantém em "fila" para o cron tentar depois', async () => {
    const db = cenario({ meta: false, uazapiConectado: false })
    expect(await enviar('pagamento_confirmado')).toBe(false)
    expect(statusFinal(db)).toBe('fila')
    expect(db.updates('notificacoes_enviadas')).toHaveLength(0) // nem chega a reivindicar
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('sem template configurado para o tipo: devolve para "fila"', async () => {
    const db = cenario({ meta: false, templateUazapi: null })
    expect(await enviar('pagamento_confirmado')).toBe(false)
    expect(statusFinal(db)).toBe('fila')
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('rate limit (429) da uazapi: devolve para "fila", não marca como falha definitiva', async () => {
    const db = cenario({ meta: false })
    mocks.sendText.mockRejectedValue(new mocks.UazapiRateLimitError('429'))
    expect(await enviar('pagamento_confirmado')).toBe(false)
    expect(statusFinal(db)).toBe('fila')
  })

  it('uazapi recusa o envio: devolve para "fila" para o cron tentar de novo', async () => {
    const db = cenario({ meta: false })
    mocks.sendText.mockRejectedValue(new Error('uazapi sendText HTTP 500'))
    expect(await enviar('pagamento_confirmado')).toBe(false)
    expect(statusFinal(db)).toBe('fila')
  })

  it('conta sem Meta E sem uazapi conectada: não reivindica, fica em "fila" pro cron', async () => {
    const db = cenario({ meta: false, uazapiConectado: false })
    expect(await enviar('pagamento_confirmado')).toBe(false)
    expect(statusFinal(db)).toBe('fila')
    expect(db.updates('notificacoes_enviadas')).toHaveLength(0)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.sendText).not.toHaveBeenCalled()
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
