// Envio de uma sequência de mensagens ("caixinhas", lib/disparo/passos.ts) para um número, usado
// pelos disparos (lib/disparo/campanhas.ts) e pelo chatbot (lib/chatbot/processar.ts). Cada envio
// sabe quanto tempo fica "digitando…"/"gravando…" antes; quem chama decide o que fazer com falhas.
import { createAdminClient } from '@/lib/supabase/admin'
import { sendMedia, sendText } from '@/lib/uazapi'
import { aplicarVariaveis } from '@/lib/chatbot/fluxo'
import { BUCKET_MIDIA, TIPOS_MIDIA, textoDoPasso, type Passo } from './passos'
import { montarTexto } from './progressivo'

type Supabase = ReturnType<typeof createAdminClient>

/** Falha que não é recusa da mensagem (ex.: não conseguiu gerar o link da mídia). */
export class ErroTransitorio extends Error {}

/** enviar devolve o ID da mensagem enviada quando a uazapi informa (para fixar a mensagem depois). */
export type Envio = { digitacaoMs: number; presenca: 'composing' | 'recording'; enviar: () => Promise<string | null> }

export function enviosDosPassos(
  supabase: Supabase,
  token: string,
  celular: string,
  passos: Passo[],
  ctx: { indice: number; nome: string | null; variaveis?: Record<string, string> },
): Envio[] {
  const comVariaveis = (t: string) => (ctx.variaveis ? aplicarVariaveis(t, ctx.variaveis) : t)
  return passos.map((p): Envio => {
    if (p.tipo === 'texto') {
      const texto = comVariaveis(textoDoPasso(p, ctx.indice, ctx.nome))
      return { digitacaoMs: p.digitacao_seg * 1000, presenca: 'composing', enviar: () => sendText(token, celular, texto) }
    }
    return {
      digitacaoMs: p.digitacao_seg * 1000,
      presenca: p.tipo === 'audio' ? 'recording' : 'composing',
      enviar: async () => {
        const { data, error } = await supabase.storage.from(BUCKET_MIDIA).createSignedUrl(p.caminho, 60 * 60)
        if (error || !data?.signedUrl) throw new ErroTransitorio(`link da mídia: ${error?.message ?? 'sem URL'}`)
        const legenda = p.legenda ? comVariaveis(montarTexto(p.legenda, [], ctx.indice, ctx.nome)) : null
        return sendMedia(token, celular, TIPOS_MIDIA[p.tipo].uazapi, data.signedUrl, { legenda, nomeArquivo: p.nome_arquivo })
      },
    }
  })
}
