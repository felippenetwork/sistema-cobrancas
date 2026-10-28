// A automação como a pessoa monta na tela (/chatbot, assistente): uma ÁRVORE de conversa — a
// mensagem de boas-vindas e, embaixo de cada opção, a resposta dela. O robô por dentro continua
// lendo a lista de etapas (lib/chatbot/fluxo.ts); aqui ficam as duas conversões. Puro, testado em
// tests/chatbot-arvore.test.ts.
import type { Etapa, RespostaEtapa } from './fluxo'
import type { Acao as AcaoDepois } from '@/lib/disparo/acoes'

/** O que acontece depois de uma opção (ou da resposta a uma pergunta). */
export type Acao = 'responder' | 'atendente' | 'inicio' | 'fim'
export type Continuacao<P> = { acao: Acao; resposta: No<P> | null }

/** O que acontece depois de uma mensagem. */
export type Depois = 'menu' | 'pergunta' | 'atendente' | 'inicio' | 'fim'

export type No<P> = {
  id: string
  passos: P[]
  depois: Depois
  opcoes: { rotulo: string; cont: Continuacao<P> }[]
  mostrarOpcoes: boolean
  guardarComo: string
  aposPergunta: Continuacao<P>
  /** O que fazer na conversa depois que esta mensagem sai (etiquetas, arquivar…). */
  acoes: AcaoDepois[]
}

/** Etapa criada só para "chamar o atendente" a partir de uma opção (não aparece na árvore). */
export const PREFIXO_ATENDENTE = 'at_'

export const continuacaoFim = <P>(): Continuacao<P> => ({ acao: 'fim', resposta: null })

type EtapaDe<P> = { id: string; nome: string; passos: P[]; resposta: RespostaEtapa; acoes: AcaoDepois[] }

/**
 * Árvore → etapas do robô. A primeira etapa é sempre a raiz (boas-vindas). "Chamar atendente"
 * numa opção vira uma etapa própria de atendimento, com a mensagem de atendimento.
 */
export function arvoreParaEtapas<P>(raiz: No<P>, op: { nome: (no: No<P>) => string; passosAtendente: () => P[] }): EtapaDe<P>[] {
  const etapas: EtapaDe<P>[] = []
  let atendentes = 0

  const destino = (c: Continuacao<P>, deId: string): string | null => {
    if (c.acao === 'fim') return null
    if (c.acao === 'inicio') return raiz.id
    if (c.acao === 'atendente') {
      const id = `${PREFIXO_ATENDENTE}${deId}_${atendentes++}`.slice(0, 40)
      etapas.push({ id, nome: 'Chamar atendente', passos: op.passosAtendente(), resposta: { tipo: 'humano' }, acoes: [] })
      return id
    }
    return c.resposta ? visitar(c.resposta) : null
  }

  const visitar = (no: No<P>): string => {
    const etapa: EtapaDe<P> = { id: no.id, nome: op.nome(no).slice(0, 60) || 'Mensagem', passos: no.passos, resposta: { tipo: 'fim' }, acoes: no.acoes }
    etapas.push(etapa) // antes dos filhos: a raiz fica em primeiro e a ordem segue a conversa
    etapa.resposta =
      no.depois === 'menu' ? { tipo: 'menu', mostrar_opcoes: no.mostrarOpcoes, opcoes: no.opcoes.map(o => ({ rotulo: o.rotulo, proxima: destino(o.cont, no.id) })) }
      : no.depois === 'pergunta' ? { tipo: 'texto', variavel: no.guardarComo, proxima: destino(no.aposPergunta, no.id) }
      : no.depois === 'atendente' ? { tipo: 'humano' }
      : no.depois === 'inicio' && no !== raiz ? { tipo: 'seguir', proxima: raiz.id }
      : { tipo: 'fim' }
    return no.id
  }

  visitar(raiz)
  return etapas
}

/**
 * Etapas do robô → árvore. Uma etapa usada por dois caminhos não cabe numa árvore: o segundo
 * caminho vira "terminar" e `perdeu` avisa (só acontece com automação montada no editor antigo).
 * "Seguir" para outra etapa junta as mensagens dela na mesma caixa.
 */
export function etapasParaArvore<P>(etapas: (Omit<Etapa, 'passos'> & { passos: P[] })[]): { raiz: No<P> | null; perdeu: boolean } {
  const raizEtapa = etapas[0]
  if (!raizEtapa) return { raiz: null, perdeu: false }
  const porId = new Map(etapas.map(e => [e.id, e]))
  const usadas = new Set<string>()
  let perdeu = false

  const cont = (proxima: string | null): Continuacao<P> => {
    if (proxima === null) return continuacaoFim()
    if (proxima === raizEtapa.id) return { acao: 'inicio', resposta: null }
    const alvo = porId.get(proxima)
    if (!alvo) return continuacaoFim()
    if (alvo.resposta.tipo === 'humano' && alvo.id.startsWith(PREFIXO_ATENDENTE)) return { acao: 'atendente', resposta: null }
    if (usadas.has(alvo.id)) { perdeu = true; return continuacaoFim() }
    return { acao: 'responder', resposta: no(alvo) }
  }

  const no = (inicial: (typeof etapas)[number]): No<P> => {
    usadas.add(inicial.id)
    let passos = [...inicial.passos]
    let acoes = [...(inicial.acoes ?? [])]
    let r = inicial.resposta
    // "Seguir" para uma etapa que ninguém mais usa: junta na mesma mensagem.
    while (r.tipo === 'seguir' && r.proxima && r.proxima !== raizEtapa.id) {
      const prox = porId.get(r.proxima)
      if (!prox || usadas.has(prox.id)) { if (prox) perdeu = true; r = { tipo: 'fim' }; break }
      usadas.add(prox.id)
      passos = [...passos, ...prox.passos]
      acoes = [...acoes, ...(prox.acoes ?? [])]
      r = prox.resposta
    }
    const base: No<P> = {
      id: inicial.id, passos, depois: 'fim', opcoes: [], mostrarOpcoes: true, guardarComo: '', aposPergunta: continuacaoFim(), acoes,
    }
    if (r.tipo === 'menu') return { ...base, depois: 'menu', mostrarOpcoes: r.mostrar_opcoes, opcoes: r.opcoes.map(o => ({ rotulo: o.rotulo, cont: cont(o.proxima) })) }
    if (r.tipo === 'texto') return { ...base, depois: 'pergunta', guardarComo: r.variavel, aposPergunta: cont(r.proxima) }
    if (r.tipo === 'humano') return { ...base, depois: 'atendente' }
    if (r.tipo === 'seguir' && r.proxima === raizEtapa.id) return { ...base, depois: 'inicio' }
    return base
  }

  return { raiz: no(raizEtapa), perdeu }
}

/** Troca o tipo das mensagens em toda a árvore (salvo ↔ editável na tela). */
export function mapearArvore<A, B>(no: No<A>, f: (passos: A[]) => B[]): No<B> {
  const c = (x: Continuacao<A>): Continuacao<B> => ({ acao: x.acao, resposta: x.resposta ? mapearArvore(x.resposta, f) : null })
  return { ...no, passos: f(no.passos), opcoes: no.opcoes.map(o => ({ rotulo: o.rotulo, cont: c(o.cont) })), aposPergunta: c(no.aposPergunta) }
}
