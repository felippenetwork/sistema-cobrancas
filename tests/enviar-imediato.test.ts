// Regressões do envio imediato via uazapi (lib/whatsapp/enviar-imediato.ts):
//  • conta desconectada: a notificação era reivindicada ('processando') e abandonada —
//    o cron só lê 'fila', então a confirmação de pagamento e a cobrança manual
//    nunca saíam;
//  • pós-envio: uma exceção depois do sendText aceitar a mensagem devolvia a
//    notificação para 'fila' e o cron reenviava (cliente recebia 2x).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => {
  class UazapiRateLimitError extends Error {}
  return {
    db: { atual: null as unknown },
    encontrarOuCriarAtendimento: vi.fn(),
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
  cliente?: Record<string, unknown> | null; statusNotif?: string
  uazapiConectado?: boolean; templateUazapi?: string | null
} = {}) {
  const db = new FakeDb({
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
  mocks.sendText.mockReset().mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

// Pedido do dono do projeto (2026-09-21): confirmação de pagamento e
// boas-vindas devem sair NA HORA, sem esperar o próximo tick do cron, desde
// que a uazapi (QR Code) esteja conectada.
describe('enviarWhatsAppImediato', () => {
  it('envia na hora pela uazapi, marca "enviado" e registra no histórico', async () => {
    const db = cenario()
    expect(await enviar('pagamento_confirmado')).toBe(true)
    expect(mocks.sendText).toHaveBeenCalledWith('uaz-tok', '5521900000001', expect.stringContaining('Maria'))
    const nota = db.linhas('notificacoes_enviadas')[0]
    expect(nota.status).toBe('enviado')
    expect(db.linhas('mensagens_wa')).toHaveLength(1)
  })

  it('vale também para a cobrança manual ("Cobrar agora")', async () => {
    const db = cenario({ templateUazapi: 'Lembrete manual, #NOME#' })
    db.linhas('notificacoes_config')[0].tipo = 'manual'
    expect(await enviar('manual')).toBe(true)
    expect(statusFinal(db)).toBe('enviado')
  })

  it('uazapi desconectada: devolve/mantém em "fila" para o cron tentar depois', async () => {
    const db = cenario({ uazapiConectado: false })
    expect(await enviar('pagamento_confirmado')).toBe(false)
    expect(statusFinal(db)).toBe('fila')
    expect(db.updates('notificacoes_enviadas')).toHaveLength(0) // nem chega a reivindicar
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('sem template configurado para o tipo: devolve para "fila"', async () => {
    const db = cenario({ templateUazapi: null })
    expect(await enviar('pagamento_confirmado')).toBe(false)
    expect(statusFinal(db)).toBe('fila')
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('rate limit (429) da uazapi: devolve para "fila", não marca como falha definitiva', async () => {
    const db = cenario()
    mocks.sendText.mockRejectedValue(new mocks.UazapiRateLimitError('429'))
    expect(await enviar('pagamento_confirmado')).toBe(false)
    expect(statusFinal(db)).toBe('fila')
  })

  it('uazapi recusa o envio: devolve para "fila" para o cron tentar de novo', async () => {
    const db = cenario()
    mocks.sendText.mockRejectedValue(new Error('uazapi sendText HTTP 500'))
    expect(await enviar('pagamento_confirmado')).toBe(false)
    expect(statusFinal(db)).toBe('fila')
  })

  it('não envia se outro processo já reivindicou a notificação', async () => {
    const db = cenario({ statusNotif: 'processando' })
    expect(await enviar()).toBe(false)
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(statusFinal(db)).toBe('processando')
  })

  it('cliente apagado: devolve para "fila" em vez de deixar presa em "processando"', async () => {
    const db = cenario({ cliente: { deleted_at: '2026-09-01T00:00:00Z' } })
    expect(await enviar()).toBe(false)
    expect(statusFinal(db)).toBe('fila')
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('cliente sem celular: devolve para "fila"', async () => {
    const db = cenario({ cliente: { celular: null } })
    await enviar()
    expect(statusFinal(db)).toBe('fila')
  })

  it('tipo sem cliente cadastrado: devolve para "fila"', async () => {
    const db = cenario({ cliente: null })
    await enviar()
    expect(statusFinal(db)).toBe('fila')
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('erro DEPOIS do envio (histórico de atendimento) não devolve para "fila" — senão o cliente recebe 2x', async () => {
    const db = cenario()
    mocks.encontrarOuCriarAtendimento.mockRejectedValue(new Error('banco caiu'))
    expect(await enviar()).toBe(true)
    expect(statusFinal(db)).toBe('enviado')
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
  })

  it('falha ao gravar "enviado" é repetida e nunca reenvia a mensagem', async () => {
    vi.useFakeTimers()
    const db = cenario()
    db.falhas.push({ tabela: 'notificacoes_enviadas', operacao: 'update', quando: c => c.patch?.status === 'enviado', vezes: 2 })
    const promessa = enviar()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await promessa).toBe(true)
    expect(statusFinal(db)).toBe('enviado')
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
