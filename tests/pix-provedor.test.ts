// Despachante de PIX (lib/pagamentos/pix): escolhe o provedor ativo da conta e — o ponto de
// segurança — usa o VALOR DA PARCELA lida no banco, nunca um valor vindo do navegador.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => ({
  db: { atual: null as unknown },
  efibank: vi.fn(),
  mercadopago: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))
vi.mock('@/lib/efibank/pix', () => ({ criarCobrancaPix: mocks.efibank }))
vi.mock('@/lib/mercadopago/pix', () => ({ criarCobrancaPixMercadoPago: mocks.mercadopago }))

import { criarCobrancaPixDaConta } from '@/lib/pagamentos/pix'

const CONTA = 'conta-1'
const PARCELA = 'parc-1'
const PIX = { txid: 'T1', pixCopiaCola: '0002', qrCodeBase64: null, linkPagamento: null, expiraEm: '2026-10-01T00:00:00Z' }

function cenario(opts: { provedor?: string | null; parcela?: Record<string, unknown> | null } = {}) {
  const db = new FakeDb({
    parcelas: opts.parcela === null ? [] : [{ id: PARCELA, conta_id: CONTA, valor: '150.00', status: 'aberta', ...opts.parcela }],
    configuracoes: opts.provedor === null ? [] : [{ conta_id: CONTA, pix_provedor: opts.provedor ?? 'efibank' }],
  })
  mocks.db.atual = db.cliente()
  return db
}

beforeEach(() => {
  mocks.efibank.mockReset().mockResolvedValue(PIX)
  mocks.mercadopago.mockReset().mockResolvedValue(PIX)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('escolha do provedor', () => {
  it('provedor ativo EfiBank: gera pela EfiBank', async () => {
    cenario({ provedor: 'efibank' })
    expect(await criarCobrancaPixDaConta(CONTA, PARCELA, 'Mensalidade')).toEqual(PIX)
    expect(mocks.efibank).toHaveBeenCalledWith(CONTA, PARCELA, 150, 'Mensalidade')
    expect(mocks.mercadopago).not.toHaveBeenCalled()
  })

  it('provedor ativo Mercado Pago: gera pelo Mercado Pago', async () => {
    cenario({ provedor: 'mercadopago' })
    expect(await criarCobrancaPixDaConta(CONTA, PARCELA)).toEqual(PIX)
    expect(mocks.mercadopago).toHaveBeenCalledWith(CONTA, PARCELA, 150, undefined)
    expect(mocks.efibank).not.toHaveBeenCalled()
  })

  it('conta sem linha de configuração (nunca escolheu): continua na EfiBank', async () => {
    cenario({ provedor: null })
    await criarCobrancaPixDaConta(CONTA, PARCELA)
    expect(mocks.efibank).toHaveBeenCalled()
    expect(mocks.mercadopago).not.toHaveBeenCalled()
  })

  it('valor desconhecido no provedor cai na EfiBank (o banco só aceita os dois, mas o código não presume)', async () => {
    cenario({ provedor: 'outro' })
    await criarCobrancaPixDaConta(CONTA, PARCELA)
    expect(mocks.efibank).toHaveBeenCalled()
    expect(mocks.mercadopago).not.toHaveBeenCalled()
  })

  it('devolve o erro do provedor sem mascarar', async () => {
    cenario({ provedor: 'mercadopago' })
    mocks.mercadopago.mockResolvedValue({ erro: 'Mercado Pago não configurado.' })
    expect(await criarCobrancaPixDaConta(CONTA, PARCELA)).toEqual({ erro: 'Mercado Pago não configurado.' })
  })
})

describe('o valor e a parcela vêm do banco, escopados pela conta', () => {
  it('cobra o valor da parcela (numeric do banco vem como texto)', async () => {
    cenario({ parcela: { valor: '1234.56' } })
    await criarCobrancaPixDaConta(CONTA, PARCELA)
    expect(mocks.efibank).toHaveBeenCalledWith(CONTA, PARCELA, 1234.56, undefined)
  })

  it('parcela de OUTRA conta: erro e nenhum provedor é chamado', async () => {
    cenario({ parcela: { conta_id: 'conta-2' } })
    expect(await criarCobrancaPixDaConta(CONTA, PARCELA)).toEqual({ erro: 'Parcela não encontrada.' })
    expect(mocks.efibank).not.toHaveBeenCalled()
    expect(mocks.mercadopago).not.toHaveBeenCalled()
  })

  it('parcela inexistente: erro', async () => {
    cenario({ parcela: null })
    expect(await criarCobrancaPixDaConta(CONTA, PARCELA)).toEqual({ erro: 'Parcela não encontrada.' })
    expect(mocks.efibank).not.toHaveBeenCalled()
  })

  it('parcela já paga: não gera PIX (não cobrar quem pagou)', async () => {
    cenario({ parcela: { status: 'paga' } })
    expect(await criarCobrancaPixDaConta(CONTA, PARCELA)).toEqual({ erro: 'Esta parcela já está paga.' })
    expect(mocks.efibank).not.toHaveBeenCalled()
    expect(mocks.mercadopago).not.toHaveBeenCalled()
  })

  it('erro ao ler a parcela: erro, sem chamar provedor', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'parcelas', operacao: 'select', vezes: 1 })
    expect(await criarCobrancaPixDaConta(CONTA, PARCELA)).toHaveProperty('erro')
    expect(mocks.efibank).not.toHaveBeenCalled()
  })

  it('erro ao ler a configuração: erro, sem chamar provedor', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'configuracoes', operacao: 'select', vezes: 1 })
    expect(await criarCobrancaPixDaConta(CONTA, PARCELA)).toHaveProperty('erro')
    expect(mocks.efibank).not.toHaveBeenCalled()
    expect(mocks.mercadopago).not.toHaveBeenCalled()
  })
})
