// Webhook da uazapi + chatbot de ponta a ponta (app/api/webhooks/chatbot, lib/chatbot/processar.ts):
// autenticação por conta, leitura do payload, mensagem repetida, trava por contato, envio com
// "digitando…", pausa quando o dono responde, SAIR e o aviso ao dono. Banco e uazapi falsos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'

const mocks = vi.hoisted(() => ({
  db: { atual: null as unknown },
  sendText: vi.fn(), sendPresence: vi.fn(), sendMedia: vi.fn(), labelsDoChat: vi.fn(),
  ordem: [] as string[],
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db.atual }))
vi.mock('@/lib/uazapi', () => ({
  sendText: mocks.sendText, sendPresence: mocks.sendPresence, sendMedia: mocks.sendMedia, labelsDoChat: mocks.labelsDoChat,
  UazapiRateLimitError: class extends Error {},
}))

import { POST } from '@/app/api/webhooks/chatbot/route'
import { lerMensagemWebhook } from '@/lib/chatbot/webhook'
import type { Etapa } from '@/lib/chatbot/fluxo'

const CONTA = '11111111-1111-4111-8111-111111111111'
const SEGREDO = 'a'.repeat(64)
const TOKEN = 'token-da-instancia'
const CLIENTE = '5521999990001'
const DONO = '5521988880000'

const texto = (t: string, seg = 20) => [{ tipo: 'texto' as const, texto: t, variacoes: [], digitacao_seg: seg }]
const ETAPAS: Etapa[] = [
  { id: 'boas', nome: 'Boas-vindas', passos: texto('Oi {{nome}}!'), resposta: { tipo: 'menu', mostrar_opcoes: true, opcoes: [
    { rotulo: 'Planos', proxima: 'cidade' }, { rotulo: 'Atendente', proxima: 'humano' },
  ] } },
  { id: 'cidade', nome: 'Cidade', passos: texto('Sua cidade?', 5), resposta: { tipo: 'texto', variavel: 'cidade', proxima: 'fim' } },
  { id: 'fim', nome: 'Fim', passos: texto('Valeu, {{cidade}}!', 5), resposta: { tipo: 'fim' } },
  { id: 'humano', nome: 'Humano', passos: texto('Já chamo.', 3), resposta: { tipo: 'humano' } },
]

let db: FakeDb
let msgSeq = 0

function cenario(extra: { conversas?: Record<string, unknown>[]; fluxo?: Record<string, unknown> } = {}) {
  db = new FakeDb({
    conexoes: [{ conta_id: CONTA, webhook_segredo: SEGREDO, uazapi_instance_token: TOKEN, numero_conectado: DONO, status: 'conectado' }],
    bot_fluxos: [{
      id: 'f1', conta_id: CONTA, nome: 'Vendas', ativo: true, etapas: ETAPAS,
      gatilho_palavras: ['menu'], gatilho_etiquetas: [], excluir_etiquetas: [], palavras_humano: ['humano'],
      msg_nao_entendi: 'Não entendi.', msg_humano: 'Chamando alguém.', aviso_numero: '5521977770000',
      ...extra.fluxo,
    }],
    bot_conversas: extra.conversas ?? [],
    bot_mensagens: [],
    campanha_destinatarios: [],
    campanhas_wa: [],
  })
  db.unicos = { bot_mensagens: [['conta_id', 'wa_id']], bot_conversas: [['conta_id', 'celular']] }
  mocks.db.atual = db.cliente()
}

const payload = (t: string, extra: Record<string, unknown> = {}, raiz: Record<string, unknown> = {}) => ({
  EventType: 'messages', token: TOKEN, owner: DONO,
  message: { chatid: `${CLIENTE}@s.whatsapp.net`, sender_pn: `${CLIENTE}@s.whatsapp.net`, senderName: 'Maria Souza 🌸', text: t, fromMe: false, wasSentByApi: false, isGroup: false, messageid: `M${++msgSeq}`, ...extra },
  ...raiz,
})

async function chamar(corpo: unknown, query = `conta=${CONTA}&s=${SEGREDO}`) {
  const req = new Request(`https://cobranx.site/api/webhooks/chatbot?${query}`, { method: 'POST', body: JSON.stringify(corpo), headers: { 'content-type': 'application/json' } })
  const { NextRequest } = await import('next/server')
  const p = POST(new NextRequest(req))
  await vi.advanceTimersByTimeAsync(200_000)
  const res = await p
  return { status: res.status, body: await res.json() as { ok: boolean; resultado?: string } }
}

const conversaDe = () => db.linhas('bot_conversas').find(c => c.celular === CLIENTE)
const enviados = () => mocks.sendText.mock.calls.map(c => [c[1], c[2]])

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-26T15:00:00Z'))
  mocks.ordem.length = 0
  mocks.sendText.mockReset().mockImplementation(async () => { mocks.ordem.push('enviou') })
  mocks.sendPresence.mockReset().mockImplementation(async (_t: string, _n: string, ms: number) => { mocks.ordem.push(`digitando ${ms}`) })
  mocks.labelsDoChat.mockReset().mockResolvedValue([])
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  cenario()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('leitura do payload', () => {
  it('ignora grupo, eco do próprio sistema e outros eventos', () => {
    expect(lerMensagemWebhook(payload('oi', { isGroup: true }))).toBeNull()
    expect(lerMensagemWebhook(payload('oi', { chatid: '123@g.us' }))).toBeNull()
    expect(lerMensagemWebhook(payload('oi', { wasSentByApi: true }))).toBeNull()
    expect(lerMensagemWebhook({ EventType: 'connection' })).toBeNull()
  })

  it('contato só por LID: usa sender_pn; sem sender_pn não dá para responder', () => {
    expect(lerMensagemWebhook(payload('oi', { chatid: '7670395519@lid' }))?.celular).toBe(CLIENTE)
    expect(lerMensagemWebhook(payload('oi', { chatid: '7670395519@lid', sender_pn: '' }))?.celular).toBeNull()
  })

  it('mensagem do dono (fromMe): o contato é o chat', () => {
    const m = lerMensagemWebhook(payload('oi', { fromMe: true, sender_pn: '' }))
    expect(m).toMatchObject({ fromMe: true, celular: CLIENTE })
  })

  it('usa as etiquetas do chat quando a uazapi manda junto', () => {
    expect(lerMensagemWebhook(payload('oi', {}, { chat: { wa_label: ['55:7'] } }))?.etiquetas).toEqual(['55:7'])
  })
})

describe('autenticação do webhook', () => {
  it('segredo errado, conta inválida ou sem segredo: 401 e nada acontece', async () => {
    expect((await chamar(payload('menu'), `conta=${CONTA}&s=${'b'.repeat(64)}`)).status).toBe(401)
    expect((await chamar(payload('menu'), `conta=xyz&s=${SEGREDO}`)).status).toBe(401)
    expect((await chamar(payload('menu'), `conta=${CONTA}`)).status).toBe(401)
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('robô não ligado (conta sem segredo): 401', async () => {
    db.linhas('conexoes')[0].webhook_segredo = null
    expect((await chamar(payload('menu'), `conta=${CONTA}&s=${SEGREDO}`)).status).toBe(401)
  })

  it('token de OUTRA instância no payload: 401 (a mensagem não é desta conta)', async () => {
    const r = await chamar(payload('menu', {}, { token: 'token-de-outra-conta' }))
    expect(r.status).toBe(401)
    expect(mocks.sendText).not.toHaveBeenCalled()
  })
})

describe('conversa com o robô', () => {
  it('palavra-chave: digita 20 s e manda a entrada com o nome e o menu', async () => {
    const r = await chamar(payload('Menu'))
    expect(r.body.resultado).toBe('iniciar')
    expect(mocks.ordem).toEqual(['digitando 20000', 'enviou'])
    expect(enviados()).toEqual([[CLIENTE, 'Oi Maria!\n\n1. Planos\n2. Atendente']])
    expect(conversaDe()).toMatchObject({ status: 'ativa', fluxo_id: 'f1', etapa_id: 'boas', ocupado_ate: null })
  })

  it('escolhe opção, responde texto (vira variável) e o fluxo termina', async () => {
    await chamar(payload('menu'))
    await chamar(payload('1'))
    expect(conversaDe()).toMatchObject({ etapa_id: 'cidade' })
    await chamar(payload('Niterói'))
    expect(enviados().at(-1)).toEqual([CLIENTE, 'Valeu, Niterói!'])
    expect(conversaDe()).toMatchObject({ status: 'encerrada', etapa_id: null, variaveis: { cidade: 'Niterói' } })
    expect(db.linhas('bot_mensagens').filter(m => m.direcao === 'recebida').map(m => m.texto)).toEqual(['menu', '1', 'Niterói'])
  })

  it('mensagem qualquer de quem não está no robô: não cria conversa nem responde', async () => {
    const r = await chamar(payload('Bom dia, já paguei'))
    expect(r.body.resultado).toBe('ignorada')
    expect(db.linhas('bot_conversas')).toEqual([])
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('a uazapi entrega a mesma mensagem 2x: responde uma vez só', async () => {
    const p = payload('menu')
    await chamar(p)
    const r = await chamar(p)
    expect(r.body.resultado).toBe('repetida')
    expect(mocks.sendText).toHaveBeenCalledTimes(1)
  })

  it('mensagem que chega enquanto o robô ainda digita fica no histórico, sem resposta dupla', async () => {
    cenario({ conversas: [{ id: 'c1', conta_id: CONTA, celular: CLIENTE, nome: 'Maria', status: 'ativa', fluxo_id: 'f1', etapa_id: 'boas', variaveis: {}, nao_entendi: 0, versao: 3, ocupado_ate: '2026-10-26T15:02:00Z', atualizado_em: '2026-10-26T14:59:00Z', iniciado_em: '2026-10-26T14:59:00Z' }] })
    const r = await chamar(payload('1'))
    expect(r.body.resultado).toBe('ocupado')
    expect(mocks.sendText).not.toHaveBeenCalled()
    expect(db.linhas('bot_mensagens').map(m => m.texto)).toEqual(['1'])
  })

  it('3 respostas que não batem com o menu: passa para humano e avisa o dono', async () => {
    await chamar(payload('menu'))
    await chamar(payload('talvez'))
    expect(enviados().at(-1)).toEqual([CLIENTE, 'Não entendi.\n\n1. Planos\n2. Atendente'])
    await chamar(payload('hein'))
    await chamar(payload('sei lá'))
    expect(conversaDe()?.status).toBe('humano')
    const aviso = enviados().find(([n]) => n === '5521977770000')
    expect(aviso?.[1]).toContain('Contato: Maria Souza 🌸 · +5521999990001')
  })

  it('etapa de humano: pausa, avisa o dono e o robô fica em silêncio depois', async () => {
    await chamar(payload('menu'))
    await chamar(payload('2'))
    expect(conversaDe()?.status).toBe('humano')
    expect(enviados().map(([n]) => n)).toContain('5521977770000')
    mocks.sendText.mockClear()
    const r = await chamar(payload('oi?'))
    expect(r.body.resultado).toBe('ignorada')
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('o dono digitou no celular para o contato: o robô pausa para ele', async () => {
    await chamar(payload('menu'))
    const r = await chamar(payload('Oi Maria, sou eu', { fromMe: true, sender_pn: '' }))
    expect(r.body.resultado).toBe('dono_respondeu')
    expect(conversaDe()?.status).toBe('humano')
  })

  it('SAIR: confirma, marca como descadastrado e não responde mais', async () => {
    await chamar(payload('menu'))
    await chamar(payload('SAIR'))
    expect(conversaDe()?.status).toBe('descadastrado')
    expect(enviados().at(-1)?.[1]).toMatch(/não vai mais receber/)
    mocks.sendText.mockClear()
    await chamar(payload('1'))
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('resposta a disparo ligado ao fluxo inicia; disparo antigo (antes da última conversa) não', async () => {
    db.linhas('campanhas_wa').push({ id: 'camp1', conta_id: CONTA, fluxo_id: 'f1' })
    db.linhas('campanha_destinatarios').push({ id: 'd1', conta_id: CONTA, campanha_id: 'camp1', celular: CLIENTE, status: 'enviado', enviado_em: '2026-10-26T12:00:00Z' })
    expect((await chamar(payload('oi, tudo bem?'))).body.resultado).toBe('iniciar')

    // Já passou pelo fluxo depois do disparo: um "obrigado" não recomeça.
    cenario({ conversas: [{ id: 'c1', conta_id: CONTA, celular: CLIENTE, nome: 'Maria', status: 'encerrada', fluxo_id: 'f1', etapa_id: null, variaveis: {}, nao_entendi: 0, versao: 1, ocupado_ate: null, atualizado_em: '2026-10-26T13:00:00Z', iniciado_em: '2026-10-26T12:30:00Z' }] })
    db.linhas('campanhas_wa').push({ id: 'camp1', conta_id: CONTA, fluxo_id: 'f1' })
    db.linhas('campanha_destinatarios').push({ id: 'd1', conta_id: CONTA, campanha_id: 'camp1', celular: CLIENTE, status: 'enviado', enviado_em: '2026-10-26T12:00:00Z' })
    expect((await chamar(payload('obrigado'))).body.resultado).toBe('ignorada')
  })

  it('fluxo com exclusão: busca as etiquetas e não entra quem tem a etiqueta', async () => {
    cenario({ fluxo: { excluir_etiquetas: ['9'] } })
    mocks.labelsDoChat.mockResolvedValue(['5521:9'])
    expect((await chamar(payload('menu'))).body.resultado).toBe('ignorada')
    expect(mocks.labelsDoChat).toHaveBeenCalledWith(TOKEN, CLIENTE)
  })

  it('erro ao ler as etiquetas: fluxo com exclusão não começa', async () => {
    cenario({ fluxo: { excluir_etiquetas: ['9'] } })
    mocks.labelsDoChat.mockRejectedValue(new Error('uazapi fora'))
    expect((await chamar(payload('menu'))).body.resultado).toBe('ignorada')
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('boas-vindas: a primeira mensagem recebe, as seguintes (depois do fim) não', async () => {
    cenario({ fluxo: { gatilho_palavras: [], boas_vindas: true, boas_vindas_clientes: true } })
    expect((await chamar(payload('Bom dia'))).body.resultado).toBe('iniciar')
    await chamar(payload('1'))
    await chamar(payload('Niterói')) // fim da conversa
    expect(conversaDe()).toMatchObject({ status: 'encerrada', fluxos_recebidos: ['f1'] })
    mocks.sendText.mockClear()
    expect((await chamar(payload('Bom dia de novo'))).body.resultado).toBe('ignorada')
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('boas-vindas "só quem não é cliente": quem está em Clientes não recebe; outra conta não conta', async () => {
    cenario({ fluxo: { gatilho_palavras: [], boas_vindas: true, boas_vindas_clientes: false } })
    db.linhas('clientes').push({ id: 'cl1', conta_id: CONTA, celular: '552199990001', deleted_at: null })
    expect((await chamar(payload('oi'))).body.resultado).toBe('ignorada')

    cenario({ fluxo: { gatilho_palavras: [], boas_vindas: true, boas_vindas_clientes: false } })
    db.linhas('clientes').push({ id: 'cl2', conta_id: '22222222-2222-4222-8222-222222222222', celular: CLIENTE, deleted_at: null })
    expect((await chamar(payload('oi'))).body.resultado).toBe('iniciar')
  })

  it('fluxo de OUTRA conta nunca responde aqui', async () => {
    db.linhas('bot_fluxos')[0].conta_id = '22222222-2222-4222-8222-222222222222'
    expect((await chamar(payload('menu'))).body.resultado).toBe('sem_fluxo')
    expect(mocks.sendText).not.toHaveBeenCalled()
  })
})
