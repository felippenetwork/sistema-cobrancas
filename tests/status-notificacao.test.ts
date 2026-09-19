import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'
import { atualizarStatusNotificacao, vereditoLembrete } from '@/lib/whatsapp/status-notificacao'

const CONTA = 'conta-1'
const OUTRA = 'conta-2'

function cenario() {
  const db = new FakeDb({
    notificacoes_enviadas: [
      { id: 'n1', conta_id: CONTA, status: 'processando' },
      { id: 'n2', conta_id: OUTRA, status: 'processando' },
    ],
    parcelas: [
      { id: 'p-aberta', conta_id: CONTA, status: 'aberta' },
      { id: 'p-vencida', conta_id: CONTA, status: 'vencida' },
      { id: 'p-paga', conta_id: CONTA, status: 'paga' },
      { id: 'p-outra-conta', conta_id: OUTRA, status: 'aberta' },
    ],
  })
  return { db, supabase: db.cliente() as any }
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('atualizarStatusNotificacao', () => {
  it('grava o status e devolve true', async () => {
    const { db, supabase } = cenario()
    const ok = await atualizarStatusNotificacao(supabase, CONTA, 'n1', { status: 'enviado' }, 'teste')
    expect(ok).toBe(true)
    expect(db.linhas('notificacoes_enviadas')[0].status).toBe('enviado')
  })

  it('só altera notificação da própria conta (defesa além do RLS)', async () => {
    const { db, supabase } = cenario()
    await atualizarStatusNotificacao(supabase, CONTA, 'n2', { status: 'enviado' }, 'teste')
    expect(db.linhas('notificacoes_enviadas')[1].status).toBe('processando')
  })

  it('devolve false e registra o erro quando o banco falha (não ignora em silêncio)', async () => {
    const { db, supabase } = cenario()
    db.falhas.push({ tabela: 'notificacoes_enviadas', operacao: 'update', vezes: 1 })
    const ok = await atualizarStatusNotificacao(supabase, CONTA, 'n1', { status: 'enviado' }, 'pos_envio')
    expect(ok).toBe(false)
    expect(console.error).toHaveBeenCalledWith(
      '[status-notificacao] update falhou',
      expect.objectContaining({ notifId: 'n1', contaId: CONTA, etapa: 'pos_envio' }),
    )
  })

  it('repete quando pedido e grava na segunda tentativa', async () => {
    vi.useFakeTimers()
    const { db, supabase } = cenario()
    db.falhas.push({ tabela: 'notificacoes_enviadas', operacao: 'update', vezes: 1 })
    const promessa = atualizarStatusNotificacao(supabase, CONTA, 'n1', { status: 'enviado' }, 'pos_envio', 3)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await promessa).toBe(true)
    expect(db.updates('notificacoes_enviadas')).toHaveLength(2)
    expect(db.linhas('notificacoes_enviadas')[0].status).toBe('enviado')
  })

  it('desiste depois de esgotar as tentativas', async () => {
    vi.useFakeTimers()
    const { db, supabase } = cenario()
    db.falhas.push({ tabela: 'notificacoes_enviadas', operacao: 'update', vezes: 99 })
    const promessa = atualizarStatusNotificacao(supabase, CONTA, 'n1', { status: 'enviado' }, 'pos_envio', 3)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await promessa).toBe(false)
    expect(db.updates('notificacoes_enviadas')).toHaveLength(3)
  })
})

describe('vereditoLembrete', () => {
  const lembrete = (tipo: string, parcela_id: string | null) => ({ id: 'n1', tipo, parcela_id })

  it.each(['5d', '3d', '2d', '1d', 'dia', 'vencido1d'])('lembrete %s de parcela em aberto → enviar', async tipo => {
    const { supabase } = cenario()
    expect(await vereditoLembrete(supabase, CONTA, lembrete(tipo, 'p-aberta'))).toBe('enviar')
  })

  it.each(['5d', '3d', '2d', '1d', 'dia', 'vencido1d'])('lembrete %s de parcela PAGA → cancelar (não cobrar quem já pagou)', async tipo => {
    const { supabase } = cenario()
    expect(await vereditoLembrete(supabase, CONTA, lembrete(tipo, 'p-paga'))).toBe('cancelar')
  })

  it('parcela vencida continua sendo "não paga" → enviar', async () => {
    const { supabase } = cenario()
    expect(await vereditoLembrete(supabase, CONTA, lembrete('vencido1d', 'p-vencida'))).toBe('enviar')
  })

  it('parcela inexistente → cancelar', async () => {
    const { supabase } = cenario()
    expect(await vereditoLembrete(supabase, CONTA, lembrete('3d', 'nao-existe'))).toBe('cancelar')
  })

  it('parcela de OUTRA conta não vale → cancelar', async () => {
    const { supabase } = cenario()
    expect(await vereditoLembrete(supabase, CONTA, lembrete('3d', 'p-outra-conta'))).toBe('cancelar')
  })

  it('erro ao ler a parcela → tentar depois (perder um lembrete é melhor que cobrar quem pagou)', async () => {
    const { db, supabase } = cenario()
    db.falhas.push({ tabela: 'parcelas', operacao: 'select', vezes: 1 })
    expect(await vereditoLembrete(supabase, CONTA, lembrete('3d', 'p-aberta'))).toBe('tentar_depois')
  })

  it.each(['pagamento_confirmado', 'manual', 'boasvindas', 'agendada'])(
    'tipo %s não depende de a parcela estar em aberto → enviar sem nem consultar o banco',
    async tipo => {
      const { db, supabase } = cenario()
      expect(await vereditoLembrete(supabase, CONTA, lembrete(tipo, 'p-paga'))).toBe('enviar')
      expect(db.consultas.filter(c => c.tabela === 'parcelas')).toHaveLength(0)
    },
  )

  it('lembrete sem parcela_id → enviar (nada a validar)', async () => {
    const { supabase } = cenario()
    expect(await vereditoLembrete(supabase, CONTA, lembrete('3d', null))).toBe('enviar')
  })
})
