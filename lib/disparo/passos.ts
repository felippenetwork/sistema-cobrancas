// Sequência de mensagens do disparo progressivo ("caixinhas"): cada passo é um texto ou uma
// mídia, com o próprio tempo de "digitando…"/"gravando…" antes dele. Guardado em
// campanhas_wa.passos (jsonb); validado aqui, no servidor, antes de gravar.
import { z } from 'zod'
import { montarTexto } from './progressivo'

export const BUCKET_MIDIA = 'disparo-midia'
export const TAMANHO_MAX_MIDIA = 16 * 1024 * 1024 // limite do WhatsApp para mídia
export const MAX_PASSOS = 10

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
  variacoes: z.array(z.string().trim().max(4000)).max(5).default([]),
  digitacao_seg: digitacao,
})

const passoMidia = z.object({
  tipo: z.enum(['imagem', 'video', 'audio', 'documento']),
  caminho: z.string().min(1, 'Envie o arquivo da mídia antes de iniciar.').max(300),
  nome_arquivo: z.string().max(200).nullable().default(null),
  legenda: z.string().trim().max(1024).nullable().default(null),
  digitacao_seg: digitacao,
})

export const schemaPassos = z.array(z.discriminatedUnion('tipo', [passoTexto, passoMidia]))
  .min(1, 'Adicione pelo menos uma mensagem.')
  .max(MAX_PASSOS, `No máximo ${MAX_PASSOS} mensagens por contato.`)

export type Passo = z.infer<typeof schemaPassos>[number]
export type PassoMidia = Extract<Passo, { caminho: string }>

/** Pasta das mídias da conta no bucket — o servidor só aceita caminhos dentro dela. */
export const pastaDaConta = (contaId: string) => `contas/${contaId}/`

/** Texto de um passo para o contato de posição `indice` (rodízio de variações + {{nome}}). */
export function textoDoPasso(p: Extract<Passo, { tipo: 'texto' }>, indice: number, nome: string | null): string {
  return montarTexto(p.texto, p.variacoes, indice, nome)
}

/** Tempo aproximado (ms) de digitação + envio da sequência para um contato. */
export function duracaoSequenciaMs(passos: Passo[]): number {
  return passos.reduce((s, p) => s + p.digitacao_seg * 1000 + 5_000, 0)
}
