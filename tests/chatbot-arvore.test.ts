// Árvore de conversa da tela ↔ etapas do robô (lib/chatbot/arvore.ts) e o simulador
// (lib/chatbot/simulador.ts), que segue as mesmas regras do robô de verdade.
import { describe, expect, it } from 'vitest'
import { arvoreParaEtapas, continuacaoFim, etapasParaArvore, PREFIXO_ATENDENTE, type No } from '@/lib/chatbot/arvore'
import { iniciarSimulacao, responderSimulacao } from '@/lib/chatbot/simulador'
import { schemaEtapas, type Etapa, type FluxoAtivo } from '@/lib/chatbot/fluxo'
import type { Passo } from '@/lib/disparo/passos'

const t = (texto: string, seg = 5): Passo => ({ tipo: 'texto', texto, variacoes: [], digitacao_seg: seg })
const no = (id: string, texto: string, extra: Partial<No<Passo>> = {}): No<Passo> => ({
  id, passos: [t(texto)], depois: 'fim', opcoes: [], mostrarOpcoes: true, guardarComo: '', aposPergunta: continuacaoFim(), ...extra,
})

const ARVORE = no('raiz', 'Oi {{nome}}! Escolha:', {
  depois: 'menu',
  opcoes: [
    { rotulo: 'Ver planos', cont: { acao: 'responder', resposta: no('planos', 'Temos 3 planos.', {
      depois: 'pergunta', guardarComo: 'cidade',
      aposPergunta: { acao: 'responder', resposta: no('obrigado', 'Valeu, {{cidade}}!') },
    }) } },
    { rotulo: 'Falar com alguém', cont: { acao: 'atendente', resposta: null } },
    { rotulo: 'Voltar', cont: { acao: 'inicio', resposta: null } },
    { rotulo: 'Nada', cont: continuacaoFim() },
  ],
})

const op = { nome: (n: No<Passo>) => (n.passos[0]?.tipo === 'texto' ? n.passos[0].texto : 'Mídia'), passosAtendente: () => [t('Já chamo alguém.', 3)] }

describe('árvore → etapas', () => {
  const etapas = arvoreParaEtapas(ARVORE, op)

  it('a boas-vindas é a primeira etapa e o resultado passa na validação do robô', () => {
    expect(etapas[0].id).toBe('raiz')
    expect(schemaEtapas.safeParse(etapas).success).toBe(true)
  })

  it('cada opção aponta para a resposta certa: mensagem, atendente, começo ou fim', () => {
    const r = etapas[0].resposta
    expect(r.tipo).toBe('menu')
    if (r.tipo !== 'menu') return
    expect(r.opcoes.map(o => o.proxima)).toEqual(['planos', expect.stringMatching(new RegExp(`^${PREFIXO_ATENDENTE}`)), 'raiz', null])
    const atendente = etapas.find(e => e.id === r.opcoes[1].proxima)
    expect(atendente).toMatchObject({ resposta: { tipo: 'humano' }, passos: [t('Já chamo alguém.', 3)] })
  })

  it('pergunta vira resposta guardada com o nome escolhido', () => {
    expect(etapas.find(e => e.id === 'planos')?.resposta).toEqual({ tipo: 'texto', variavel: 'cidade', proxima: 'obrigado' })
  })

  it('ida e volta: etapas → árvore devolve a mesma árvore', () => {
    const { raiz, perdeu } = etapasParaArvore(etapas)
    expect(perdeu).toBe(false)
    expect(raiz).toEqual(ARVORE)
  })
})

describe('etapas do editor antigo → árvore', () => {
  it('"seguir" para outra etapa junta as mensagens numa só caixa', () => {
    const antigas: Etapa[] = [
      { id: 'a', nome: 'A', passos: [t('um')], resposta: { tipo: 'seguir', proxima: 'b' } },
      { id: 'b', nome: 'B', passos: [t('dois')], resposta: { tipo: 'fim' } },
    ]
    expect(etapasParaArvore(antigas).raiz).toMatchObject({ passos: [t('um'), t('dois')], depois: 'fim' })
  })

  it('etapa usada por dois caminhos: o segundo vira "terminar" e avisa', () => {
    const antigas: Etapa[] = [
      { id: 'a', nome: 'A', passos: [t('menu')], resposta: { tipo: 'menu', mostrar_opcoes: true, opcoes: [{ rotulo: 'x', proxima: 'b' }, { rotulo: 'y', proxima: 'b' }] } },
      { id: 'b', nome: 'B', passos: [t('b')], resposta: { tipo: 'fim' } },
    ]
    const { raiz, perdeu } = etapasParaArvore(antigas)
    expect(perdeu).toBe(true)
    expect(raiz?.opcoes.map(o => o.cont.acao)).toEqual(['responder', 'fim'])
  })
})

describe('simulador (mesmas regras do robô)', () => {
  const fluxo: FluxoAtivo = {
    id: 'f', nome: 'Teste', etapas: arvoreParaEtapas(ARVORE, op), gatilho_palavras: ['menu'], gatilho_etiquetas: [], excluir_etiquetas: [],
    palavras_humano: ['atendente'], msg_nao_entendi: 'Não entendi.', msg_humano: 'Chamando.', aviso_numero: '5521977770000',
    boas_vindas: false, boas_vindas_clientes: false,
  }

  it('começa com a boas-vindas, o nome e as opções listadas', () => {
    const s = iniciarSimulacao(fluxo, 'Maria')
    expect(s.mensagens).toEqual([{ de: 'robo', texto: 'Oi Maria! Escolha:\n\n1. Ver planos\n2. Falar com alguém\n3. Voltar\n4. Nada' }])
  })

  it('opção → pergunta → resposta guardada usada na mensagem seguinte → fim', () => {
    let s = iniciarSimulacao(fluxo, 'Maria')
    s = responderSimulacao(fluxo, s.conversa, '1', 'Maria')
    expect(s.mensagens.map(m => m.texto)).toEqual(['1', 'Temos 3 planos.'])
    s = responderSimulacao(fluxo, s.conversa, 'Niterói', 'Maria')
    expect(s.mensagens).toEqual([
      { de: 'pessoa', texto: 'Niterói' }, { de: 'robo', texto: 'Valeu, Niterói!' }, { de: 'aviso', texto: 'Fim da conversa.' },
    ])
  })

  it('resposta que não é opção: "não entendi" com as opções de novo', () => {
    const s = responderSimulacao(fluxo, iniciarSimulacao(fluxo, 'Ana').conversa, 'talvez', 'Ana')
    expect(s.mensagens[1].texto).toBe('Não entendi.\n\n1. Ver planos\n2. Falar com alguém\n3. Voltar\n4. Nada')
  })

  it('opção de atendente: mensagem de atendimento, aviso ao dono e o robô fica quieto depois', () => {
    let s = responderSimulacao(fluxo, iniciarSimulacao(fluxo, 'Ana').conversa, '2', 'Ana')
    expect(s.mensagens.map(m => m.de)).toEqual(['pessoa', 'robo', 'aviso'])
    expect(s.conversa?.status).toBe('humano')
    s = responderSimulacao(fluxo, s.conversa, 'oi?', 'Ana')
    expect(s.mensagens[1]).toMatchObject({ de: 'aviso', texto: expect.stringMatching(/pausado/) })
  })

  it('"Voltar" mostra a boas-vindas de novo', () => {
    const s = responderSimulacao(fluxo, iniciarSimulacao(fluxo, 'Ana').conversa, '3', 'Ana')
    expect(s.mensagens[1].texto).toMatch(/^Oi Ana! Escolha:/)
  })

  it('SAIR funciona no simulador também', () => {
    const s = responderSimulacao(fluxo, iniciarSimulacao(fluxo, 'Ana').conversa, 'sair', 'Ana')
    expect(s.conversa?.status).toBe('descadastrado')
  })
})
