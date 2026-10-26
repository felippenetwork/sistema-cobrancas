// Ações depois do envio (/wa-templates e /disparos): lista ORDENADA do que fazer na conversa do
// contato logo depois que a mensagem sai. Cada ação é melhor esforço — se falhar, vira `aviso`
// no contato e a próxima continua; nunca desfaz o envio. Endpoints confirmados no contrato
// OpenAPI oficial da uazapi (docs.uazapi.com/openapi-bundled.json, 2026-10-26).
import { z } from 'zod'

export const MAX_ACOES = 15

const etiqueta = { id: z.string().min(1).max(100), nome: z.string().max(100) }

export const schemaAcao = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('etiqueta_por'), ...etiqueta }),
  z.object({ tipo: z.literal('etiqueta_tirar'), ...etiqueta }),
  z.object({ tipo: z.literal('etiquetas_tirar_todas') }),
  z.object({ tipo: z.literal('arquivar') }),
  z.object({ tipo: z.literal('desarquivar') }),
  z.object({ tipo: z.literal('fixar_conversa') }),
  z.object({ tipo: z.literal('desafixar_conversa') }),
  /** Fixa a ÚLTIMA mensagem enviada ao contato (a uazapi aceita 1, 7 ou 30 dias). */
  z.object({ tipo: z.literal('fixar_mensagem'), dias: z.union([z.literal(1), z.literal(7), z.literal(30)]) }),
  /** 8 h, 1 semana (168 h) ou para sempre (-1) — os valores que a uazapi aceita. */
  z.object({ tipo: z.literal('silenciar'), horas: z.union([z.literal(8), z.literal(168), z.literal(-1)]) }),
  z.object({ tipo: z.literal('tirar_silencio') }),
  z.object({ tipo: z.literal('marcar_lida') }),
  z.object({ tipo: z.literal('marcar_nao_lida') }),
  /** Salva o número na agenda do celular com o nome do contato. */
  z.object({ tipo: z.literal('salvar_contato') }),
  /** Nota interna da conversa (aceita {{nome}} e {{periododia}}). Substitui a nota que existir. */
  z.object({ tipo: z.literal('nota'), texto: z.string().trim().min(1, 'A nota está vazia.').max(500) }),
])

export const schemaAcoes = z.array(schemaAcao).max(MAX_ACOES, `No máximo ${MAX_ACOES} ações depois do envio.`)

export type Acao = z.infer<typeof schemaAcao>
export type TipoAcao = Acao['tipo']

/** Rótulo de cada tipo na tela (o menu "Adicionar ação"), na ordem em que aparecem. */
export const TIPOS_ACAO: { tipo: TipoAcao; rotulo: string }[] = [
  { tipo: 'etiqueta_por',          rotulo: 'Pôr etiqueta' },
  { tipo: 'etiqueta_tirar',        rotulo: 'Tirar etiqueta' },
  { tipo: 'etiquetas_tirar_todas', rotulo: 'Tirar todas as etiquetas' },
  { tipo: 'arquivar',              rotulo: 'Arquivar a conversa' },
  { tipo: 'desarquivar',           rotulo: 'Desarquivar a conversa' },
  { tipo: 'fixar_conversa',        rotulo: 'Fixar a conversa no topo' },
  { tipo: 'desafixar_conversa',    rotulo: 'Desafixar a conversa' },
  { tipo: 'fixar_mensagem',        rotulo: 'Fixar a mensagem enviada' },
  { tipo: 'silenciar',             rotulo: 'Silenciar a conversa' },
  { tipo: 'tirar_silencio',        rotulo: 'Tirar o silêncio' },
  { tipo: 'marcar_lida',           rotulo: 'Marcar como lida' },
  { tipo: 'marcar_nao_lida',       rotulo: 'Marcar como não lida' },
  { tipo: 'salvar_contato',        rotulo: 'Salvar o contato na agenda' },
  { tipo: 'nota',                  rotulo: 'Escrever uma nota na conversa' },
]

/** Frase curta da ação, para cards e avisos ("põe a etiqueta Lead", "arquiva"). */
export function descreverAcao(a: Acao): string {
  switch (a.tipo) {
    case 'etiqueta_por':          return `põe a etiqueta "${a.nome}"`
    case 'etiqueta_tirar':        return `tira a etiqueta "${a.nome}"`
    case 'etiquetas_tirar_todas': return 'tira todas as etiquetas'
    case 'arquivar':              return 'arquiva'
    case 'desarquivar':           return 'desarquiva'
    case 'fixar_conversa':        return 'fixa a conversa'
    case 'desafixar_conversa':    return 'desafixa a conversa'
    case 'fixar_mensagem':        return `fixa a mensagem por ${a.dias} dia${a.dias === 1 ? '' : 's'}`
    case 'silenciar':             return a.horas === -1 ? 'silencia para sempre' : a.horas === 8 ? 'silencia por 8 h' : 'silencia por 1 semana'
    case 'tirar_silencio':        return 'tira o silêncio'
    case 'marcar_lida':           return 'marca como lida'
    case 'marcar_nao_lida':       return 'marca como não lida'
    case 'salvar_contato':        return 'salva na agenda'
    case 'nota':                  return 'escreve uma nota'
  }
}

/** Ações gravadas (jsonb) → lista válida; o que não passar na validação fica de fora. */
export function lerAcoes(valor: unknown): Acao[] {
  if (!Array.isArray(valor)) return []
  return valor.flatMap(v => {
    const r = schemaAcao.safeParse(v)
    return r.success ? [r.data] : []
  })
}

/** Disparo antigo (antes da 0043) só tinha uma etiqueta para tirar e outra para pôr: tira, depois põe. */
export function acoesLegadas(c: { etiqueta_remover: string | null; etiqueta_adicionar: string | null }): Acao[] {
  return [
    ...(c.etiqueta_remover ? [{ tipo: 'etiqueta_tirar' as const, id: c.etiqueta_remover, nome: c.etiqueta_remover }] : []),
    ...(c.etiqueta_adicionar ? [{ tipo: 'etiqueta_por' as const, id: c.etiqueta_adicionar, nome: c.etiqueta_adicionar }] : []),
  ]
}
