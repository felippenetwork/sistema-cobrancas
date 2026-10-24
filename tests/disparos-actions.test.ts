// Disparo a partir do modelo (app/(app)/disparos/_actions e app/(app)/wa-templates/_actions):
// a sequência de mensagens mora no modelo, é validada ao salvar e COPIADA para o disparo na
// criação; mídia só da pasta da própria conta no bucket; modelo de outra conta não serve.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => ({ db: { atual: null as unknown } }))
const CONTA = '11111111-1111-1111-1111-111111111111'
const OUTRA = '22222222-2222-2222-2222-222222222222'
const MODELO = '33333333-3333-4333-8333-333333333333'
const MODELO_ANTIGO = '44444444-4444-4444-8444-444444444444'
const MODELO_OUTRA = '55555555-5555-4555-8555-555555555555'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/conta', () => ({ getConta: async () => ({ supabase: mocks.db.atual, contaId: CONTA, userId: 'u1' }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))

import { criarCampanhaAction, criarProgressivoAction } from '@/app/(app)/disparos/_actions'
import { atualizarModeloAction, criarModeloAction, excluirModeloAction } from '@/app/(app)/wa-templates/_actions'

const base = {
  nome: 'Teste', modeloId: MODELO, lista: 'Maria; 21999990001\n21999990002', janelaInicio: '09:00', janelaFim: '18:00',
  inicio: 1, maximo: 20, etiquetaAdicionar: null, etiquetaRemover: null, registrarEnviados: true, excluirJaEnviados: false,
}
const texto = { tipo: 'texto' as const, texto: 'Oi {{nome}}', variacoes: [], digitacao_seg: 20 }
const imagem = (conta: string) => ({ tipo: 'imagem' as const, caminho: `contas/${conta}/a.jpg`, nome_arquivo: 'a.jpg', legenda: null, digitacao_seg: 5 })

let db: FakeDb
beforeEach(() => {
  db = new FakeDb({
    conexoes: [{ conta_id: CONTA, status: 'conectado', uazapi_instance_token: 'tok' }],
    modelos_wa: [
      { id: MODELO, conta_id: CONTA, nome: 'Sequência', corpo: 'Oi {{nome}}', passos: [texto, imagem(CONTA)] },
      { id: MODELO_ANTIGO, conta_id: CONTA, nome: 'Antigo', corpo: 'Texto antigo', passos: null },
      { id: MODELO_OUTRA, conta_id: OUTRA, nome: 'Da outra conta', corpo: 'x', passos: [texto] },
    ],
    campanhas_wa: [], campanha_destinatarios: [],
  })
  mocks.db.atual = db.cliente()
})

describe('disparo progressivo a partir do modelo', () => {
  it('copia a sequência do modelo, grava a lista na ordem e já fica "enviando"', async () => {
    const r = await criarProgressivoAction({ ...base, etiquetaAdicionar: { id: 'L2', nome: 'Lead' } })
    expect(r.error).toBeNull()
    const c = db.linhas('campanhas_wa')[0]
    expect(c).toMatchObject({ tipo: 'progressivo', status: 'enviando', modelo_id: MODELO, etiqueta_adicionar: 'L2', total_destinatarios: 2 })
    expect(c.passos).toEqual([texto, imagem(CONTA)])
    expect(db.linhas('campanha_destinatarios').map(d => [d.ordem, d.celular, d.nome])).toEqual([
      [0, '5521999990001', 'Maria'], [1, '5521999990002', null],
    ])
  })

  it('editar o modelo depois não muda o disparo já criado (é uma cópia)', async () => {
    await criarProgressivoAction(base)
    db.linhas('modelos_wa')[0].passos = [{ ...texto, texto: 'Mudou' }]
    expect(db.linhas('campanhas_wa')[0].passos).toEqual([texto, imagem(CONTA)])
  })

  it('modelo antigo, só com texto, vira uma mensagem com 20 s de digitação', async () => {
    await criarProgressivoAction({ ...base, modeloId: MODELO_ANTIGO })
    expect(db.linhas('campanhas_wa')[0].passos).toEqual([{ tipo: 'texto', texto: 'Texto antigo', variacoes: [], digitacao_seg: 20 }])
  })

  it('modelo de outra conta responde "não encontrado" e não cria nada', async () => {
    const r = await criarProgressivoAction({ ...base, modeloId: MODELO_OUTRA })
    expect(r.error).toBe('Modelo não encontrado.')
    expect(db.linhas('campanhas_wa')).toEqual([])
  })

  it('sem modelo escolhido não cria', async () => {
    expect((await criarProgressivoAction({ ...base, modeloId: '' })).error).toMatch(/Escolha um modelo/)
    expect(db.linhas('campanhas_wa')).toEqual([])
  })

  it('modelo com mídia de fora da pasta da conta é recusado na hora do disparo', async () => {
    db.linhas('modelos_wa')[0].passos = [imagem(OUTRA)]
    const r = await criarProgressivoAction(base)
    expect(r.error).toMatch(/mídia inválido/)
    expect(db.linhas('campanhas_wa')).toEqual([])
  })

  it('com o WhatsApp desconectado não cria o disparo', async () => {
    db.linhas('conexoes')[0].status = 'desconectado'
    const r = await criarProgressivoAction(base)
    expect(r.error).toMatch(/não está conectado/)
    expect(db.linhas('campanhas_wa')).toEqual([])
  })
})

describe('disparo normal a partir do modelo', () => {
  const form = (campos: Record<string, string>) => {
    const fd = new FormData()
    Object.entries(campos).forEach(([k, v]) => fd.set(k, v))
    return fd
  }

  it('copia a sequência do modelo para o disparo', async () => {
    const r = await criarCampanhaAction({ error: null }, form({ nome: 'Julho', modelo_id: MODELO }))
    expect(r.error).toBeNull()
    expect(db.linhas('campanhas_wa')[0]).toMatchObject({ modelo_id: MODELO, status: 'rascunho', passos: [texto, imagem(CONTA)] })
  })

  it('recusa modelo de outra conta', async () => {
    const r = await criarCampanhaAction({ error: null }, form({ nome: 'Julho', modelo_id: MODELO_OUTRA }))
    expect(r.error).toBe('Modelo não encontrado.')
    expect(db.linhas('campanhas_wa')).toEqual([])
  })
})

describe('modelos (/wa-templates)', () => {
  it('cria com a sequência validada e o primeiro texto como resumo', async () => {
    const r = await criarModeloAction({ nome: 'Novo', passos: [imagem(CONTA), { ...texto, variacoes: ['Olá {{nome}}', ''] }] })
    expect(r.error).toBeNull()
    const m = db.linhas('modelos_wa').find(x => x.nome === 'Novo')
    expect(m).toMatchObject({ conta_id: CONTA, corpo: 'Oi {{nome}}', status: 'aprovado' })
    expect(m?.passos).toEqual([imagem(CONTA), { ...texto, variacoes: ['Olá {{nome}}'] }])
  })

  it('recusa mídia de outra conta, caixinha vazia, mídia sem arquivo e mais de 10 mensagens', async () => {
    expect((await criarModeloAction({ nome: 'X', passos: [imagem(OUTRA)] })).error).toMatch(/mídia inválido/)
    expect((await criarModeloAction({ nome: 'X', passos: [{ ...texto, texto: '  ' }] })).error).toMatch(/vazia/)
    expect((await criarModeloAction({ nome: 'X', passos: [{ ...imagem(CONTA), caminho: '' }] })).error).toMatch(/arquivo/)
    expect((await criarModeloAction({ nome: 'X', passos: Array(11).fill(texto) })).error).toMatch(/10/)
    expect((await criarModeloAction({ nome: 'X', passos: [{ ...texto, digitacao_seg: 121 }] })).error).not.toBeNull()
    expect(db.linhas('modelos_wa').some(m => m.nome === 'X')).toBe(false)
  })

  it('não altera modelo de outra conta', async () => {
    const r = await atualizarModeloAction(MODELO_OUTRA, { nome: 'Invadido', passos: [texto] })
    expect(r.error).toBe('Modelo não encontrado.')
    expect(db.linhas('modelos_wa').find(m => m.id === MODELO_OUTRA)?.nome).toBe('Da outra conta')
  })

  it('não exclui modelo lido por um disparo antigo (sem cópia) ainda em andamento', async () => {
    db.linhas('campanhas_wa').push({ id: 'c1', conta_id: CONTA, modelo_id: MODELO_ANTIGO, passos: null, status: 'enviando' })
    expect((await excluirModeloAction(MODELO_ANTIGO)).error).toMatch(/disparo em andamento/)
    expect(db.linhas('modelos_wa').some(m => m.id === MODELO_ANTIGO)).toBe(true)
  })

  it('exclui modelo cujos disparos já têm a própria cópia', async () => {
    db.linhas('campanhas_wa').push({ id: 'c2', conta_id: CONTA, modelo_id: MODELO, passos: [texto], status: 'enviando' })
    expect((await excluirModeloAction(MODELO)).error).toBeNull()
    expect(db.linhas('modelos_wa').some(m => m.id === MODELO)).toBe(false)
  })
})
