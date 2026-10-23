// Ação que cria o disparo progressivo (app/(app)/disparos/_actions): validação das caixinhas e
// a trava de segurança que só aceita mídia da pasta da própria conta no bucket.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => ({ db: { atual: null as unknown } }))
const CONTA = '11111111-1111-1111-1111-111111111111'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/conta', () => ({ getConta: async () => ({ supabase: mocks.db.atual, contaId: CONTA, userId: 'u1' }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))

import { criarProgressivoAction } from '@/app/(app)/disparos/_actions'

const base = {
  nome: 'Teste', lista: 'Maria; 21999990001\n21999990002', janelaInicio: '09:00', janelaFim: '18:00',
  inicio: 1, maximo: 20, etiquetaAdicionar: null, etiquetaRemover: null, registrarEnviados: true, excluirJaEnviados: false,
}
const texto = { tipo: 'texto' as const, texto: 'Oi {{nome}}', variacoes: [], digitacao_seg: 20 }

let db: FakeDb
beforeEach(() => {
  db = new FakeDb({ conexoes: [{ conta_id: CONTA, status: 'conectado', uazapi_instance_token: 'tok' }], campanhas_wa: [], campanha_destinatarios: [] })
  mocks.db.atual = db.cliente()
})

describe('criar disparo progressivo', () => {
  it('cria com as caixinhas, a lista na ordem e já "enviando"', async () => {
    const r = await criarProgressivoAction({
      ...base,
      passos: [texto, { tipo: 'imagem', caminho: `contas/${CONTA}/a.jpg`, nome_arquivo: 'a.jpg', legenda: null, digitacao_seg: 5 }],
      etiquetaAdicionar: { id: 'L2', nome: 'Lead' },
    })
    expect(r.error).toBeNull()
    const c = db.linhas('campanhas_wa')[0]
    expect(c).toMatchObject({ tipo: 'progressivo', status: 'enviando', etiqueta_adicionar: 'L2', etiqueta_adicionar_nome: 'Lead', total_destinatarios: 2 })
    expect((c.passos as unknown[]).length).toBe(2)
    expect(db.linhas('campanha_destinatarios').map(d => [d.ordem, d.celular, d.nome])).toEqual([
      [0, '5521999990001', 'Maria'], [1, '5521999990002', null],
    ])
  })

  it('recusa mídia de fora da pasta da conta (arquivo de outra conta) e não cria nada', async () => {
    const r = await criarProgressivoAction({
      ...base,
      passos: [{ tipo: 'imagem', caminho: 'contas/22222222-2222-2222-2222-222222222222/x.jpg', nome_arquivo: 'x.jpg', legenda: null, digitacao_seg: 5 }],
    })
    expect(r.error).toMatch(/mídia inválido/)
    expect(db.linhas('campanhas_wa')).toEqual([])
  })

  it('recusa caixinha de texto vazia e mídia sem arquivo', async () => {
    expect((await criarProgressivoAction({ ...base, passos: [{ ...texto, texto: '  ' }] })).error).toMatch(/vazia/)
    expect((await criarProgressivoAction({ ...base, passos: [{ tipo: 'audio', caminho: '', nome_arquivo: null, legenda: null, digitacao_seg: 8 }] })).error).toMatch(/arquivo/)
  })

  it('recusa mais de 10 mensagens por contato e digitação acima de 120 s', async () => {
    expect((await criarProgressivoAction({ ...base, passos: Array(11).fill(texto) })).error).toMatch(/10/)
    expect((await criarProgressivoAction({ ...base, passos: [{ ...texto, digitacao_seg: 121 }] })).error).not.toBeNull()
  })

  it('com o WhatsApp desconectado não cria o disparo', async () => {
    db.linhas('conexoes')[0].status = 'desconectado'
    const r = await criarProgressivoAction({ ...base, passos: [texto] })
    expect(r.error).toMatch(/não está conectado/)
    expect(db.linhas('campanhas_wa')).toEqual([])
  })
})
