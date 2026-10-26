// Regras puras do chatbot (/chatbot): formato das etapas de um fluxo e a decisão do que fazer
// com cada mensagem recebida. Sem banco e sem rede — testado em tests/chatbot-fluxo.test.ts.
// Quem aplica a decisão (banco + uazapi) é lib/chatbot/processar.ts.
//
// Um fluxo é uma lista de etapas. Cada etapa manda uma sequência de mensagens (as mesmas
// "caixinhas" dos modelos, lib/disparo/passos.ts) e diz o que acontece depois:
//   menu   → espera a pessoa escolher uma opção (1, 2, 3… ou o texto da opção) → outra etapa
//   texto  → espera qualquer resposta, guarda em {{variavel}} → outra etapa
//   seguir → vai direto para outra etapa, sem esperar
//   humano → pausa o robô para esse contato e avisa o dono
//   fim    → encerra a conversa
// A primeira etapa da lista é a de entrada.
import { z } from 'zod'
import { schemaPassos, type Passo } from '@/lib/disparo/passos'

export const MAX_ETAPAS = 30
export const MAX_OPCOES = 10
/** Conversa parada há mais que isso conta como terminada: a próxima mensagem só entra por gatilho. */
export const EXPIRA_CONVERSA_MS = 24 * 60 * 60_000
/** "Não entendi" seguidos antes de passar para humano. */
export const MAX_NAO_ENTENDI = 3
/** Quantas etapas "seguir" podem ser encadeadas numa mesma resposta (evita laço infinito). */
export const MAX_ENCADEADAS = 10

export const PALAVRAS_SAIR = ['sair', 'parar', 'pare', 'stop', 'descadastrar']
export const MSG_SAIR = 'Pronto, você não vai mais receber nossas mensagens. Se mudar de ideia, é só nos chamar.'

const idEtapa = z.string().min(1).max(40)
const proxima = idEtapa.nullable()

const schemaResposta = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('menu'),
    opcoes: z.array(z.object({
      rotulo: z.string().trim().min(1, 'Uma opção está sem texto.').max(60, 'Texto de opção muito longo (máximo 60).'),
      proxima,
    })).min(1, 'Coloque pelo menos uma opção.').max(MAX_OPCOES, `No máximo ${MAX_OPCOES} opções.`),
    /** Junta "1. Opção…" na última mensagem de texto da etapa (desligue se o texto já lista). */
    mostrar_opcoes: z.boolean().default(true),
  }),
  z.object({
    tipo: z.literal('texto'),
    variavel: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, 'O nome da resposta guardada: só letras minúsculas, números e _ (ex.: cidade).'),
    proxima,
  }),
  z.object({ tipo: z.literal('seguir'), proxima }),
  z.object({ tipo: z.literal('humano') }),
  z.object({ tipo: z.literal('fim') }),
])

export const schemaEtapa = z.object({
  id: idEtapa,
  nome: z.string().trim().min(1, 'Uma mensagem ficou sem nome.').max(60),
  passos: schemaPassos,
  resposta: schemaResposta,
})

export const schemaEtapas = z.array(schemaEtapa)
  .min(1, 'A automação precisa de pelo menos uma mensagem.')
  .max(MAX_ETAPAS, `No máximo ${MAX_ETAPAS} mensagens por automação.`)
  .superRefine((etapas, ctx) => {
    const ids = new Set(etapas.map(e => e.id))
    if (ids.size !== etapas.length) ctx.addIssue({ code: 'custom', message: 'Há duas mensagens com o mesmo identificador. Recarregue a página e tente de novo.' })
    for (const e of etapas) {
      const destinos = e.resposta.tipo === 'menu' ? e.resposta.opcoes.map(o => o.proxima)
        : 'proxima' in e.resposta ? [e.resposta.proxima] : []
      if (destinos.some(d => d !== null && !ids.has(d))) {
        ctx.addIssue({ code: 'custom', message: `A mensagem "${e.nome}" leva para uma resposta que não existe mais.` })
      }
    }
  })

export type Etapa = z.infer<typeof schemaEtapa>
export type RespostaEtapa = Etapa['resposta']

export type FluxoAtivo = {
  id: string
  nome: string
  etapas: Etapa[]
  gatilho_palavras: string[]
  gatilho_etiquetas: string[]
  excluir_etiquetas: string[]
  palavras_humano: string[]
  msg_nao_entendi: string
  msg_humano: string
  aviso_numero: string | null
}

export type EstadoConversa = {
  status: 'ativa' | 'humano' | 'encerrada' | 'descadastrado'
  fluxo_id: string | null
  etapa_id: string | null
  variaveis: Record<string, string>
  nao_entendi: number
  atualizado_em: string
}

// ── Texto ─────────────────────────────────────────────────────────────────────

/** Minúsculas, sem acento, sem espaço sobrando e sem pontuação no fim ("Menu!" → "menu"). */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\s+/g, ' ').trim().replace(/[\s.!?,;:)\-]+$/, '')
}

/** A mensagem inteira É uma das palavras (não basta conter: "vou sair mais tarde" não é SAIR). */
export function ehUmaDas(texto: string, palavras: string[]): boolean {
  const t = normalizar(texto)
  return !!t && palavras.some(p => normalizar(p) === t)
}

/**
 * Qual opção do menu a pessoa escolheu: o número ("2", "2.", "2)", "opção 2") ou o próprio texto
 * da opção. -1 quando não dá para saber.
 */
export function escolherOpcao(texto: string, opcoes: { rotulo: string }[]): number {
  const t = normalizar(texto)
  const numero = t.match(/^(?:opcao|op|numero|n)?\s*(\d{1,2})$/)
  if (numero) {
    const i = Number(numero[1]) - 1
    return i >= 0 && i < opcoes.length ? i : -1
  }
  return opcoes.findIndex(o => normalizar(o.rotulo) === t)
}

/** Troca {{variavel}} pelo que a pessoa respondeu; variável que não existe some. */
export function aplicarVariaveis(texto: string, variaveis: Record<string, string>): string {
  return texto.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi, (_, chave: string) => variaveis[chave.toLowerCase()] ?? '')
}

/** Texto do menu que vai depois da última mensagem da etapa: "1. Planos\n2. Falar com alguém". */
export function textoDoMenu(opcoes: { rotulo: string }[]): string {
  return opcoes.map((o, i) => `${i + 1}. ${o.rotulo}`).join('\n')
}

/**
 * Mensagens que a etapa manda. Num menu com `mostrar_opcoes`, a lista "1. …" entra no fim da
 * última mensagem de texto (e das variações dela); se a etapa termina em mídia, vai numa
 * mensagem de texto a mais, com 3 s de digitação.
 */
export function passosDaEtapa(etapa: Etapa): Passo[] {
  const r = etapa.resposta
  if (r.tipo !== 'menu' || !r.mostrar_opcoes) return etapa.passos
  const menu = textoDoMenu(r.opcoes)
  const ultimo = etapa.passos[etapa.passos.length - 1]
  if (ultimo.tipo === 'texto') {
    const junta = (t: string) => `${t}\n\n${menu}`
    return [...etapa.passos.slice(0, -1), { ...ultimo, texto: junta(ultimo.texto), variacoes: ultimo.variacoes.map(junta) }]
  }
  return [...etapa.passos, { tipo: 'texto', texto: menu, variacoes: [], digitacao_seg: 3 }]
}

// ── Etiquetas ─────────────────────────────────────────────────────────────────

/**
 * O contato tem alguma destas etiquetas? A uazapi devolve as do chat como "<número>:<labelid>"
 * (confirmado em /chat/find, 2026-10-26) e o sistema guarda só o labelid.
 */
export function temEtiqueta(doContato: string[], procuradas: string[]): boolean {
  if (!procuradas.length || !doContato.length) return false
  const ids = new Set(doContato.map(e => e.split(':').pop() as string))
  return procuradas.some(p => ids.has(p))
}

// ── Decisão ───────────────────────────────────────────────────────────────────

export type Entrada = {
  texto: string
  agora: Date
  conversa: EstadoConversa | null
  fluxos: FluxoAtivo[]
  /** Fluxo ligado a um disparo que este número recebeu há pouco (ou null). */
  fluxoDoDisparo: string | null
  /** Etiquetas do contato; null = não foram buscadas (ver precisaDeEtiquetas). */
  etiquetas: string[] | null
}

export type Decisao =
  | { tipo: 'ignorar'; motivo: string }
  | { tipo: 'sair' }
  | { tipo: 'humano'; fluxo: FluxoAtivo; motivo: string }
  | { tipo: 'nao_entendi'; fluxo: FluxoAtivo; tentativas: number }
  | { tipo: 'iniciar'; fluxo: FluxoAtivo; gatilho: 'palavra' | 'disparo' | 'etiqueta' }
  | { tipo: 'avancar'; fluxo: FluxoAtivo; etapaId: string | null; variaveis: Record<string, string> }

function conversaEmAndamento(e: Entrada): { fluxo: FluxoAtivo; etapa: Etapa } | null {
  const c = e.conversa
  if (!c || c.status !== 'ativa' || !c.fluxo_id || !c.etapa_id) return null
  if (e.agora.getTime() - new Date(c.atualizado_em).getTime() > EXPIRA_CONVERSA_MS) return null
  const fluxo = e.fluxos.find(f => f.id === c.fluxo_id)
  const etapa = fluxo?.etapas.find(x => x.id === c.etapa_id)
  return fluxo && etapa ? { fluxo, etapa } : null
}

/** Só busca as etiquetas na uazapi quando elas podem mudar a decisão (economiza uma chamada). */
export function precisaDeEtiquetas(e: Omit<Entrada, 'etiquetas'>): boolean {
  if (e.conversa?.status === 'humano') return false
  if (conversaEmAndamento({ ...e, etiquetas: null })) return false
  return e.fluxos.some(f => f.gatilho_etiquetas.length || f.excluir_etiquetas.length)
}

/**
 * O contato tem uma etiqueta que tira ele deste fluxo? Sem conseguir ler as etiquetas
 * (`null`), um fluxo com exclusão NÃO começa: na dúvida, quem devia ficar de fora fica de fora.
 */
function excluido(f: FluxoAtivo, etiquetas: string[] | null): boolean {
  if (!f.excluir_etiquetas.length) return false
  return etiquetas === null || temEtiqueta(etiquetas, f.excluir_etiquetas)
}

/**
 * Fluxo que esta mensagem dispara: palavra-chave > resposta a disparo > etiqueta, sem os
 * excluídos. A etiqueta continua no contato depois que o fluxo termina: sem uma pausa, cada
 * "obrigado" recomeçaria o fluxo — então ela só dispara de novo depois de EXPIRA_CONVERSA_MS
 * sem conversa. (A resposta a disparo já vem filtrada: só disparo recebido depois da última
 * conversa conta, ver processar.ts.)
 */
function gatilho(e: Entrada): { fluxo: FluxoAtivo; gatilho: 'palavra' | 'disparo' | 'etiqueta' } | null {
  const validos = e.fluxos.filter(f => f.etapas.length && !excluido(f, e.etiquetas))
  const porPalavra = validos.find(f => ehUmaDas(e.texto, f.gatilho_palavras))
  if (porPalavra) return { fluxo: porPalavra, gatilho: 'palavra' }
  const porDisparo = validos.find(f => f.id === e.fluxoDoDisparo)
  if (porDisparo) return { fluxo: porDisparo, gatilho: 'disparo' }
  const recente = e.conversa && e.agora.getTime() - new Date(e.conversa.atualizado_em).getTime() < EXPIRA_CONVERSA_MS
  const porEtiqueta = recente ? undefined : validos.find(f => temEtiqueta(e.etiquetas ?? [], f.gatilho_etiquetas))
  if (porEtiqueta) return { fluxo: porEtiqueta, gatilho: 'etiqueta' }
  return null
}

export function decidir(e: Entrada): Decisao {
  const status = e.conversa?.status

  // SAIR vale sempre, até com o robô pausado: é pedido de não receber mais nada.
  if (ehUmaDas(e.texto, PALAVRAS_SAIR) && status !== 'descadastrado') return { tipo: 'sair' }

  // Humano assumiu: o robô não fala nada até alguém devolver o contato para ele.
  if (status === 'humano') return { tipo: 'ignorar', motivo: 'robô pausado para este contato' }

  const andamento = conversaEmAndamento(e)

  if (andamento && ehUmaDas(e.texto, andamento.fluxo.palavras_humano)) {
    return { tipo: 'humano', fluxo: andamento.fluxo, motivo: 'pediu para falar com uma pessoa' }
  }

  // Palavra-chave de um fluxo recomeça a conversa nele (inclusive no meio de outro).
  const novo = gatilho(e)
  if (novo?.gatilho === 'palavra') return { tipo: 'iniciar', ...novo }

  if (status === 'descadastrado') return { tipo: 'ignorar', motivo: 'pediu para sair' }

  if (andamento) {
    const { fluxo, etapa } = andamento
    const variaveis = { ...(e.conversa?.variaveis ?? {}) }
    if (etapa.resposta.tipo === 'menu') {
      const i = escolherOpcao(e.texto, etapa.resposta.opcoes)
      if (i < 0) {
        const tentativas = (e.conversa?.nao_entendi ?? 0) + 1
        return tentativas >= MAX_NAO_ENTENDI
          ? { tipo: 'humano', fluxo, motivo: `não entendeu as opções ${MAX_NAO_ENTENDI} vezes` }
          : { tipo: 'nao_entendi', fluxo, tentativas }
      }
      return { tipo: 'avancar', fluxo, etapaId: etapa.resposta.opcoes[i].proxima, variaveis }
    }
    if (etapa.resposta.tipo === 'texto') {
      const resposta = e.texto.trim()
      if (!resposta) return { tipo: 'nao_entendi', fluxo, tentativas: (e.conversa?.nao_entendi ?? 0) + 1 }
      variaveis[etapa.resposta.variavel] = resposta.slice(0, 500)
      return { tipo: 'avancar', fluxo, etapaId: etapa.resposta.proxima, variaveis }
    }
    // Etapa que não espera resposta (não deveria ficar como etapa atual): trata como encerrada.
  }

  if (novo) return { tipo: 'iniciar', ...novo }
  return { tipo: 'ignorar', motivo: 'nenhum fluxo para esta mensagem' }
}

// ── Caminho dentro do fluxo ───────────────────────────────────────────────────

export type Percurso = {
  /** Etapas a enviar, na ordem. */
  enviar: Etapa[]
  /** Como a conversa fica depois de enviar. */
  depois: { tipo: 'aguardar'; etapaId: string } | { tipo: 'humano' } | { tipo: 'fim' }
}

/**
 * A partir da etapa `inicio`, quais etapas saem agora: encadeia as "seguir" e para na primeira
 * que espera resposta (menu/texto), que passa para humano ou que encerra. `null` = fim.
 */
export function percorrer(fluxo: FluxoAtivo, inicio: string | null): Percurso {
  const enviar: Etapa[] = []
  const vistas = new Set<string>()
  let atual = inicio
  while (atual && enviar.length < MAX_ENCADEADAS && !vistas.has(atual)) {
    const etapa = fluxo.etapas.find(x => x.id === atual)
    if (!etapa) break
    vistas.add(atual)
    enviar.push(etapa)
    const r = etapa.resposta
    if (r.tipo === 'menu' || r.tipo === 'texto') return { enviar, depois: { tipo: 'aguardar', etapaId: etapa.id } }
    if (r.tipo === 'humano') return { enviar, depois: { tipo: 'humano' } }
    if (r.tipo === 'fim') return { enviar, depois: { tipo: 'fim' } }
    atual = r.proxima
  }
  return { enviar, depois: { tipo: 'fim' } }
}

// ── Plano de uma resposta ─────────────────────────────────────────────────────
// O que o robô manda e como a conversa fica, para cada decisão. Usado pelo robô de verdade
// (processar.ts, que cuida de banco, trava e falha de envio) e pelo simulador da tela
// (simulador.ts) — os dois seguem exatamente as mesmas regras.

/** "Digitando…" das mensagens curtas do sistema (não entendi, atendente, sair). */
export const DIGITACAO_CURTA_SEG = 3

export const textoCurto = (texto: string): Passo[] => [{ tipo: 'texto', texto, variacoes: [], digitacao_seg: DIGITACAO_CURTA_SEG }]

export type EstadoFinal = {
  status: EstadoConversa['status']
  fluxo_id?: string | null
  etapa_id?: string | null
  variaveis?: Record<string, string>
  nao_entendi: number
  iniciado_em?: true
}

export type Plano = {
  /** Grupos de mensagens, na ordem (cada etapa é um grupo; etapaId null = mensagem do sistema). */
  envios: { etapaId: string | null; passos: Passo[] }[]
  /** Variáveis para montar os textos ({{nome}} entra à parte). */
  variaveis: Record<string, string>
  final: EstadoFinal
  /** Gravar o estado ANTES de enviar (pausa/saída valem na hora, mesmo se o envio falhar). */
  salvarAntes: boolean
  /** Histórico: antes de enviar / depois de enviar tudo. */
  evento: string | null
  eventoDepois: string | null
  /** Motivo para avisar o dono (null = sem aviso). */
  avisarDono: string | null
}

export function planejar(d: Exclude<Decisao, { tipo: 'ignorar' }>, c: { etapa_id: string | null; variaveis: Record<string, string> }): Plano {
  const sem = { evento: null, eventoDepois: null, avisarDono: null }
  if (d.tipo === 'sair') {
    return {
      ...sem, envios: [{ etapaId: null, passos: textoCurto(MSG_SAIR) }], variaveis: {}, salvarAntes: true,
      final: { status: 'descadastrado', fluxo_id: null, etapa_id: null, nao_entendi: 0 },
      evento: 'Pediu para sair: não recebe mais o robô nem disparos.',
    }
  }
  if (d.tipo === 'humano') {
    return {
      ...sem, envios: [{ etapaId: null, passos: textoCurto(d.fluxo.msg_humano) }], variaveis: c.variaveis, salvarAntes: true,
      final: { status: 'humano', nao_entendi: 0 }, evento: `Robô pausado: ${d.motivo}.`, avisarDono: d.motivo,
    }
  }
  if (d.tipo === 'nao_entendi') {
    const etapa = d.fluxo.etapas.find(e => e.id === c.etapa_id)
    const menu = etapa?.resposta.tipo === 'menu' ? `\n\n${textoDoMenu(etapa.resposta.opcoes)}` : ''
    return {
      ...sem, envios: [{ etapaId: null, passos: textoCurto(d.fluxo.msg_nao_entendi + menu) }], variaveis: c.variaveis, salvarAntes: true,
      final: { status: 'ativa', nao_entendi: d.tentativas },
    }
  }

  const inicio = d.tipo === 'iniciar' ? d.fluxo.etapas[0].id : d.etapaId
  const variaveis = d.tipo === 'iniciar' ? {} : d.variaveis
  const percurso = percorrer(d.fluxo, inicio)
  const comum = { fluxo_id: d.fluxo.id, variaveis, nao_entendi: 0, ...(d.tipo === 'iniciar' ? { iniciado_em: true as const } : {}) }
  const evento = d.tipo === 'iniciar'
    ? `Entrou na automação "${d.fluxo.nome}" (${d.gatilho === 'palavra' ? 'mandou a palavra' : d.gatilho === 'disparo' ? 'respondeu ao disparo' : 'tem a etiqueta'}).`
    : null
  const envios = percurso.enviar.map(e => ({ etapaId: e.id, passos: passosDaEtapa(e) }))
  const depois = percurso.depois
  if (depois.tipo === 'aguardar') {
    return { ...sem, envios, variaveis, salvarAntes: false, evento, final: { ...comum, status: 'ativa', etapa_id: depois.etapaId } }
  }
  if (depois.tipo === 'humano') {
    return {
      ...sem, envios, variaveis, salvarAntes: false, evento, final: { ...comum, status: 'humano', etapa_id: null },
      eventoDepois: 'Robô pausado: a conversa chegou na parte de chamar o atendente.', avisarDono: 'chegou na parte de chamar o atendente',
    }
  }
  return { ...sem, envios, variaveis, salvarAntes: false, evento, final: { ...comum, status: 'encerrada', etapa_id: null } }
}

/** Texto do aviso ao dono quando o contato pede (ou precisa de) uma pessoa. */
export function textoAvisoHumano(fluxo: { nome: string }, contato: { nome: string | null; celular: string }, variaveis: Record<string, string>, motivo: string): string {
  const linhas = [
    `Atendimento pedido na automação "${fluxo.nome}"`,
    `Contato: ${contato.nome ? `${contato.nome} · ` : ''}+${contato.celular}`,
    `Motivo: ${motivo}`,
  ]
  const respostas = Object.entries(variaveis)
  if (respostas.length) linhas.push('', 'Respostas:', ...respostas.map(([k, v]) => `${k}: ${v}`))
  linhas.push('', `Responda direto pelo WhatsApp: https://wa.me/${contato.celular}`)
  return linhas.join('\n')
}
