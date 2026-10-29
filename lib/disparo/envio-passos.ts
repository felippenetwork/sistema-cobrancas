// Envio de uma sequência de mensagens ("caixinhas", lib/disparo/passos.ts) para um número, usado
// pelos disparos (lib/disparo/campanhas.ts) e pelo chatbot (lib/chatbot/processar.ts). Cada envio
// sabe quanto tempo fica "digitando…"/"gravando…" antes; quem chama decide o que fazer com falhas.
// Caixinha de AÇÃO (etiqueta, arquivar…) no meio da sequência roda como um envio sem digitação,
// marcado `melhorEsforco`: se falhar, quem chama registra o aviso e segue para a próxima.
import { createAdminClient } from '@/lib/supabase/admin'
import { sendMedia, sendPresence, sendText } from '@/lib/uazapi'
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

export type ResultadoSequencia = {
  /** Mensagens (não ações) que saíram. */
  feitos: number
  total: number
  /** Ações que falharam no meio (a sequência seguiu). */
  avisos: string[]
  ultimaMensagem: string | null
  /** Mensagem que falhou e interrompeu a sequência (o que vem depois dela não saiu). */
  falha: { erro: unknown } | null
}

/** Envia na ordem, com o "digitando…" de cada um; para na primeira MENSAGEM que falhar. */
export async function enviarSequencia(token: string, celular: string, envios: Envio[]): Promise<ResultadoSequencia> {
  const r: ResultadoSequencia = { feitos: 0, total: envios.filter(e => !e.melhorEsforco).length, avisos: [], ultimaMensagem: null, falha: null }
  for (const e of envios) {
    try {
      if (e.digitacaoMs > 0) {
        await sendPresence(token, celular, e.digitacaoMs, e.presenca)
        await new Promise<void>(resolve => setTimeout(resolve, e.digitacaoMs))
      }
      r.ultimaMensagem = (await e.enviar(r.ultimaMensagem)) ?? r.ultimaMensagem
      if (!e.melhorEsforco) r.feitos++
    } catch (err) {
      if (e.melhorEsforco) { r.avisos.push(err instanceof Error ? err.message : String(err)); continue }
      r.falha = { erro: err }
      break
    }
  }
  return r
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
