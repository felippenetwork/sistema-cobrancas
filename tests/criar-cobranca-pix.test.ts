// Regressão: criarCobrancaPix ignorava o erro ao gravar a cobrança em cobrancas_pix e
// entregava o código PIX mesmo assim. Quando o cliente pagasse, o webhook da EfiBank não
// acharia o txid e o pagamento ficaria sem baixa.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => ({
  db: { atual: null as unknown },
  getEfiCreds: vi.fn(),
  getEfiToken: vi.fn(),
  efiAuthRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))
vi.mock('@/lib/efibank/client', () => ({
  getEfiCreds: mocks.getEfiCreds,
  getEfiToken: mocks.getEfiToken,
  efiAuthRequest: mocks.efiAuthRequest,
  efiBaseUrl: () => 'https://pix.exemplo.test',
}))

import { criarCobrancaPix } from '@/lib/efibank/pix'

const CONTA = 'conta-1'
const PARCELA = 'parc-1'

function cenario(linhas: Record<string, unknown>[] = []) {
  const db = new FakeDb({ cobrancas_pix: linhas as Record<string, any>[] })
  mocks.db.atual = db.cliente()
  return db
}

beforeEach(() => {
  mocks.getEfiCreds.mockReset().mockResolvedValue({ clientId: 'id', clientSecret: 'sec', pixKey: 'chave', certBase64: 'cert', sandbox: true })
  mocks.getEfiToken.mockReset().mockResolvedValue('token')
  mocks.efiAuthRequest.mockReset().mockResolvedValue({
    ok: true, status: 201, data: { txid: 'TX123', pixCopiaECola: '000201PIXCOPIACOLA', loc: { id: 7 } },
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('criarCobrancaPix', () => {
  it('cria a cobrança na EfiBank, grava em cobrancas_pix e devolve o código', async () => {
    const db = cenario()
    const res = await criarCobrancaPix(CONTA, PARCELA, 150, 'Mensalidade')
    expect(res).toMatchObject({ txid: 'TX123', pixCopiaCola: '000201PIXCOPIACOLA' })
    expect(db.linhas('cobrancas_pix')).toHaveLength(1)
    expect(db.linhas('cobrancas_pix')[0]).toMatchObject({ conta_id: CONTA, parcela_id: PARCELA, txid: 'TX123', status: 'ativa', valor: 150 })
  })

  it('se NÃO conseguir gravar a cobrança, devolve erro e NÃO entrega o código PIX (senão o pagamento não seria reconhecido)', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'cobrancas_pix', operacao: 'upsert', vezes: 1 })
    const res = await criarCobrancaPix(CONTA, PARCELA, 150)
    expect(res).toHaveProperty('erro')
    expect(res).not.toHaveProperty('pixCopiaCola')
    expect(db.linhas('cobrancas_pix')).toHaveLength(0)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('código NÃO entregue'),
      expect.objectContaining({ contaId: CONTA, parcelaId: PARCELA, txid: 'TX123' }),
    )
  })

  it('reutiliza a cobrança ativa e ainda não expirada em vez de criar outra', async () => {
    cenario([{
      id: 'x', conta_id: CONTA, parcela_id: PARCELA, txid: 'TX-ANTIGO', status: 'ativa',
      pix_copia_cola: '000201ANTIGO', qr_code_base64: null, link_pagamento: null,
      expira_em: new Date(Date.now() + 30 * 60_000).toISOString(),
    }])
    const res = await criarCobrancaPix(CONTA, PARCELA, 150)
    expect(res).toMatchObject({ txid: 'TX-ANTIGO', pixCopiaCola: '000201ANTIGO' })
    expect(mocks.efiAuthRequest).not.toHaveBeenCalled()
  })

  it('cobrança expirada não é reutilizada', async () => {
    cenario([{
      id: 'x', conta_id: CONTA, parcela_id: PARCELA, txid: 'TX-VELHO', status: 'ativa',
      pix_copia_cola: '000201VELHO', expira_em: new Date(Date.now() - 60_000).toISOString(),
    }])
    const res = await criarCobrancaPix(CONTA, PARCELA, 150)
    expect(res).toMatchObject({ txid: 'TX123' })
    expect(mocks.efiAuthRequest).toHaveBeenCalled()
  })

  it('cobrança ativa de OUTRA conta não é reutilizada', async () => {
    cenario([{
      id: 'x', conta_id: 'conta-2', parcela_id: PARCELA, txid: 'TX-OUTRA', status: 'ativa',
      pix_copia_cola: '000201OUTRA', expira_em: new Date(Date.now() + 30 * 60_000).toISOString(),
    }])
    const res = await criarCobrancaPix(CONTA, PARCELA, 150)
    expect(res).toMatchObject({ txid: 'TX123' })
  })

  it('EfiBank não configurada na conta: devolve erro sem chamar a API', async () => {
    cenario()
    mocks.getEfiCreds.mockResolvedValue(null)
    expect(await criarCobrancaPix(CONTA, PARCELA, 150)).toHaveProperty('erro')
    expect(mocks.efiAuthRequest).not.toHaveBeenCalled()
  })

  it('a EfiBank recusa a criação: devolve erro e não grava nada', async () => {
    const db = cenario()
    mocks.efiAuthRequest.mockResolvedValue({ ok: false, status: 401, data: {} })
    expect(await criarCobrancaPix(CONTA, PARCELA, 150)).toHaveProperty('erro')
    expect(db.linhas('cobrancas_pix')).toHaveLength(0)
  })
})
