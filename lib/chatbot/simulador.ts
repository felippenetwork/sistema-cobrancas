// Simulador da conversa na tela de criação (/chatbot): a pessoa "conversa" com a automação sem
// WhatsApp. Usa as MESMAS regras do robô de verdade (decidir + planejar, lib/chatbot/fluxo.ts) —
// só troca o envio pela uazapi por texto na tela. Puro, testado em tests/chatbot-simulador.test.ts.
import { TIPOS_MIDIA, textoDoPasso, type Passo } from '@/lib/disparo/passos'
import { montarTexto } from '@/lib/disparo/progressivo'
import { aplicarVariaveis, decidir, planejar, type EstadoConversa, type FluxoAtivo } from './fluxo'

export type MensagemSimulada = { de: 'robo' | 'pessoa' | 'aviso'; texto: string }
export type Simulacao = { mensagens: MensagemSimulada[]; conversa: EstadoConversa | null }

const AGORA = () => new Date()

function textoDe(p: Passo, nome: string, variaveis: Record<string, string>): string {
  const vars = { nome, ...variaveis }
  if (p.tipo === 'texto') return aplicarVariaveis(textoDoPasso(p, 0, nome), vars)
  const legenda = p.legenda ? `\n${aplicarVariaveis(montarTexto(p.legenda, [], 0, nome), vars)}` : ''
  return `[${TIPOS_MIDIA[p.tipo].rotulo}${p.nome_arquivo ? `: ${p.nome_arquivo}` : ''}]${legenda}`
}

function aplicarDecisao(fluxo: FluxoAtivo, conversa: EstadoConversa | null, decisao: ReturnType<typeof decidir>, nome: string): Simulacao {
  if (decisao.tipo === 'ignorar') {
    const motivo = conversa?.status === 'humano' ? 'O robô está pausado: agora é você quem responde esta pessoa.'
      : conversa?.status === 'descadastrado' ? 'Esta pessoa pediu para sair: o robô não responde mais.'
      : 'O robô não responde: a conversa terminou. Para recomeçar, mande uma das palavras que iniciam a automação.'
    return { mensagens: [{ de: 'aviso', texto: motivo }], conversa }
  }
  const plano = planejar(decisao, { etapa_id: conversa?.etapa_id ?? null, variaveis: conversa?.variaveis ?? {} })
  const mensagens: MensagemSimulada[] = plano.envios.flatMap(e => e.passos.map(p => ({ de: 'robo' as const, texto: textoDe(p, nome, plano.variaveis) })))
  if (plano.avisarDono) {
    mensagens.push({ de: 'aviso', texto: fluxo.aviso_numero ? `Você receberia um aviso no WhatsApp +${fluxo.aviso_numero}.` : 'O robô pausa para esta pessoa (sem aviso: nenhum número para avisar).' })
  }
  if (plano.final.status === 'descadastrado') mensagens.push({ de: 'aviso', texto: 'Esta pessoa não recebe mais o robô nem disparos.' })
  if (plano.final.status === 'encerrada') mensagens.push({ de: 'aviso', texto: 'Fim da conversa.' })

  const { iniciado_em: _, ...final } = plano.final
  const base: EstadoConversa = conversa ?? { status: 'encerrada', fluxo_id: null, etapa_id: null, variaveis: {}, nao_entendi: 0, atualizado_em: AGORA().toISOString() }
  return {
    mensagens,
    conversa: { ...base, ...final, variaveis: final.variaveis ?? base.variaveis, atualizado_em: AGORA().toISOString() },
  }
}

/** Começa como se a pessoa tivesse mandado a palavra que inicia a automação. */
export function iniciarSimulacao(fluxo: FluxoAtivo, nome: string): Simulacao {
  if (!fluxo.etapas.length) return { mensagens: [], conversa: null }
  return aplicarDecisao(fluxo, null, { tipo: 'iniciar', fluxo, gatilho: 'palavra' }, nome)
}

/** A pessoa responde `texto`. */
export function responderSimulacao(fluxo: FluxoAtivo, conversa: EstadoConversa | null, texto: string, nome: string): Simulacao {
  const decisao = decidir({ texto, agora: AGORA(), conversa, fluxos: [fluxo], fluxoDoDisparo: null, etiquetas: [] })
  const r = aplicarDecisao(fluxo, conversa, decisao, nome)
  return { ...r, mensagens: [{ de: 'pessoa', texto }, ...r.mensagens] }
}
