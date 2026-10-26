// Regras puras do chatbot (lib/chatbot/fluxo.ts): gatilhos, menus, variáveis, "não entendi",
// humano, SAIR e o caminho entre etapas. Sem banco e sem rede.
import { describe, expect, it } from 'vitest'
import {
  aplicarVariaveis, decidir, ehUmaDas, escolherOpcao, MAX_NAO_ENTENDI, normalizar, passosDaEtapa, percorrer, planejar,
  precisaDeEtiquetas, precisaSaberSeECliente, QUALQUER_MENSAGEM, schemaEtapas, temEtiqueta,
  type EstadoConversa, type Etapa, type FluxoAtivo,
} from '@/lib/chatbot/fluxo'

const AGORA = new Date('2026-10-26T15:00:00Z')
const texto = (t: string) => [{ tipo: 'texto' as const, texto: t, variacoes: [], digitacao_seg: 5 }]

const etapas: Etapa[] = [
  { id: 'boas', nome: 'Boas-vindas', passos: texto('Oi {{nome}}!'), resposta: { tipo: 'menu', mostrar_opcoes: true, opcoes: [
    { rotulo: 'Ver planos', proxima: 'planos' }, { rotulo: 'Falar com alguém', proxima: 'humano' }, { rotulo: 'Nada', proxima: null },
  ] } },
  { id: 'planos', nome: 'Planos', passos: texto('Temos 3 planos.'), resposta: { tipo: 'seguir', proxima: 'cidade' } },
  { id: 'cidade', nome: 'Cidade', passos: texto('De qual cidade você é?'), resposta: { tipo: 'texto', variavel: 'cidade', proxima: 'fim' } },
  { id: 'fim', nome: 'Fim', passos: texto('Obrigado, {{cidade}}!'), resposta: { tipo: 'fim' } },
  { id: 'humano', nome: 'Humano', passos: texto('Já chamo alguém.'), resposta: { tipo: 'humano' } },
]

const fluxo = (extra: Partial<FluxoAtivo> = {}): FluxoAtivo => ({
  id: 'f1', nome: 'Vendas', etapas, gatilho_palavras: ['menu', 'quero'], gatilho_etiquetas: [], excluir_etiquetas: [],
  palavras_humano: ['atendente'], msg_nao_entendi: 'Não entendi.', msg_humano: 'Chamando.', aviso_numero: null,
  boas_vindas: false, boas_vindas_clientes: false, ...extra,
})

const conversa = (extra: Partial<EstadoConversa> = {}): EstadoConversa => ({
  status: 'ativa', fluxo_id: 'f1', etapa_id: 'boas', variaveis: {}, nao_entendi: 0,
  atualizado_em: '2026-10-26T14:50:00Z', ...extra,
})

const entrada = (t: string, extra: Partial<Parameters<typeof decidir>[0]> = {}) => ({
  texto: t, agora: AGORA, conversa: null, fluxos: [fluxo()], fluxoDoDisparo: null, etiquetas: [] as string[] | null, ...extra,
})

describe('texto', () => {
  it('normaliza caixa, acento, espaços e pontuação no fim', () => {
    expect(normalizar('  Opção  Um!! ')).toBe('opcao um')
  })

  it('palavra-chave vale só como mensagem inteira', () => {
    expect(ehUmaDas('MENU.', ['menu'])).toBe(true)
    expect(ehUmaDas('quero ver o menu', ['menu'])).toBe(false)
    expect(ehUmaDas('', ['menu'])).toBe(false)
  })

  it('escolhe a opção pelo número (com pontuação ou "opção") ou pelo texto', () => {
    const op = [{ rotulo: 'Ver planos' }, { rotulo: 'Falar com alguém' }]
    expect(escolherOpcao('2', op)).toBe(1)
    expect(escolherOpcao('1)', op)).toBe(0)
    expect(escolherOpcao('opção 2', op)).toBe(1)
    expect(escolherOpcao('ver PLANOS', op)).toBe(0)
    expect(escolherOpcao('3', op)).toBe(-1)
    expect(escolherOpcao('0', op)).toBe(-1)
    expect(escolherOpcao('talvez', op)).toBe(-1)
  })

  it('troca as variáveis e some com as que não existem', () => {
    expect(aplicarVariaveis('Oi {{nome}}, de {{ cidade }}? {{x}}', { nome: 'Ana', cidade: 'Niterói' })).toBe('Oi Ana, de Niterói? ')
  })

  it('etiqueta da uazapi ("<número>:<id>") bate com o id guardado', () => {
    expect(temEtiqueta(['5521999990000:7', '5521999990000:12'], ['12'])).toBe(true)
    expect(temEtiqueta(['5521999990000:17'], ['7'])).toBe(false)
  })
})

describe('gatilhos (sem conversa)', () => {
  it('palavra-chave inicia o fluxo', () => {
    expect(decidir(entrada('Quero'))).toMatchObject({ tipo: 'iniciar', gatilho: 'palavra' })
  })

  it('mensagem qualquer sem gatilho é ignorada (cliente de cobrança não cai no robô)', () => {
    expect(decidir(entrada('Já paguei, segue o comprovante'))).toMatchObject({ tipo: 'ignorar' })
  })

  it('resposta a disparo ligado ao fluxo inicia', () => {
    expect(decidir(entrada('oi', { fluxoDoDisparo: 'f1' }))).toMatchObject({ tipo: 'iniciar', gatilho: 'disparo' })
  })

  it('etiqueta inicia; sem a etiqueta, não', () => {
    const fluxos = [fluxo({ gatilho_palavras: [], gatilho_etiquetas: ['7'] })]
    expect(decidir(entrada('oi', { fluxos, etiquetas: ['55:7'] }))).toMatchObject({ tipo: 'iniciar', gatilho: 'etiqueta' })
    expect(decidir(entrada('oi', { fluxos, etiquetas: ['55:8'] }))).toMatchObject({ tipo: 'ignorar' })
  })

  it('etiqueta não recomeça o fluxo logo depois que ele terminou (só depois de 24h)', () => {
    const fluxos = [fluxo({ gatilho_palavras: [], gatilho_etiquetas: ['7'] })]
    const recem = conversa({ status: 'encerrada', etapa_id: null, atualizado_em: '2026-10-26T14:00:00Z' })
    expect(decidir(entrada('obrigado', { fluxos, etiquetas: ['55:7'], conversa: recem }))).toMatchObject({ tipo: 'ignorar' })
    const antiga = conversa({ status: 'encerrada', etapa_id: null, atualizado_em: '2026-10-25T14:00:00Z' })
    expect(decidir(entrada('oi', { fluxos, etiquetas: ['55:7'], conversa: antiga }))).toMatchObject({ tipo: 'iniciar', gatilho: 'etiqueta' })
  })

  it('etiqueta de exclusão barra o fluxo até por palavra-chave e por disparo', () => {
    const fluxos = [fluxo({ excluir_etiquetas: ['9'] })]
    expect(decidir(entrada('menu', { fluxos, etiquetas: ['55:9'] }))).toMatchObject({ tipo: 'ignorar' })
    expect(decidir(entrada('oi', { fluxos, etiquetas: ['55:9'], fluxoDoDisparo: 'f1' }))).toMatchObject({ tipo: 'ignorar' })
    expect(decidir(entrada('menu', { fluxos, etiquetas: ['55:1'] }))).toMatchObject({ tipo: 'iniciar' })
  })

  it('sem conseguir ler as etiquetas, fluxo com exclusão NÃO começa (na dúvida, fica de fora)', () => {
    const fluxos = [fluxo({ excluir_etiquetas: ['9'] }), fluxo({ id: 'f2', gatilho_palavras: ['menu'] })]
    expect(decidir(entrada('menu', { fluxos, etiquetas: null }))).toMatchObject({ tipo: 'iniciar', fluxo: { id: 'f2' } })
  })

  it('palavra-chave tem prioridade sobre disparo e etiqueta', () => {
    const fluxos = [fluxo({ id: 'disp', gatilho_palavras: [], gatilho_etiquetas: ['7'] }), fluxo({ id: 'pal' })]
    expect(decidir(entrada('menu', { fluxos, fluxoDoDisparo: 'disp', etiquetas: ['55:7'] }))).toMatchObject({ fluxo: { id: 'pal' } })
  })

  it('só busca etiqueta quando algum fluxo usa e não há conversa em andamento', () => {
    const base = { texto: 'oi', agora: AGORA, conversa: null, fluxos: [fluxo()], fluxoDoDisparo: null }
    expect(precisaDeEtiquetas(base)).toBe(false)
    expect(precisaDeEtiquetas({ ...base, fluxos: [fluxo({ excluir_etiquetas: ['1'] })] })).toBe(true)
    expect(precisaDeEtiquetas({ ...base, fluxos: [fluxo({ excluir_etiquetas: ['1'] })], conversa: conversa() })).toBe(false)
  })
})

describe('etiqueta marcada é condição: só responde quem tem a etiqueta', () => {
  // Caso real (2026-10-26): "Qualquer mensagem" + etiqueta AGUARDANDO_RESPOSTA respondia todo mundo.
  const soComEtiqueta = (extra: Partial<FluxoAtivo> = {}) => [fluxo({ gatilho_palavras: [QUALQUER_MENSAGEM], gatilho_etiquetas: ['7'], ...extra })]

  it('"qualquer mensagem" + etiqueta: sem etiqueta ou com outra etiqueta, NÃO responde', () => {
    expect(decidir(entrada('oi', { fluxos: soComEtiqueta(), etiquetas: [] }))).toMatchObject({ tipo: 'ignorar' })
    expect(decidir(entrada('oi', { fluxos: soComEtiqueta(), etiquetas: ['5521:3'] }))).toMatchObject({ tipo: 'ignorar' })
  })

  it('"qualquer mensagem" + etiqueta: com a etiqueta, responde', () => {
    expect(decidir(entrada('oi', { fluxos: soComEtiqueta(), etiquetas: ['5521:3', '5521:7'] }))).toMatchObject({ tipo: 'iniciar' })
  })

  it('vale também para palavra-chave, boas-vindas e resposta a disparo', () => {
    const fluxos = [fluxo({ gatilho_etiquetas: ['7'], boas_vindas: true, boas_vindas_clientes: true })]
    expect(decidir(entrada('menu', { fluxos, etiquetas: [] }))).toMatchObject({ tipo: 'ignorar' })
    expect(decidir(entrada('bom dia', { fluxos, etiquetas: [] }))).toMatchObject({ tipo: 'ignorar' })
    expect(decidir(entrada('oi', { fluxos, etiquetas: [], fluxoDoDisparo: 'f1' }))).toMatchObject({ tipo: 'ignorar' })
    expect(decidir(entrada('menu', { fluxos, etiquetas: ['5521:7'] }))).toMatchObject({ tipo: 'iniciar', gatilho: 'palavra' })
  })

  it('sem conseguir ler as etiquetas, não responde', () => {
    expect(decidir(entrada('oi', { fluxos: soComEtiqueta(), etiquetas: null }))).toMatchObject({ tipo: 'ignorar' })
  })

  it('automação só com etiqueta (sem outro jeito de começar) continua começando com qualquer mensagem de quem tem a etiqueta', () => {
    const fluxos = [fluxo({ gatilho_palavras: [], gatilho_etiquetas: ['7'] })]
    expect(decidir(entrada('oi', { fluxos, etiquetas: ['5521:7'] }))).toMatchObject({ tipo: 'iniciar', gatilho: 'etiqueta' })
    expect(decidir(entrada('oi', { fluxos, etiquetas: [] }))).toMatchObject({ tipo: 'ignorar' })
  })
})

describe('"qualquer mensagem" começa a automação', () => {
  const qualquer = [fluxo({ gatilho_palavras: [QUALQUER_MENSAGEM] })]

  it('qualquer coisa que a pessoa mandar começa, sem conversa antes', () => {
    expect(decidir(entrada('Boa tarde, tudo bem?', { fluxos: qualquer }))).toMatchObject({ tipo: 'iniciar', gatilho: 'qualquer' })
  })

  it('não atropela a conversa em andamento: a resposta vale para o menu', () => {
    expect(decidir(entrada('1', { fluxos: qualquer, conversa: conversa() }))).toMatchObject({ tipo: 'avancar', etapaId: 'planos' })
  })

  it('depois que a conversa termina, espera 24h para começar de novo', () => {
    const recem = conversa({ status: 'encerrada', etapa_id: null, atualizado_em: '2026-10-26T14:00:00Z' })
    expect(decidir(entrada('obrigado', { fluxos: qualquer, conversa: recem }))).toMatchObject({ tipo: 'ignorar' })
    const antiga = conversa({ status: 'encerrada', etapa_id: null, atualizado_em: '2026-10-25T14:00:00Z' })
    expect(decidir(entrada('oi', { fluxos: qualquer, conversa: antiga }))).toMatchObject({ tipo: 'iniciar', gatilho: 'qualquer' })
  })

  it('mandar "*" não vira palavra-chave que recomeça no meio da conversa', () => {
    expect(decidir(entrada('*', { fluxos: qualquer, conversa: conversa({ etapa_id: 'cidade' }) }))).toMatchObject({ tipo: 'avancar' })
  })

  it('palavra-chave de outra automação ganha de "qualquer mensagem"', () => {
    expect(decidir(entrada('menu', { fluxos: [...qualquer.map(f => ({ ...f, id: 'q' })), fluxo({ id: 'p' })] }))).toMatchObject({ fluxo: { id: 'p' }, gatilho: 'palavra' })
  })
})

describe('boas-vindas (primeira mensagem, uma vez por pessoa)', () => {
  const bv = (clientes: boolean) => [fluxo({ gatilho_palavras: [], boas_vindas: true, boas_vindas_clientes: clientes })]

  it('primeira mensagem de quem não é cliente: recebe', () => {
    expect(decidir(entrada('Bom dia', { fluxos: bv(false), ehCliente: false }))).toMatchObject({ tipo: 'iniciar', gatilho: 'boas_vindas' })
  })

  it('quem já recebeu esta automação não recebe de novo', () => {
    const ja = conversa({ status: 'encerrada', etapa_id: null, fluxos_recebidos: ['f1'], atualizado_em: '2026-10-20T10:00:00Z' })
    expect(decidir(entrada('oi de novo', { fluxos: bv(true), conversa: ja }))).toMatchObject({ tipo: 'ignorar' })
  })

  it('"só quem não é cliente": cliente não recebe; sem conseguir conferir, também não', () => {
    expect(decidir(entrada('oi', { fluxos: bv(false), ehCliente: true }))).toMatchObject({ tipo: 'ignorar' })
    expect(decidir(entrada('oi', { fluxos: bv(false), ehCliente: null }))).toMatchObject({ tipo: 'ignorar' })
  })

  it('"todos, inclusive quem já é cliente": cliente recebe uma vez', () => {
    expect(decidir(entrada('paguei', { fluxos: bv(true), ehCliente: true }))).toMatchObject({ tipo: 'iniciar', gatilho: 'boas_vindas' })
  })

  it('não interrompe uma conversa em andamento nem responde quem está com você', () => {
    const outra = fluxo({ id: 'f2', gatilho_palavras: [] })
    const andamento = conversa({ fluxo_id: 'f2', etapa_id: 'cidade' })
    expect(decidir(entrada('Niterói', { fluxos: [...bv(true), outra], conversa: andamento }))).toMatchObject({ tipo: 'avancar', fluxo: { id: 'f2' } })
    expect(decidir(entrada('oi', { fluxos: bv(true), conversa: conversa({ status: 'humano' }) }))).toMatchObject({ tipo: 'ignorar' })
  })

  it('palavra-chave continua funcionando para quem já recebeu as boas-vindas', () => {
    const ja = conversa({ status: 'encerrada', etapa_id: null, fluxos_recebidos: ['f1'] })
    expect(decidir(entrada('menu', { fluxos: [fluxo({ boas_vindas: true, boas_vindas_clientes: true })], conversa: ja }))).toMatchObject({ tipo: 'iniciar', gatilho: 'palavra' })
  })

  it('só consulta Clientes quando a boas-vindas exclui clientes e a pessoa ainda não recebeu', () => {
    const base = { texto: 'oi', agora: AGORA, conversa: null, fluxoDoDisparo: null }
    expect(precisaSaberSeECliente({ ...base, fluxos: bv(false) })).toBe(true)
    expect(precisaSaberSeECliente({ ...base, fluxos: bv(true) })).toBe(false)
    expect(precisaSaberSeECliente({ ...base, fluxos: bv(false), conversa: conversa({ status: 'encerrada', fluxos_recebidos: ['f1'] }) })).toBe(false)
  })

  it('começar marca a automação como recebida pelo contato', () => {
    const d = decidir(entrada('oi', { fluxos: bv(true) }))
    if (d.tipo !== 'iniciar') throw new Error('devia iniciar')
    expect(planejar(d, { etapa_id: null, variaveis: {} }).final.fluxo_recebido).toBe('f1')
  })
})

describe('conversa em andamento', () => {
  it('menu: a opção leva para a etapa dela', () => {
    expect(decidir(entrada('1', { conversa: conversa() }))).toMatchObject({ tipo: 'avancar', etapaId: 'planos' })
  })

  it('menu: opção sem destino encerra (etapa null)', () => {
    expect(decidir(entrada('3', { conversa: conversa() }))).toMatchObject({ tipo: 'avancar', etapaId: null })
  })

  it('texto: guarda a resposta na variável e segue', () => {
    const d = decidir(entrada('  Niterói ', { conversa: conversa({ etapa_id: 'cidade', variaveis: { a: 'b' } }) }))
    expect(d).toEqual(expect.objectContaining({ tipo: 'avancar', etapaId: 'fim', variaveis: { a: 'b', cidade: 'Niterói' } }))
  })

  it('não entendeu o menu: avisa; na 3ª vez passa para humano', () => {
    expect(decidir(entrada('talvez', { conversa: conversa() }))).toMatchObject({ tipo: 'nao_entendi', tentativas: 1 })
    expect(decidir(entrada('talvez', { conversa: conversa({ nao_entendi: MAX_NAO_ENTENDI - 1 }) }))).toMatchObject({ tipo: 'humano' })
  })

  it('palavra de atendimento passa para humano em qualquer etapa', () => {
    expect(decidir(entrada('Atendente', { conversa: conversa({ etapa_id: 'cidade' }) }))).toMatchObject({ tipo: 'humano' })
  })

  it('palavra-chave no meio da conversa recomeça o fluxo', () => {
    expect(decidir(entrada('menu', { conversa: conversa({ etapa_id: 'cidade' }) }))).toMatchObject({ tipo: 'iniciar' })
  })

  it('conversa parada há mais de 24h não responde menu: só gatilho', () => {
    const velha = conversa({ atualizado_em: '2026-10-25T14:00:00Z' })
    expect(decidir(entrada('1', { conversa: velha }))).toMatchObject({ tipo: 'ignorar' })
  })

  it('com o robô pausado (humano) não responde nada, nem palavra-chave', () => {
    expect(decidir(entrada('menu', { conversa: conversa({ status: 'humano' }) }))).toMatchObject({ tipo: 'ignorar' })
  })

  it('fluxo desligado (fora da lista de ativos) não continua a conversa', () => {
    expect(decidir(entrada('1', { conversa: conversa(), fluxos: [] }))).toMatchObject({ tipo: 'ignorar' })
  })
})

describe('SAIR', () => {
  it('vale sempre, até com o robô pausado ou sem conversa', () => {
    expect(decidir(entrada('SAIR'))).toEqual({ tipo: 'sair' })
    expect(decidir(entrada('parar', { conversa: conversa({ status: 'humano' }) }))).toEqual({ tipo: 'sair' })
  })

  it('"vou sair mais tarde" não é SAIR', () => {
    expect(decidir(entrada('vou sair mais tarde', { conversa: conversa({ etapa_id: 'cidade' }) }))).toMatchObject({ tipo: 'avancar' })
  })

  it('quem saiu é ignorado, mas volta se mandar uma palavra-chave', () => {
    const saiu = conversa({ status: 'descadastrado', etapa_id: null })
    expect(decidir(entrada('oi', { conversa: saiu, fluxoDoDisparo: 'f1' }))).toMatchObject({ tipo: 'ignorar' })
    expect(decidir(entrada('menu', { conversa: saiu }))).toMatchObject({ tipo: 'iniciar' })
  })
})

describe('caminho entre etapas', () => {
  it('encadeia "seguir" e para na que espera resposta', () => {
    const p = percorrer(fluxo(), 'planos')
    expect(p.enviar.map(e => e.id)).toEqual(['planos', 'cidade'])
    expect(p.depois).toEqual({ tipo: 'aguardar', etapaId: 'cidade' })
  })

  it('etapa humano e fim terminam o caminho', () => {
    expect(percorrer(fluxo(), 'humano').depois).toEqual({ tipo: 'humano' })
    expect(percorrer(fluxo(), 'fim').depois).toEqual({ tipo: 'fim' })
    expect(percorrer(fluxo(), null)).toEqual({ enviar: [], depois: { tipo: 'fim' } })
  })

  it('laço de "seguir" não trava: cada etapa sai uma vez só', () => {
    const laco = fluxo({ etapas: [
      { id: 'a', nome: 'A', passos: texto('a'), resposta: { tipo: 'seguir', proxima: 'b' } },
      { id: 'b', nome: 'B', passos: texto('b'), resposta: { tipo: 'seguir', proxima: 'a' } },
    ] })
    expect(percorrer(laco, 'a').enviar.map(e => e.id)).toEqual(['a', 'b'])
  })

  it('menu com "listar opções" junta a lista na última mensagem de texto (e nas variações)', () => {
    const e: Etapa = { ...etapas[0], passos: [{ tipo: 'texto', texto: 'Oi', variacoes: ['Olá'], digitacao_seg: 5 }] }
    expect(passosDaEtapa(e)).toEqual([{ tipo: 'texto', texto: 'Oi\n\n1. Ver planos\n2. Falar com alguém\n3. Nada', variacoes: ['Olá\n\n1. Ver planos\n2. Falar com alguém\n3. Nada'], digitacao_seg: 5 }])
  })

  it('menu que termina em mídia manda a lista numa mensagem a mais; sem "listar", não mexe', () => {
    const midia = { tipo: 'imagem' as const, caminho: 'contas/x/a.jpg', nome_arquivo: 'a.jpg', legenda: null, digitacao_seg: 5 }
    const e: Etapa = { ...etapas[0], passos: [midia] }
    expect(passosDaEtapa(e)).toHaveLength(2)
    const sem: Etapa = { ...etapas[0], resposta: { ...etapas[0].resposta, mostrar_opcoes: false } as Etapa['resposta'] }
    expect(passosDaEtapa(sem)).toBe(sem.passos)
  })
})

describe('validação das etapas', () => {
  it('aceita o fluxo de exemplo', () => {
    expect(schemaEtapas.safeParse(etapas).success).toBe(true)
  })

  it('recusa destino que não existe, ids repetidos e variável com nome inválido', () => {
    const ruim = (e: unknown[]) => schemaEtapas.safeParse(e).success
    expect(ruim([{ ...etapas[1], resposta: { tipo: 'seguir', proxima: 'sumiu' } }])).toBe(false)
    expect(ruim([etapas[3], etapas[3]])).toBe(false)
    expect(ruim([{ ...etapas[2], resposta: { tipo: 'texto', variavel: 'Cidade Natal', proxima: null } }])).toBe(false)
  })
})
