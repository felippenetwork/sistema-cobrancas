// Autenticação de todos os crons (whatsapp-uazapi, scheduler, lookdefense).
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

import { GET as cronScheduler } from '@/app/api/cron/scheduler/route'
import { GET as cronLookDefense } from '@/app/api/cron/lookdefense/route'

const SEGREDO = 'segredo-cron-de-teste'
const MEIO_DIA_SP = '2026-09-19T15:00:00Z'

const req = (headers: Record<string, string> = {}) => new NextRequest('http://localhost/api/cron/x', { headers })
const autorizado = () => req({ authorization: `Bearer ${SEGREDO}` })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(MEIO_DIA_SP))
  process.env.CRON_SECRET = SEGREDO
  mocks.db.atual = new FakeDb({}).cliente()
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
