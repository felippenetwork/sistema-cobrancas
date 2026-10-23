// Extração de contatos de grupo/comunidade do WhatsApp para a lista do disparo (regras puras,
// testadas em tests/disparo-extracao.test.ts). Formato da uazapi confirmado contra a API real
// em 2026-10-23:
// - participant_profiles[].pn = telefone ("55…@s.whatsapp.net"); vazio em grupo com número
//   oculto (endereçamento LID) — esses membros não têm como ser extraídos.
// - participant_profiles[].name = nome que a pessoa usa no WhatsApp (bate com wa_name do
//   /chat/find; nunca com o nome da agenda). Só vem para quem o número já "conhece".
// - Comunidade (IsParent) quase não tem membros no grupo pai: eles ficam nos subgrupos ligados
//   (LinkedParentJID = JID da comunidade). Extrair a comunidade = juntar os subgrupos.
import type { UazapiGrupo } from '@/lib/uazapi'
import type { ContatoLista } from './progressivo'

export type PreferenciaNome = 'whatsapp' | 'agenda'

export type ResumoGrupo = {
  jid: string
  nome: string
  tipo: 'comunidade' | 'grupo'
  /** Nome da comunidade, quando o grupo é um subgrupo dela. */
  comunidade: string | null
  total: number
  comTelefone: number
}

type Membro = { telefone: string | null; nomeWhatsApp: string | null }

function telefoneDe(bruto: string | null | undefined): string | null {
  const t = String(bruto ?? '').split('@')[0].split(':')[0].replace(/\D/g, '')
  return t.length >= 10 && t.length <= 15 ? t : null
}

/** Membros de UM grupo: prefere participant_profiles (traz o nome); senão Participants. */
function membrosDoGrupo(g: UazapiGrupo): Membro[] {
  if (g.participant_profiles?.length) {
    return g.participant_profiles.map(p => ({ telefone: telefoneDe(p.pn), nomeWhatsApp: p.name?.trim() || null }))
  }
  return (g.Participants ?? []).map(p => ({
    telefone: telefoneDe(p.PhoneNumber) ?? (p.JID?.endsWith('@s.whatsapp.net') ? telefoneDe(p.JID) : null),
    nomeWhatsApp: p.DisplayName?.trim() || null,
  }))
}

/** Grupos que compõem o alvo: a comunidade inteira (pai + subgrupos) ou só o grupo. */
function gruposDoAlvo(grupos: UazapiGrupo[], jid: string): UazapiGrupo[] {
  const alvo = grupos.find(g => g.JID === jid)
  if (!alvo) return []
  return alvo.IsParent ? [alvo, ...grupos.filter(g => g.LinkedParentJID === jid)] : [alvo]
}

function contar(gs: UazapiGrupo[]): { total: number; comTelefone: number } {
  const todos = new Set<string>()
  let semTelefone = 0
  for (const g of gs) for (const m of membrosDoGrupo(g)) {
    if (m.telefone) todos.add(m.telefone)
    else semTelefone++
  }
  return { total: todos.size + semTelefone, comTelefone: todos.size }
}

/** Lista para a tela: comunidades primeiro (com os membros somados), depois grupos, por nome. */
export function resumirGrupos(grupos: UazapiGrupo[]): ResumoGrupo[] {
  const nomeDe = new Map(grupos.map(g => [g.JID, g.Name || 'Sem nome']))
  const itens = grupos.map((g): ResumoGrupo => ({
    jid: g.JID,
    nome: g.Name || 'Sem nome',
    tipo: g.IsParent ? 'comunidade' : 'grupo',
    comunidade: g.LinkedParentJID ? nomeDe.get(g.LinkedParentJID) ?? null : null,
    ...contar(gruposDoAlvo(grupos, g.JID)),
  }))
  return itens.sort((a, b) =>
    a.tipo !== b.tipo ? (a.tipo === 'comunidade' ? -1 : 1) : a.nome.localeCompare(b.nome, 'pt-BR'))
}

/**
 * Primeiro nome "de gente" de um texto: primeira palavra com letra, sem emoji nem símbolo
 * nas pontas ("🔥João Silva" → "João"). Nada aproveitável → null.
 */
export function primeiroNome(texto: string | null | undefined): string | null {
  const palavra = String(texto ?? '')
    .split(/\s+/)
    .map(p => p.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
    .find(p => /\p{L}/u.test(p))
  return palavra ? palavra.slice(0, 40) : null
}

/**
 * Contatos do grupo/comunidade `jid`, um por telefone, sem o próprio número conectado. O nome
 * segue a preferência e cai para a outra fonte quando a preferida não tem: "whatsapp" = nome do
 * WhatsApp → agenda; "agenda" = nome salvo → WhatsApp. Sempre o primeiro nome.
 */
export function extrairContatos(
  grupos: UazapiGrupo[],
  jid: string,
  agenda: Map<string, string>,
  preferencia: PreferenciaNome,
  proprioNumero: string | null,
): { contatos: ContatoLista[]; semTelefone: number } {
  const porTelefone = new Map<string, string | null>()
  let semTelefone = 0
  const proprio = telefoneDe(proprioNumero)

  for (const g of gruposDoAlvo(grupos, jid)) for (const m of membrosDoGrupo(g)) {
    if (!m.telefone) { semTelefone++; continue }
    if (m.telefone === proprio) continue
    const salvo = agenda.get(m.telefone) ?? null
    const nome = preferencia === 'whatsapp' ? (m.nomeWhatsApp ?? salvo) : (salvo ?? m.nomeWhatsApp)
    const atual = porTelefone.get(m.telefone)
    // Mesmo número em dois subgrupos: fica com a versão que tiver nome.
    if (atual === undefined || (atual === null && nome)) porTelefone.set(m.telefone, primeiroNome(nome))
  }
  return { contatos: [...porTelefone].map(([celular, nome]) => ({ celular, nome })), semTelefone }
}

/** Linhas no formato que a lista do disparo entende ("Nome; número" ou só o número). */
export function paraLinhas(contatos: ContatoLista[]): string {
  return contatos.map(c => (c.nome ? `${c.nome}; ${c.celular}` : c.celular)).join('\n')
}
