// Aplica a decisão do chatbot (lib/chatbot/fluxo.ts) a uma mensagem recebida pelo webhook da
// uazapi: lê/grava a conversa do contato e envia as etapas com "digitando…" de verdade.
//
// Invariantes:
// - Mensagem repetida pela uazapi (mesmo wa_id) é processada uma vez só (índice único em
//   bot_mensagens) — gravada ANTES de qualquer envio.
// - Um contato é atendido por uma execução de cada vez: trava otimista (versao) + ocupado_ate
//   enquanto o robô digita. Mensagem que chega nesse meio-tempo fica no histórico, sem resposta.
// - Contato que não está em conversa e não cai em gatilho nenhum: nada é gravado nem enviado
//   (cliente de cobrança respondendo lembrete não vira conversa de robô).
// - Falha da uazapi no meio do envio não desfaz o que já saiu; a conversa fica onde parou.
import { createAdminClient } from '@/lib/supabase/admin'
import { labelsDoChat, sendPresence, sendText } from '@/lib/uazapi'
import { celularVariantes } from '@/lib/utils/celular'
import { primeiroNome } from '@/lib/disparo/extracao'
import { duracaoSequenciaMs, TIPOS_MIDIA, type Passo } from '@/lib/disparo/passos'
import { enviosDosPassos } from '@/lib/disparo/envio-passos'
import {
  EXPIRA_CONVERSA_MS, MSG_SAIR, PALAVRAS_SAIR,
  decidir, ehUmaDas, passosDaEtapa, percorrer, precisaDeEtiquetas, schemaEtapas, textoAvisoHumano, textoDoMenu,
  type Decisao, type EstadoConversa, type FluxoAtivo,
} from './fluxo'
import type { MensagemWebhook } from './webhook'

type Supabase = ReturnType<typeof createAdminClient>

const log = '[chatbot]'
/** Tempo máximo que um contato fica travado se a execução morrer no meio. */
const TRAVA_MS = 4 * 60_000
/** Resposta a disparo ligado a fluxo só conta se o disparo saiu nos últimos 7 dias. */
const DISPARO_RECENTE_MS = 7 * 24 * 60 * 60_000
/** "Digitando…" das mensagens curtas do sistema (não entendi, humano, sair). */
const DIGITACAO_CURTA_MS = 3_000

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export type ContaWebhook = { contaId: string; token: string; numeroConectado: string | null }

type Conversa = EstadoConversa & { id: string; nome: string | null; versao: number; ocupado_ate: string | null; iniciado_em: string }

export type Resultado =
  | 'sem_numero' | 'proprio_numero' | 'dono_respondeu' | 'sem_fluxo' | 'ignorada' | 'repetida' | 'ocupado' | 'erro'
  | Decisao['tipo']

// ── Leituras ──────────────────────────────────────────────────────────────────

async function carregarFluxos(supabase: Supabase, contaId: string): Promise<FluxoAtivo[] | null> {
  const { data, error } = await supabase
    .from('bot_fluxos')
    .select('id, nome, etapas, gatilho_palavras, gatilho_etiquetas, excluir_etiquetas, palavras_humano, msg_nao_entendi, msg_humano, aviso_numero')
    .eq('conta_id', contaId)
    .eq('ativo', true)
  if (error) {
    console.error(`${log} leitura dos fluxos falhou`, { contaId, error })
    return null
  }
  return (data ?? []).flatMap(f => {
    const etapas = schemaEtapas.safeParse(f.etapas)
    if (!etapas.success) {
      console.error(`${log} fluxo com etapas inválidas ignorado`, { contaId, fluxoId: f.id })
      return []
    }
    return [{ ...f, etapas: etapas.data }]
  })
}

/**
 * Fluxo do disparo mais recente que este número recebeu (últimos 7 dias, ligado a um fluxo
 * ativo) — e só se o disparo saiu DEPOIS do começo da última conversa: quem já passou pelo
 * fluxo não recomeça a cada mensagem.
 */
async function fluxoDoDisparo(supabase: Supabase, contaId: string, celular: string, fluxoIds: string[], desdeConversa: string | null): Promise<string | null> {
  if (!fluxoIds.length) return null
  const limite = new Date(Date.now() - DISPARO_RECENTE_MS).toISOString()
  const desde = desdeConversa && desdeConversa > limite ? desdeConversa : limite
  const { data: dests, error } = await supabase
    .from('campanha_destinatarios')
    .select('campanha_id, enviado_em')
    .eq('conta_id', contaId)
    .in('celular', celularVariantes(celular))
    .eq('status', 'enviado')
    .gte('enviado_em', desde)
    .order('enviado_em', { ascending: false })
    .limit(20)
  if (error || !dests?.length) {
    if (error) console.error(`${log} leitura dos disparos do contato falhou`, { contaId, error })
    return null
  }
  const { data: camps, error: campErr } = await supabase
    .from('campanhas_wa').select('id, fluxo_id').eq('conta_id', contaId)
    .in('id', [...new Set(dests.map(d => d.campanha_id))]).in('fluxo_id', fluxoIds)
  if (campErr) {
    console.error(`${log} leitura do fluxo do disparo falhou`, { contaId, campErr })
    return null
  }
  const porCampanha = new Map((camps ?? []).map(c => [c.id, c.fluxo_id as string]))
  return dests.map(d => porCampanha.get(d.campanha_id)).find(Boolean) ?? null
}

// ── Gravações ─────────────────────────────────────────────────────────────────

async function registrar(supabase: Supabase, contaId: string, conversaId: string, direcao: 'recebida' | 'enviada' | 'evento', texto: string, waId: string | null = null) {
  const { error } = await supabase.from('bot_mensagens').insert({ conta_id: contaId, conversa_id: conversaId, direcao, texto: texto.slice(0, 4000), wa_id: waId })
  if (error && error.code !== '23505') console.error(`${log} gravar histórico falhou`, { contaId, conversaId, direcao, error })
  return error
}

async function garantirConversa(supabase: Supabase, contaId: string, msg: MensagemWebhook & { celular: string }, atual: Conversa | null): Promise<Conversa | null> {
  if (atual) return atual
  const agora = new Date().toISOString()
  const { error } = await supabase.from('bot_conversas').insert({
    conta_id: contaId, celular: msg.celular, nome: msg.nome, status: 'encerrada',
    variaveis: {}, nao_entendi: 0, versao: 0, ocupado_ate: null, iniciado_em: agora, atualizado_em: agora,
  })
  if (error && error.code !== '23505') {
    console.error(`${log} criar conversa falhou`, { contaId, error })
    return null
  }
  return lerConversa(supabase, contaId, msg.celular)
}

async function lerConversa(supabase: Supabase, contaId: string, celular: string): Promise<Conversa | null> {
  const { data, error } = await supabase
    .from('bot_conversas')
    .select('id, nome, status, fluxo_id, etapa_id, variaveis, nao_entendi, atualizado_em, iniciado_em, versao, ocupado_ate')
    .eq('conta_id', contaId).eq('celular', celular).maybeSingle()
  if (error) throw new Error(`leitura da conversa: ${error.message}`)
  return data ? { ...data, variaveis: (data.variaveis ?? {}) as Record<string, string> } as Conversa : null
}

// ── Envio ─────────────────────────────────────────────────────────────────────

const resumoPasso = (p: Passo) => (p.tipo === 'texto' ? p.texto : `[${TIPOS_MIDIA[p.tipo].rotulo}${p.nome_arquivo ? `: ${p.nome_arquivo}` : ''}]`)

/** Manda uma sequência com o "digitando…" de cada mensagem. false = parou no meio (já logado). */
async function enviarPassos(supabase: Supabase, conta: ContaWebhook, conversa: Conversa, celular: string, passos: Passo[], variaveis: Record<string, string>): Promise<boolean> {
  const nome = primeiroNome(conversa.nome)
  const envios = enviosDosPassos(supabase, conta.token, celular, passos, {
    indice: Math.floor(Math.random() * 1000), nome, variaveis: { nome: nome ?? '', ...variaveis },
  })
  for (const [i, e] of envios.entries()) {
    try {
      if (e.digitacaoMs > 0) {
        await sendPresence(conta.token, celular, e.digitacaoMs, e.presenca)
        await sleep(e.digitacaoMs)
      }
      await e.enviar()
      await registrar(supabase, conta.contaId, conversa.id, 'enviada', resumoPasso(passos[i]))
    } catch (err) {
      console.error(`${log} envio falhou`, { contaId: conta.contaId, conversaId: conversa.id, err })
      await registrar(supabase, conta.contaId, conversa.id, 'evento', `Falha ao enviar: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }
  return true
}

const textoCurto = (texto: string): Passo[] => [{ tipo: 'texto', texto, variacoes: [], digitacao_seg: DIGITACAO_CURTA_MS / 1000 }]

async function avisarDono(conta: ContaWebhook, fluxo: FluxoAtivo, conversa: Conversa, celular: string, variaveis: Record<string, string>, motivo: string) {
  if (!fluxo.aviso_numero) return
  try {
    await sendText(conta.token, fluxo.aviso_numero, textoAvisoHumano(fluxo, { nome: conversa.nome, celular }, variaveis, motivo))
  } catch (err) {
    console.error(`${log} aviso ao dono falhou`, { contaId: conta.contaId, conversaId: conversa.id, err })
  }
}

// ── Ponto de entrada ──────────────────────────────────────────────────────────

export async function processarMensagem(
  supabase: Supabase,
  conta: ContaWebhook,
  msg: MensagemWebhook,
  orcamento: { inicio: number; budgetMs: number },
): Promise<Resultado> {
  if (!msg.celular) return 'sem_numero'
  const celular = msg.celular
  const { contaId } = conta
  const agora = new Date()

  let conversa: Conversa | null
  try {
    conversa = await lerConversa(supabase, contaId, celular)
  } catch (err) {
    console.error(`${log} leitura da conversa falhou`, { contaId, err })
    return 'erro'
  }

  // O dono digitou no celular para este contato: o robô sai da frente.
  if (msg.fromMe) {
    if (conta.numeroConectado && celularVariantes(conta.numeroConectado).includes(celular)) return 'proprio_numero'
    if (conversa?.status !== 'ativa') return 'ignorada'
    const { error } = await supabase.from('bot_conversas')
      .update({ status: 'humano', ocupado_ate: null, atualizado_em: agora.toISOString() })
      .eq('id', conversa.id).eq('conta_id', contaId).eq('status', 'ativa')
    if (error) { console.error(`${log} pausar conversa falhou`, { contaId, error }); return 'erro' }
    await registrar(supabase, contaId, conversa.id, 'evento', 'Você respondeu pelo celular: robô pausado para este contato.')
    return 'dono_respondeu'
  }

  const fluxos = await carregarFluxos(supabase, contaId)
  if (!fluxos) return 'erro'
  const ehSair = ehUmaDas(msg.texto, PALAVRAS_SAIR)
  if (!conversa && !fluxos.length && !ehSair) return 'sem_fluxo'

  const base = {
    texto: msg.texto, agora, conversa, fluxos,
    fluxoDoDisparo: null as string | null,
  }
  const andamento = conversa?.status === 'ativa' && agora.getTime() - new Date(conversa.atualizado_em).getTime() <= EXPIRA_CONVERSA_MS
  if (!andamento && fluxos.length) {
    base.fluxoDoDisparo = await fluxoDoDisparo(supabase, contaId, celular, fluxos.map(f => f.id), conversa?.iniciado_em ?? null)
  }
  let etiquetas: string[] | null = msg.etiquetas
  if (etiquetas === null && precisaDeEtiquetas(base)) {
    try { etiquetas = await labelsDoChat(conta.token, celular) } catch (err) {
      console.error(`${log} leitura das etiquetas falhou (fluxos com etiqueta ficam de fora)`, { contaId, err })
    }
  }
  const decisao = decidir({ ...base, etiquetas })

  if (decisao.tipo === 'ignorar' && !conversa) return 'ignorada'

  // Daqui em diante existe conversa: grava a mensagem (e barra a repetida) antes de responder.
  const c = await garantirConversa(supabase, contaId, { ...msg, celular }, conversa)
  if (!c) return 'erro'
  const regErr = await registrar(supabase, contaId, c.id, 'recebida', msg.texto || `[${msg.midia ?? 'mensagem sem texto'}]`, msg.waId)
  if (regErr?.code === '23505') return 'repetida'
  if (decisao.tipo === 'ignorar') return 'ignorada'

  if (c.ocupado_ate && new Date(c.ocupado_ate) > agora) return 'ocupado'
  const { data: travou, error: travaErr } = await supabase.from('bot_conversas')
    .update({ ocupado_ate: new Date(agora.getTime() + TRAVA_MS).toISOString(), versao: c.versao + 1 })
    .eq('id', c.id).eq('conta_id', contaId).eq('versao', c.versao)
    .select('id').maybeSingle()
  if (travaErr) { console.error(`${log} travar conversa falhou`, { contaId, travaErr }); return 'erro' }
  if (!travou) return 'ocupado'

  const salvar = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from('bot_conversas')
      .update({ ...patch, ocupado_ate: null, atualizado_em: new Date().toISOString() })
      .eq('id', c.id).eq('conta_id', contaId)
    if (error) console.error(`${log} gravar estado da conversa falhou`, { contaId, conversaId: c.id, error })
  }

  try {
    await aplicar(supabase, conta, c, celular, decisao, orcamento, salvar)
  } catch (err) {
    console.error(`${log} processamento falhou`, { contaId, conversaId: c.id, err })
    await salvar({})
    return 'erro'
  }
  return decisao.tipo
}

async function aplicar(
  supabase: Supabase,
  conta: ContaWebhook,
  c: Conversa,
  celular: string,
  decisao: Exclude<Decisao, { tipo: 'ignorar' }>,
  orcamento: { inicio: number; budgetMs: number },
  salvar: (patch: Record<string, unknown>) => Promise<void>,
) {
  const { contaId } = conta

  if (decisao.tipo === 'sair') {
    await salvar({ status: 'descadastrado', fluxo_id: null, etapa_id: null, nao_entendi: 0 })
    await registrar(supabase, contaId, c.id, 'evento', 'Pediu para sair: não recebe mais o robô nem disparos.')
    await enviarPassos(supabase, conta, c, celular, textoCurto(MSG_SAIR), {})
    return
  }

  if (decisao.tipo === 'humano') {
    await salvar({ status: 'humano', nao_entendi: 0 })
    await registrar(supabase, contaId, c.id, 'evento', `Robô pausado: ${decisao.motivo}.`)
    await enviarPassos(supabase, conta, c, celular, textoCurto(decisao.fluxo.msg_humano), c.variaveis)
    await avisarDono(conta, decisao.fluxo, c, celular, c.variaveis, decisao.motivo)
    return
  }

  if (decisao.tipo === 'nao_entendi') {
    const etapa = decisao.fluxo.etapas.find(e => e.id === c.etapa_id)
    const menu = etapa?.resposta.tipo === 'menu' ? `\n\n${textoDoMenu(etapa.resposta.opcoes)}` : ''
    await salvar({ nao_entendi: decisao.tentativas })
    await enviarPassos(supabase, conta, c, celular, textoCurto(decisao.fluxo.msg_nao_entendi + menu), c.variaveis)
    return
  }

  // iniciar / avancar: manda as etapas até a próxima que espera resposta.
  const fluxo = decisao.fluxo
  const inicio = decisao.tipo === 'iniciar' ? fluxo.etapas[0].id : decisao.etapaId
  const variaveis = decisao.tipo === 'iniciar' ? {} : decisao.variaveis
  const percurso = percorrer(fluxo, inicio)
  if (decisao.tipo === 'iniciar') {
    await registrar(supabase, contaId, c.id, 'evento', `Entrou no fluxo "${fluxo.nome}" (${decisao.gatilho === 'palavra' ? 'palavra-chave' : decisao.gatilho === 'disparo' ? 'respondeu ao disparo' : 'etiqueta'}).`)
  }

  let completas = 0
  let parouEm: string | null = null // etapa que começou a sair e falhou no meio
  for (const etapa of percurso.enviar) {
    const passos = passosDaEtapa(etapa)
    if (Date.now() - orcamento.inicio + duracaoSequenciaMs(passos) > orcamento.budgetMs) {
      console.error(`${log} sem tempo para enviar a etapa nesta execução`, { contaId, conversaId: c.id, etapa: etapa.id })
      break
    }
    if (!(await enviarPassos(supabase, conta, c, celular, passos, variaveis))) { parouEm = etapa.id; break }
    completas++
  }

  const comum = {
    fluxo_id: fluxo.id, variaveis, nao_entendi: 0,
    ...(decisao.tipo === 'iniciar' ? { iniciado_em: new Date().toISOString() } : {}),
  }
  if (completas < percurso.enviar.length) {
    // Parou no meio: fica na última etapa que saiu (ou encerra, se nada saiu).
    const ultima = parouEm ?? percurso.enviar[completas - 1]?.id ?? null
    await salvar({ ...comum, status: ultima ? 'ativa' : 'encerrada', etapa_id: ultima })
  } else if (percurso.depois.tipo === 'aguardar') {
    await salvar({ ...comum, status: 'ativa', etapa_id: percurso.depois.etapaId })
  } else if (percurso.depois.tipo === 'humano') {
    await salvar({ ...comum, status: 'humano', etapa_id: null })
    await registrar(supabase, contaId, c.id, 'evento', 'Robô pausado: o fluxo passou para atendimento humano.')
    await avisarDono(conta, fluxo, c, celular, variaveis, 'chegou na etapa de atendimento humano')
  } else {
    await salvar({ ...comum, status: 'encerrada', etapa_id: null })
  }
}
