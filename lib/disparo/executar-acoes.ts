// Executa as ações depois do envio (lib/disparo/acoes.ts), na ordem da lista. Melhor esforço: a
// que falhar vira um aviso e a próxima continua — o envio já aconteceu e nunca é desfeito.
import {
  addContact, archiveChat, editNotes, labelsDoChat, muteChat, pinChat, pinMessage, readChat, setChatLabel,
} from '@/lib/uazapi'
import { descreverAcao, type Acao } from './acoes'
import { montarTexto } from './progressivo'

const mensagemDe = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function executar(token: string, celular: string, a: Acao, ctx: { nome: string | null; indice: number; ultimaMensagem: string | null }) {
  switch (a.tipo) {
    case 'etiqueta_por':          return setChatLabel(token, celular, 'adicionar', a.id)
    case 'etiqueta_tirar':        return setChatLabel(token, celular, 'remover', a.id)
    case 'etiquetas_tirar_todas': {
      // Lê as etiquetas que a conversa tem agora e tira uma por uma (chamadas já usadas em produção).
      const atuais = await labelsDoChat(token, celular)
      for (const id of atuais) await setChatLabel(token, celular, 'remover', id.split(':').pop() as string)
      return
    }
    case 'arquivar':              return archiveChat(token, celular, true)
    case 'desarquivar':           return archiveChat(token, celular, false)
    case 'fixar_conversa':        return pinChat(token, celular, true)
    case 'desafixar_conversa':    return pinChat(token, celular, false)
    case 'fixar_mensagem':
      if (!ctx.ultimaMensagem) throw new Error('a uazapi não informou o id da mensagem enviada')
      return pinMessage(token, ctx.ultimaMensagem, a.dias)
    case 'silenciar':             return muteChat(token, celular, a.horas)
    case 'tirar_silencio':        return muteChat(token, celular, 0)
    case 'marcar_lida':           return readChat(token, celular, true)
    case 'marcar_nao_lida':       return readChat(token, celular, false)
    case 'salvar_contato':        return addContact(token, celular, ctx.nome?.trim() || `+${celular}`)
    case 'nota':                  return editNotes(token, celular, montarTexto(a.texto, [], ctx.indice, ctx.nome))
  }
}

/** Devolve os avisos das ações que falharam (vazio = tudo certo). */
export async function executarAcoes(
  token: string,
  celular: string,
  acoes: Acao[],
  ctx: { nome: string | null; indice: number; ultimaMensagem: string | null },
): Promise<string[]> {
  const avisos: string[] = []
  for (const a of acoes) {
    try {
      await executar(token, celular, a, ctx)
    } catch (err) {
      avisos.push(`Não conseguiu: ${descreverAcao(a)} (${mensagemDe(err)})`)
    }
  }
  return avisos
}
