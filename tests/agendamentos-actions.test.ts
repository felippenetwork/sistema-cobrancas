// Ações de /agendamentos (app/(app)/agendamentos/_actions): agendar para cliente cadastrado ou
// número digitado, horário em Brasília, cliente/mídia de outra conta recusados, cancelar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => ({ db: { atual: null as unknown } }))
const CONTA = '11111111-1111-4111-8111-111111111111'
const OUTRA = '22222222-2222-4222-8222-222222222222'
const CLIENTE = '33333333-3333-4333-8333-333333333333'
const CLIENTE_OUTRA = '44444444-4444-4444-8444-444444444444'
const AG = '55555555-5555-4555-8555-555555555555'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/conta', () => ({ getConta: async () => ({ supabase: mocks.db.atual, contaId: CONTA, userId: 'u1' }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))

import { cancelarEnvioAgendadoAction, criarEnvioAgendadoAction } from '@/app/(app)/agendamentos/_actions/agendamentos'

const texto = { tipo: 'texto' as const, texto: '{{periododia}}, {{nome}}! Como combinamos.', variacoes: [], digitacao_seg: 10 }
const quando = { data: '2026-10-29', hora: '15:30' }

let db: FakeDb
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-29T13:00:00Z')) // 10:00 em SP
  db = new FakeDb({
    clientes: [
      { id: CLIENTE, conta_id: CONTA, nome: 'João', celular: '5521988887777', deleted_at: null },
      { id: CLIENTE_OUTRA, conta_id: OUTRA, nome: 'Outro', celular: '5521911112222', deleted_at: null },
    ],
    envios_agendados: [],
  })
  mocks.db.atual = db.cliente()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('agendar envio', () => {
  it('número digitado com máscara vira 55+DDD+número, com o nome, na hora de Brasília', async () => {
    const r = await criarEnvioAgendadoAction({ destino: { tipo: 'numero', celular: '(21) 99999-0001', nome: ' Maria ' }, passos: [texto], ...quando })
    expect(r.error).toBeNull()
    expect(db.linhas('envios_agendados')[0]).toMatchObject({
      conta_id: CONTA, cliente_id: null, celular: '5521999990001', nome: 'Maria',
      agendado_para: '2026-10-29T18:30:00.000Z', passos: [texto],
    })
  })

  it('cliente cadastrado: usa o número e o nome do cadastro', async () => {
    expect((await criarEnvioAgendadoAction({ destino: { tipo: 'cliente', clienteId: CLIENTE }, passos: [texto], ...quando })).error).toBeNull()
    expect(db.linhas('envios_agendados')[0]).toMatchObject({ cliente_id: CLIENTE, celular: '5521988887777', nome: 'João' })
  })

  it('cliente de outra conta responde "não encontrado" e nada é gravado', async () => {
    const r = await criarEnvioAgendadoAction({ destino: { tipo: 'cliente', clienteId: CLIENTE_OUTRA }, passos: [texto], ...quando })
    expect(r.error).toBe('Cliente não encontrado.')
    expect(db.linhas('envios_agendados')).toHaveLength(0)
  })

  it('recusa horário que já passou, número inválido e mídia de outra conta', async () => {
    const numero = { tipo: 'numero' as const, celular: '21999990001', nome: '' }
    expect((await criarEnvioAgendadoAction({ destino: numero, passos: [texto], data: '2026-10-29', hora: '09:59' })).error).toMatch(/já passou|ainda não passou/)
    expect((await criarEnvioAgendadoAction({ destino: { ...numero, celular: '1234' }, passos: [texto], ...quando })).error).toMatch(/inválido/)
    const midia = { tipo: 'imagem' as const, caminho: `contas/${OUTRA}/x.jpg`, nome_arquivo: 'x.jpg', legenda: null, digitacao_seg: 5 }
    expect((await criarEnvioAgendadoAction({ destino: numero, passos: [midia], ...quando })).error).toMatch(/mídia inválido/)
    expect(db.linhas('envios_agendados')).toHaveLength(0)
  })

  it('sem nome, o nome fica vazio (o {{nome}} some da frase na hora do envio)', async () => {
    await criarEnvioAgendadoAction({ destino: { tipo: 'numero', celular: '21999990001', nome: '' }, passos: [texto], ...quando })
    expect(db.linhas('envios_agendados')[0].nome).toBeNull()
  })
})

describe('cancelar', () => {
  it('cancela o pendente da conta; enviado ou de outra conta não', async () => {
    db = new FakeDb({
      envios_agendados: [
        { id: AG, conta_id: CONTA, status: 'pendente' },
        { id: '66666666-6666-4666-8666-666666666666', conta_id: CONTA, status: 'enviado' },
        { id: '77777777-7777-4777-8777-777777777777', conta_id: OUTRA, status: 'pendente' },
      ],
    })
    mocks.db.atual = db.cliente()
    expect((await cancelarEnvioAgendadoAction(AG)).error).toBeNull()
    expect((await cancelarEnvioAgendadoAction('66666666-6666-4666-8666-666666666666')).error).toMatch(/já saiu/)
    expect((await cancelarEnvioAgendadoAction('77777777-7777-4777-8777-777777777777')).error).toMatch(/já saiu/)
    expect(db.linhas('envios_agendados').map(l => l.status)).toEqual(['cancelado', 'enviado', 'pendente'])
  })
})
