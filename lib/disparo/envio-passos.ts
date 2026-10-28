// Envio de uma sequência de mensagens ("caixinhas", lib/disparo/passos.ts) para um número, usado
// pelos disparos (lib/disparo/campanhas.ts) e pelo chatbot (lib/chatbot/processar.ts). Cada envio
// sabe quanto tempo fica "digitando…"/"gravando…" antes; quem chama decide o que fazer com falhas.
// Caixinha de AÇÃO (etiqueta, arquivar…) no meio da sequência roda como um envio sem digitação,
// marcado `melhorEsforco`: se falhar, quem chama registra o aviso e segue para a próxima.
import { createAdminClient } from '@/lib/supabase/admin'
import { sendMedia, sendText } from '@/lib/uazapi'
import { aplicarVariaveis } from '@/lib/chatbot/fluxo'
import { BUCKET_MIDIA, TIPOS_MIDIA, textoDoPasso, type Passo } from './passos'
import { montarTexto } from './progressivo'
import { executarAcoes } from './executar-acoes'

type Supabase = ReturnType<typeof createAdminClient>

/** Falha que não é recusa da mensagem (ex.: não conseguiu gerar o link da mídia). */
export class ErroTransitorio extends Error {}

/**
 * `enviar` recebe o id da última mensagem que já saiu (para "fixar a mensagem enviada") e devolve
 * o id da mensagem que ele mesmo mandou, quando a uazapi informa (ações devolvem null).
 */
export type Envio = {
  digitacaoMs: number
  presenca: 'composing' | 'recording'
  /** Ação na conversa: falha vira aviso e a sequência continua (nunca desfaz o que já saiu). */
  melhorEsforco?: boolean
  enviar: (ultimaMensagem: string | null) => Promise<string | null>
}

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
    if (p.tipo === 'acao') {
      return {
        digitacaoMs: 0,
        presenca: 'composing',
        melhorEsforco: true,
        enviar: async ultimaMensagem => {
          const [aviso] = await executarAcoes(token, celular, [p.acao], { nome: ctx.nome, indice: ctx.indice, ultimaMensagem })
          if (aviso) throw new Error(aviso)
          return null
        },
      }
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
