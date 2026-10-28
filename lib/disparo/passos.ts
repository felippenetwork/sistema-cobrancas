// Sequência de mensagens do disparo progressivo ("caixinhas"): cada passo é um texto ou uma
// mídia, com o próprio tempo de "digitando…"/"gravando…" antes dele. Guardado em
// campanhas_wa.passos (jsonb); validado aqui, no servidor, antes de gravar.
import { z } from 'zod'
import { montarTexto } from './progressivo'
import { schemaAcao } from './acoes'

export const BUCKET_MIDIA = 'disparo-midia'
export const TAMANHO_MAX_MIDIA = 16 * 1024 * 1024 // limite do WhatsApp para mídia
export const MAX_PASSOS = 10
/** Variações por mensagem de texto (o rodízio alterna entre elas a cada contato). */
export const MAX_VARIACOES = 20

export const TIPOS_MIDIA = {
  imagem:    { rotulo: 'Imagem',    mimes: ['image/jpeg', 'image/png', 'image/webp'], uazapi: 'image' },
  video:     { rotulo: 'Vídeo',     mimes: ['video/mp4', 'video/3gpp'],               uazapi: 'video' },
  audio:     { rotulo: 'Áudio',     mimes: ['audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/webm'], uazapi: 'ptt' },
  documento: { rotulo: 'Documento', mimes: ['application/pdf'],                       uazapi: 'document' },
} as const

export type TipoMidia = keyof typeof TIPOS_MIDIA

/** Segundos de "digitando…" sugeridos: 20 no primeiro (abertura da conversa), 8 nos demais. */
export const digitacaoPadrao = (indice: number) => (indice === 0 ? 20 : 8)

const digitacao = z.number().int().min(0).max(120)

const passoTexto = z.object({
  tipo: z.literal('texto'),
  texto: z.string().trim().min(1, 'Uma caixinha de texto está vazia.').max(4000),
  variacoes: z.array(z.string().trim().max(4000)).max(MAX_VARIACOES, `No máximo ${MAX_VARIACOES} variações por mensagem.`).default([]),
  digitacao_seg: digitacao,
})

const passoMidia = z.object({
  tipo: z.enum(['imagem', 'video', 'audio', 'documento']),
  caminho: z.string().min(1, 'Envie o arquivo da mídia antes de iniciar.').max(300),
  nome_arquivo: z.string().max(200).nullable().default(null),
  legenda: z.string().trim().max(1024).nullable().default(null),
  digitacao_seg: digitacao,
})

/**
 * Ação na conversa NO MEIO da sequência (pedido do Felippe, 2026-10-28: "organizar igual mídias e
 * texto") — ex.: vídeo → tirar etiqueta → texto → pôr etiqueta. Não tem "digitando…".
 */
const passoAcao = z.object({
  tipo: z.literal('acao'),
  acao: schemaAcao,
  digitacao_seg: z.literal(0).default(0),
})

/** Ações no meio da sequência, no máximo (além das MAX_PASSOS mensagens). */
export const MAX_ACOES_NA_SEQUENCIA = 15

export const schemaPassos = z.array(z.discriminatedUnion('tipo', [passoTexto, passoMidia, passoAcao]))
  .min(1, 'Adicione pelo menos uma mensagem.')
  .refine(ps => ps.some(p => p.tipo !== 'acao'), { message: 'Adicione pelo menos uma mensagem (texto ou arquivo), não só ações.' })
  .refine(ps => ps.filter(p => p.tipo !== 'acao').length <= MAX_PASSOS, { message: `No máximo ${MAX_PASSOS} mensagens por contato.` })
  .refine(ps => ps.filter(p => p.tipo === 'acao').length <= MAX_ACOES_NA_SEQUENCIA, { message: `No máximo ${MAX_ACOES_NA_SEQUENCIA} ações na sequência.` })

export type Passo = z.infer<typeof schemaPassos>[number]
export type PassoMidia = Extract<Passo, { caminho: string }>
export type PassoAcao = Extract<Passo, { tipo: 'acao' }>

/** A caixinha é uma mídia (imagem, vídeo, áudio, documento)? */
export const ehMidia = (p: { tipo: string }): p is PassoMidia => p.tipo in TIPOS_MIDIA

/** Pasta das mídias da conta no bucket — o servidor só aceita caminhos dentro dela. */
export const pastaDaConta = (contaId: string) => `contas/${contaId}/`

/** Texto de um passo para o contato de posição `indice` (rodízio de variações + {{nome}}). */
export function textoDoPasso(p: Extract<Passo, { tipo: 'texto' }>, indice: number, nome: string | null): string {
  return montarTexto(p.texto, p.variacoes, indice, nome)
}

/**
 * Sequência de um modelo (/wa-templates). Modelo antigo, só com `corpo`, vira um texto único
 * com os 20s de abertura. Passos gravados que não passam na validação → null (não dispara).
 */
export function passosDoModelo(modelo: { passos: unknown; corpo: string | null }): Passo[] | null {
  if (modelo.passos == null) {
    const corpo = modelo.corpo?.trim()
    return corpo ? [{ tipo: 'texto', texto: corpo, variacoes: [], digitacao_seg: digitacaoPadrao(0) }] : null
  }
  const r = schemaPassos.safeParse(modelo.passos)
  return r.success ? r.data : null
}

/** Texto curto que representa a sequência (vai em modelos_wa.corpo e no card do modelo). */
export function resumoDosPassos(passos: Passo[]): string {
  const texto = passos.find(p => p.tipo === 'texto')
  if (texto?.tipo === 'texto') return texto.texto
  return passos.filter(ehMidia).map(p => `[${TIPOS_MIDIA[p.tipo].rotulo}]`).join(' ') || '[Mensagem]'
}

/** Tempo aproximado (ms) de digitação + envio da sequência para um contato. */
export function duracaoSequenciaMs(passos: Passo[]): number {
  return passos.reduce((s, p) => s + (p.tipo === 'acao' ? 2_000 : p.digitacao_seg * 1000 + 5_000), 0)
}
