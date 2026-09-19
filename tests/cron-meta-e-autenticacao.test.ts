// Cron da Meta Cloud API (app/api/cron/whatsapp) + autenticação de TODOS os crons.
// Achado da auditoria de 2026-09-19: sem CRON_SECRET no servidor, "Bearer undefined"
// passava nos crons whatsapp/scheduler e o cron lookdefense ficava sem autenticação.
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => ({
  db: { atual: null as unknown },
  encontrarOuCriarAtendimento: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))
vi.mock('@/lib/atendimento/encontrar-ou-criar', () => ({ encontrarOuCriarAtendimento: mocks.encontrarOuCriarAtendimento }))

import { GET as cronMeta } from '@/app/api/cron/whatsapp/route'
import { GET as cronScheduler } from '@/app/api/cron/scheduler/route'
import { GET as cronLookDefense } from '@/app/api/cron/lookdefense/route'

const CONTA = 'conta-1'
const CLIENTE = 'cli-1'
const PARCELA = 'parc-1'
const SEGREDO = 'segredo-cron-de-teste'
const MEIO_DIA_SP = '2026-09-19T15:00:00Z'

const req = (headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/cron/x', { headers })
const autorizado = () => req({ authorization: `Bearer ${SEGREDO}` })

function cenario(notif: Record<string, unknown> = {}, config: Record<string, unknown> = {}) {
  const db = new FakeDb({
    configuracoes: [{
      conta_id: CONTA, meta_api_ativo: true, meta_access_token: 'meta-tok', meta_phone_number_id: '123',
      horario_inicio: '09:00', horario_fim: '20:00', ...config,
    }],
    notificacoes_config: [],
    clientes: [{ id: CLIENTE, conta_id: CONTA, celular: '5521900000001', nome: 'Maria', deleted_at: null }],
    parcelas: [{ id: PARCELA, conta_id: CONTA, valor: 150, data_vencimento: '2026-10-05', status: 'aberta' }],
    notificacoes_enviadas: [{
      id: 'n1', conta_id: CONTA, canal: 'whatsapp', status: 'fila', tipo: '3d',
      parcela_id: PARCELA, cobranca_id: null, cliente_id: CLIENTE, mensagem_final: null,
      agendado_para: '2026-09-19T10:00:00.000Z', ...notif,
    }],
    mensagens_wa: [],
  })
  mocks.db.atual = db.cliente()
  return db
}
const nota = (db: FakeDb) => db.linhas('notificacoes_enviadas')[0]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(MEIO_DIA_SP))
  process.env.CRON_SECRET = SEGREDO
  mocks.encontrarOuCriarAtendimento.mockReset().mockResolvedValue('atend-1')
  mocks.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', mocks.fetch)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.CRON_SECRET
})

describe.each([
  ['whatsapp (Meta)', cronMeta],
  ['scheduler', cronScheduler],
  ['lookdefense', cronLookDefense],
])('autenticação do cron %s', (_nome, GET) => {
  it('recusa sem Authorization', async () => {
    expect((await GET(req())).status).toBe(401)
  })

  it('recusa Authorization errado', async () => {
    expect((await GET(req({ authorization: 'Bearer errado' }))).status).toBe(401)
  })

  it('recusa "Bearer undefined" quando CRON_SECRET não está configurado no servidor', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(req({ authorization: 'Bearer undefined' }))).status).toBe(401)
  })

  it('recusa qualquer requisição quando CRON_SECRET não está configurado (nunca fica aberto)', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(req())).status).toBe(401)
  })
})

describe('cron da Meta — envio', () => {
  it('envia o template, marca "enviado" e registra a mensagem', async () => {
    const db = cenario()
    const res = await cronMeta(autorizado())
    expect((await res.json()).enviadas).toBe(1)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(nota(db).status).toBe('enviado')
    expect(db.linhas('mensagens_wa')).toHaveLength(1)
  })

  it('não reivindica notificação de conta sem Meta ativa (fica em "fila" para o cron da uazapi)', async () => {
    const db = cenario({}, { meta_api_ativo: false })
    await cronMeta(autorizado())
    expect(nota(db).status).toBe('fila')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('parcela paga antes do envio: não envia e cancela (a baixa só cancela "fila")', async () => {
    const db = cenario()
    db.linhas('parcelas')[0].status = 'paga'
    const res = await cronMeta(autorizado())
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(nota(db).status).toBe('cancelado')
    expect((await res.json()).cancelados).toBe(1)
  })

  it('confirmação de pagamento é enviada mesmo com a parcela paga', async () => {
    const db = cenario({ tipo: 'pagamento_confirmado' })
    db.linhas('parcelas')[0].status = 'paga'
    await cronMeta(autorizado())
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(nota(db).status).toBe('enviado')
  })

  it('erro ao consultar a parcela: não envia e devolve para "fila"', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'parcelas', operacao: 'select', vezes: 1, quando: c => c.filtros.some(f => f.col === 'id' && f.tipo === 'eq') && c.filtros.length === 2 })
    await cronMeta(autorizado())
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(nota(db).status).toBe('fila')
  })

  it('lembrete fora da janela 09–20h volta para "fila" sem enviar', async () => {
    vi.setSystemTime(new Date('2026-09-19T23:00:00Z')) // 20:00 SP
    const db = cenario()
    await cronMeta(autorizado())
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(nota(db).status).toBe('fila')
  })

  it('a Meta recusa (erro genérico): marca "falhou"', async () => {
    const db = cenario()
    mocks.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'parâmetro inválido' } }) })
    await cronMeta(autorizado())
    expect(nota(db).status).toBe('falhou')
  })

  it('fora da janela de serviço da Meta (131026): reagenda para amanhã 09:00 e volta para "fila"', async () => {
    const db = cenario()
    mocks.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: '(#131026) Message undeliverable' } }) })
    await cronMeta(autorizado())
    expect(nota(db).status).toBe('fila')
    expect(nota(db).agendado_para).toBe(new Date('2026-09-20T09:00:00-03:00').toISOString())
  })

  it('erro no histórico de atendimento depois do envio não devolve a notificação para "fila"', async () => {
    const db = cenario()
    mocks.encontrarOuCriarAtendimento.mockRejectedValue(new Error('banco caiu'))
    await cronMeta(autorizado())
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(nota(db).status).toBe('enviado')
  })

  it('falha ao gravar "enviado" é repetida e a mensagem não é reenviada', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'notificacoes_enviadas', operacao: 'update', quando: c => c.patch?.status === 'enviado', vezes: 2 })
    const execucao = cronMeta(autorizado())
    await vi.advanceTimersByTimeAsync(5_000)
    await execucao
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(nota(db).status).toBe('enviado')
  })

  it('duas execuções sobrepostas enviam a mesma notificação uma vez só', async () => {
    cenario()
    await Promise.all([cronMeta(autorizado()), cronMeta(autorizado())])
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
