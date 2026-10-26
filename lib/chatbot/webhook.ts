// Leitura do webhook de mensagens da uazapi (POST /api/webhooks/chatbot). Formato confirmado em
// produção no projeto irmão ERP-Rifas (2026-08-08 e 2026-10-21): um objeto por chamada,
// { EventType: 'messages', token, owner, chat?, message: { chatid, sender_pn, senderName, text,
//   fromMe, wasSentByApi, isGroup, messageid, mediaType } }.
// - chatid de conversa privada: "<número>@s.whatsapp.net"; quando o WhatsApp identifica a pessoa só
//   por LID ("…@lid"), o número vem em sender_pn (e às vezes não vem — aí não dá para responder).
// - wasSentByApi: a própria mensagem que o sistema mandou volta pelo webhook — ignorar.
// - fromMe sem wasSentByApi: o dono digitou no celular (o robô pausa para esse contato).

export type MensagemWebhook = {
  /** Instância que recebeu (confere com conexoes.uazapi_instance_token). */
  token: string | null
  /** Só dígitos; null quando não dá para saber o número. */
  celular: string | null
  texto: string
  nome: string | null
  waId: string | null
  fromMe: boolean
  /** Mídia sem texto (áudio, foto…): o robô trata como resposta vazia. */
  midia: string | null
  /** Etiquetas do chat quando a uazapi já manda junto (senão o robô busca, se precisar). */
  etiquetas: string[] | null
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** null = não é mensagem que o robô deva olhar (outro evento, grupo, eco do próprio sistema). */
export function lerMensagemWebhook(payload: unknown): MensagemWebhook | null {
  const p = obj(payload)
  if (!p || p.EventType !== 'messages') return null
  const m = obj(p.message)
  if (!m || m.wasSentByApi === true || m.isGroup === true) return null

  const chatid = str(m.chatid)
  if (!chatid || chatid.endsWith('@g.us') || chatid.endsWith('@newsletter') || chatid === 'status@broadcast') return null

  const fromMe = m.fromMe === true
  // fromMe: o "outro lado" é o chat; recebida: sender_pn é o mais confiável (LID), senão o chatid.
  const doChat = chatid.endsWith('@s.whatsapp.net') ? chatid : ''
  const bruto = fromMe ? doChat : (str(m.sender_pn) || doChat)
  const digitos = bruto.split('@')[0].replace(/\D/g, '')
  const celular = digitos.length >= 10 && digitos.length <= 15 ? digitos : null

  const chat = obj(p.chat)
  const etiquetas = Array.isArray(chat?.wa_label) ? (chat.wa_label as unknown[]).map(String) : null

  return {
    token: str(p.token) || null,
    celular,
    texto: str(m.text).trim().slice(0, 4000),
    nome: str(m.senderName).trim().slice(0, 80) || null,
    waId: str(m.messageid) || str(m.id) || null,
    fromMe,
    midia: str(m.mediaType) || null,
    etiquetas,
  }
}
