// Envio das campanhas de /disparos, chamado pelo cron /api/cron/whatsapp-uazapi depois dos
// lembretes da conta, com o tempo que sobrar da execução (nunca um orçamento adicional).
//
// - Normal: drena a lista um por um, com intervalo aleatório (45–80s) + 15–20s de digitação.
// - Progressivo: uma vez por dia sorteia os horários da cota do dia dentro da janela da campanha
//   (lib/disparo/progressivo.ts) e, a cada execução, envia só quem já chegou no seu horário.
//   Várias campanhas progressivas podem rodar juntas; a normal é uma por vez.
// - Sequência (campanhas_wa.passos, lib/disparo/passos.ts): cada contato recebe várias mensagens
//   (texto/mídia), cada uma com o próprio "digitando…"/"gravando…" antes. Sem passos, vale a
//   mensagem única (20s de digitação no progressivo, 15–20s no normal).
// - Depois do envio: etiqueta do WhatsApp Business (remover/adicionar) e registro do número —
//   ambos melhor esforço, viram `aviso` no contato, nunca desfazem o envio.
//
// Invariantes (mesmas dos lembretes, skill whatsapp-uazapi): claim atômico pendente → enviado
// antes de mandar; 429 da uazapi devolve o contato para 'pendente' e para a conta neste tick;
// depois que a mensagem saiu, nada a devolve para 'pendente'.
import { createAdminClient } from '@/lib/supabase/admin'
import { sendMedia, sendPresence, sendText, setChatLabel, UazapiRateLimitError } from '@/lib/uazapi'
import { BUCKET_MIDIA, TIPOS_MIDIA, duracaoSequenciaMs, textoDoPasso, type Passo } from './passos'
import {
  DIGITACAO_PROGRESSIVO_MS,
  dataSP,
  instanteSP,
  minutosDoDia,
  montarTexto,
  quotaDoDia,
  sortearHorarios,
} from './progressivo'

type Supabase = ReturnType<typeof createAdminClient>

export type JanelaConta = { horario_inicio?: string | null; horario_fim?: string | null; intervalo_min_seg?: number | null; intervalo_max_seg?: number | null } | undefined

type Campanha = {
  id: string
  tipo: 'normal' | 'progressivo'
  mensagem: string | null
  variacoes: string[] | null
  janela_inicio: string | null
  janela_fim: string | null
  prog_inicio: number | null
  prog_maximo: number | null
  prog_dia: number
  prog_planejado_em: string | null
  registrar_enviados: boolean
  excluir_ja_enviados: boolean
  passos: Passo[] | null
  etiqueta_adicionar: string | null
  etiqueta_remover: string | null
  modelos_wa: { corpo: string } | null
}

type Destinatario = { id: string; celular: string; nome: string | null; ordem: number | null; variaveis: unknown }

// 'parar' = rate limit da uazapi ou banco com problema: não insiste nesta conta neste tick
// (o contato continua 'pendente'). 'ocupado' = outra execução levou o contato.
// 'campanha_parada' = a campanha foi pausada/cancelada no meio da execução.
type ResultadoEnvio = 'enviado' | 'falhou' | 'pulado' | 'ocupado' | 'parar' | 'campanha_parada'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function aleatorioMs(minSeg: number, maxSeg: number): number {
  const min = minSeg * 1000
  const max = Math.max(maxSeg * 1000, min)
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function dentroDaJanela(inicio: string, fim: string, agora = new Date()): boolean {
  const hora = agora.toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
  const m = minutosDoDia(hora)
  return m >= minutosDoDia(inicio) && m < minutosDoDia(fim)
}

const log = '[disparo/campanhas]'

/** A sequência de um contato cabe no que resta desta execução? Se não, fica para o próximo tick. */
function cabeNoOrcamento(c: Campanha, digitacaoMs: number, inicioExecucao: number, budgetMs: number): boolean {
  const precisa = c.passos?.length ? duracaoSequenciaMs(c.passos) : digitacaoMs + 5_000
  return Date.now() - inicioExecucao + precisa <= budgetMs
}

// ── Ponto de entrada ──────────────────────────────────────────────────────────

export async function processarCampanhas(
  supabase: Supabase,
  contaId: string,
  token: string,
  cfg: JanelaConta,
  inicioExecucao: number,
  budgetMs: number,
): Promise<number> {
  const { data, error } = await supabase
    .from('campanhas_wa')
    .select('id, tipo, mensagem, variacoes, janela_inicio, janela_fim, prog_inicio, prog_maximo, prog_dia, prog_planejado_em, registrar_enviados, excluir_ja_enviados, passos, etiqueta_adicionar, etiqueta_remover, modelos_wa(corpo)')
    .eq('conta_id', contaId)
    .eq('status', 'enviando')
    .order('iniciado_em', { ascending: true })

  if (error) {
    console.error(`${log} leitura das campanhas falhou`, { contaId, error })
    return 0
  }
  const campanhas = (data ?? []) as unknown as Campanha[]
  let enviados = 0

  // Progressivas primeiro: têm hora marcada; a normal usa o tempo que sobrar.
  for (const c of campanhas.filter(c => c.tipo === 'progressivo')) {
    const r = await processarProgressiva(supabase, contaId, token, c, inicioExecucao, budgetMs)
    enviados += r.enviados
    if (r.pararConta) return enviados
  }

  const normal = campanhas.find(c => c.tipo !== 'progressivo')
  if (normal) enviados += await processarNormal(supabase, contaId, token, normal, cfg, inicioExecucao, budgetMs)
  return enviados
}

// ── Progressiva ───────────────────────────────────────────────────────────────

async function processarProgressiva(
  supabase: Supabase,
  contaId: string,
  token: string,
  c: Campanha,
  inicioExecucao: number,
  budgetMs: number,
): Promise<{ enviados: number; pararConta: boolean }> {
  const janelaInicio = c.janela_inicio as string
  const janelaFim    = c.janela_fim as string

  await planejarDia(supabase, contaId, c)

  let enviados = 0
  while (Date.now() - inicioExecucao < budgetMs) {
    // Fora da janela não envia nem atrasado: o que sobrar volta para o sorteio do dia seguinte.
    if (!dentroDaJanela(janelaInicio, janelaFim)) break

    const { data: proximos, error } = await supabase
      .from('campanha_destinatarios')
      .select('id, celular, nome, ordem, variaveis')
      .eq('campanha_id', c.id)
      .eq('conta_id', contaId)
      .eq('status', 'pendente')
      .lte('agendado_para', new Date().toISOString())
      .order('agendado_para', { ascending: true })
      .limit(1)
    if (error) {
      console.error(`${log} leitura da fila progressiva falhou`, { contaId, campanhaId: c.id, error })
      break
    }
    const dest = proximos?.[0] as Destinatario | undefined
    if (!dest) {
      await concluirSeAcabou(supabase, contaId, c.id)
      break
    }

    if (!cabeNoOrcamento(c, DIGITACAO_PROGRESSIVO_MS, inicioExecucao, budgetMs)) break
    const r = await enviarDestinatario(supabase, contaId, token, c, dest, DIGITACAO_PROGRESSIVO_MS)
    if (r === 'enviado') enviados++
    if (r === 'parar') return { enviados, pararConta: true }
    if (r === 'campanha_parada') break
  }
  return { enviados, pararConta: false }
}

/**
 * Uma vez por dia (data de São Paulo): sorteia os horários da cota do dia para os próximos
 * contatos da lista. Não consome o dia se a janela de hoje já acabou (começa amanhã). O dia é
 * "reservado" com trava otimista em prog_dia — duas execuções do cron nunca planejam em dobro.
 */
async function planejarDia(supabase: Supabase, contaId: string, c: Campanha): Promise<void> {
  const agora = new Date()
  const hoje  = dataSP(agora)
  if (c.prog_planejado_em === hoje) return

  const fimHoje    = instanteSP(hoje, c.janela_fim as string)
  const inicioHoje = instanteSP(hoje, c.janela_inicio as string)
  const de = new Date(Math.max(inicioHoje.getTime(), agora.getTime() + 60_000))
  if (fimHoje.getTime() - de.getTime() < 5 * 60_000) return

  const diaDoCiclo = c.prog_dia

  const { data: reservado, error: reservaErr } = await supabase
    .from('campanhas_wa')
    .update({ prog_dia: diaDoCiclo + 1, prog_planejado_em: hoje })
    .eq('id', c.id)
    .eq('conta_id', contaId)
    .eq('status', 'enviando')
    .eq('prog_dia', diaDoCiclo)
    .select('id')
    .maybeSingle()
  if (reservaErr) {
    console.error(`${log} reserva do dia falhou`, { contaId, campanhaId: c.id, reservaErr })
    return
  }
  if (!reservado) return // outra execução já planejou hoje

  // Horários de dias anteriores que não saíram (WhatsApp caiu, janela acabou) voltam para o sorteio.
  const { error: liberarErr } = await supabase
    .from('campanha_destinatarios')
    .update({ agendado_para: null })
    .eq('campanha_id', c.id)
    .eq('conta_id', contaId)
    .eq('status', 'pendente')
    .lt('agendado_para', instanteSP(hoje, '00:00').toISOString())
  if (liberarErr) console.error(`${log} liberar horários antigos falhou`, { contaId, campanhaId: c.id, liberarErr })

  const quota    = quotaDoDia(diaDoCiclo, c.prog_inicio as number, c.prog_maximo as number)
  const horarios = sortearHorarios(quota, de, fimHoje)

  const { data: candidatos, error: candErr } = await supabase
    .from('campanha_destinatarios')
    .select('id')
    .eq('campanha_id', c.id)
    .eq('conta_id', contaId)
    .eq('status', 'pendente')
    .is('agendado_para', null)
    .order('ordem', { ascending: true })
    .limit(horarios.length)
  if (candErr) {
    console.error(`${log} leitura dos próximos contatos falhou`, { contaId, campanhaId: c.id, candErr })
    return
  }

  for (const [i, cand] of (candidatos ?? []).entries()) {
    const { error } = await supabase
      .from('campanha_destinatarios')
      .update({ agendado_para: horarios[i].toISOString() })
      .eq('id', cand.id)
      .eq('conta_id', contaId)
      .eq('status', 'pendente')
    if (error) console.error(`${log} gravar horário falhou`, { contaId, campanhaId: c.id, destId: cand.id, error })
  }
}

// ── Normal ────────────────────────────────────────────────────────────────────

async function processarNormal(
  supabase: Supabase,
  contaId: string,
  token: string,
  c: Campanha,
  cfg: JanelaConta,
  inicioExecucao: number,
  budgetMs: number,
): Promise<number> {
  const hInicio = cfg?.horario_inicio ?? '09:00'
  const hFim    = cfg?.horario_fim    ?? '20:00'
  const intMin  = cfg?.intervalo_min_seg ?? 45
  const intMax  = cfg?.intervalo_max_seg ?? 80

  if (!c.modelos_wa?.corpo && !c.mensagem) return 0

  let enviados = 0
  while (Date.now() - inicioExecucao < budgetMs) {
    if (!dentroDaJanela(hInicio, hFim)) break

    const { data: pendentes, error } = await supabase
      .from('campanha_destinatarios')
      .select('id, celular, nome, ordem, variaveis')
      .eq('campanha_id', c.id)
      .eq('conta_id', contaId)
      .eq('status', 'pendente')
      .limit(1)
    if (error) {
      console.error(`${log} leitura da fila falhou`, { contaId, campanhaId: c.id, error })
      break
    }
    const dest = pendentes?.[0] as Destinatario | undefined
    if (!dest) {
      await concluirSeAcabou(supabase, contaId, c.id)
      break
    }

    const r = await enviarDestinatario(supabase, contaId, token, c, dest, 15_000 + Math.floor(Math.random() * 5_000))
    if (r === 'enviado') enviados++
    if (r === 'parar' || r === 'campanha_parada') break
    if (r === 'enviado' || r === 'falhou') await sleep(aleatorioMs(intMin, intMax))
  }
  return enviados
}

// ── Um contato ────────────────────────────────────────────────────────────────

function textoDaCampanha(c: Campanha, dest: Destinatario): string {
  let texto = montarTexto(c.mensagem ?? c.modelos_wa?.corpo ?? '', c.variacoes ?? [], dest.ordem ?? 0, dest.nome)
  const vars = Array.isArray(dest.variaveis) ? (dest.variaveis as unknown[]).map(String) : []
  vars.forEach((v, i) => { texto = texto.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), v) })
  return texto
}

async function enviarDestinatario(
  supabase: Supabase,
  contaId: string,
  token: string,
  c: Campanha,
  dest: Destinatario,
  digitacaoMs: number,
): Promise<ResultadoEnvio> {
  // Pausar/cancelar vale na hora, mesmo no meio de uma execução do cron.
  const { data: atual, error: statusErr } = await supabase
    .from('campanhas_wa').select('status').eq('id', c.id).eq('conta_id', contaId).maybeSingle()
  if (statusErr) {
    console.error(`${log} leitura do status da campanha falhou`, { contaId, campanhaId: c.id, statusErr })
    return 'parar'
  }
  if (atual?.status !== 'enviando') return 'campanha_parada'

  // Recebeu de outro disparo depois que esta campanha começou: pula, sem contar como falha.
  if (c.excluir_ja_enviados) {
    const { data: ja, error } = await supabase
      .from('contatos_disparados').select('id').eq('conta_id', contaId).eq('celular', dest.celular).maybeSingle()
    if (error) {
      console.error(`${log} checagem de já disparado falhou`, { contaId, destId: dest.id, error })
      return 'parar'
    }
    if (ja) {
      const { data: pulou } = await supabase.from('campanha_destinatarios')
        .update({ status: 'pulado', erro: 'Já recebeu um disparo antes' })
        .eq('id', dest.id).eq('conta_id', contaId).eq('status', 'pendente').select('id').maybeSingle()
      if (pulou) await atualizarTotais(supabase, contaId, c.id)
      return 'pulado'
    }
  }

  // Claim atômico: só uma execução leva este contato.
  const { data: claimed, error: claimErr } = await supabase
    .from('campanha_destinatarios')
    .update({ status: 'enviado', enviado_em: new Date().toISOString() })
    .eq('id', dest.id)
    .eq('conta_id', contaId)
    .eq('status', 'pendente')
    .select('id')
    .maybeSingle()
  if (claimErr) {
    console.error(`${log} claim de destinatário falhou`, { contaId, destId: dest.id, claimErr })
    return 'parar'
  }
  if (!claimed) return 'ocupado'

  // Cada envio: "digitando…"/"gravando…" pelo tempo pedido e, então, a mensagem/mídia.
  const envios = montarEnvios(supabase, token, c, dest, digitacaoMs)
  let feitos = 0
  const avisos: string[] = []
  let pararDepois = false

  for (const e of envios) {
    try {
      if (e.digitacaoMs > 0) {
        await sendPresence(token, dest.celular, e.digitacaoMs, e.presenca)
        await sleep(e.digitacaoMs)
      }
      await e.enviar()
      feitos++
    } catch (err) {
      if (feitos === 0) {
        // Nada saiu ainda: rate limit ou falha passageira (ex.: link da mídia) devolvem o
        // contato para 'pendente'; recusa da uazapi vira 'falhou'.
        if (err instanceof UazapiRateLimitError || err instanceof ErroTransitorio) {
          if (err instanceof ErroTransitorio) console.error(`${log} falha passageira antes do envio`, { contaId, destId: dest.id, err })
          const { error: revErr } = await supabase.from('campanha_destinatarios')
            .update({ status: 'pendente', enviado_em: null }).eq('id', dest.id).eq('conta_id', contaId)
          if (revErr) console.error(`${log} não devolveu o contato para pendente — ficou "enviado" sem envio`, { contaId, destId: dest.id, revErr })
          return 'parar'
        }
        const { error: falhaErr } = await supabase.from('campanha_destinatarios')
          .update({ status: 'falhou', erro: String(err).slice(0, 500) }).eq('id', dest.id).eq('conta_id', contaId)
        if (falhaErr) console.error(`${log} não marcou o contato como falhou — ficou "enviado" sem envio`, { contaId, destId: dest.id, falhaErr })
        await atualizarTotais(supabase, contaId, c.id)
        return 'falhou'
      }
      // Parte da sequência já saiu: NUNCA volta para 'pendente' (reenviaria o começo).
      avisos.push(`Enviou ${feitos} de ${envios.length} mensagens: ${err instanceof Error ? err.message : String(err)}`)
      pararDepois = err instanceof UazapiRateLimitError
      break
    }
  }

  // ── Mensagem já saiu: daqui para baixo nada a devolve para 'pendente'.
  if (c.registrar_enviados) {
    const agora = new Date().toISOString()
    const { error } = await supabase.from('contatos_disparados').upsert(
      { conta_id: contaId, celular: dest.celular, nome: dest.nome, campanha_id: c.id, ultimo_envio_em: agora },
      { onConflict: 'conta_id,celular' },
    )
    if (error) console.error(`${log} registrar contato disparado falhou (mensagem já enviada)`, { contaId, destId: dest.id, error })
  }

  // Etiquetas: melhor esforço — nunca desfazem um envio, só viram aviso.
  for (const [acao, etiqueta] of [['remover', c.etiqueta_remover], ['adicionar', c.etiqueta_adicionar]] as const) {
    if (!etiqueta) continue
    try {
      await setChatLabel(token, dest.celular, acao, etiqueta)
    } catch (err) {
      avisos.push(`Não conseguiu ${acao} a etiqueta: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (avisos.length) {
    const { error } = await supabase.from('campanha_destinatarios')
      .update({ aviso: avisos.join(' · ').slice(0, 500) }).eq('id', dest.id).eq('conta_id', contaId)
    if (error) console.error(`${log} gravar aviso falhou`, { contaId, destId: dest.id, error })
  }
  await atualizarTotais(supabase, contaId, c.id)
  return pararDepois ? 'parar' : 'enviado'
}

/** Falha que não é recusa da mensagem (ex.: não conseguiu gerar o link da mídia). */
class ErroTransitorio extends Error {}

type Envio = { digitacaoMs: number; presenca: 'composing' | 'recording'; enviar: () => Promise<void> }

function montarEnvios(supabase: Supabase, token: string, c: Campanha, dest: Destinatario, digitacaoMs: number): Envio[] {
  const indice = dest.ordem ?? 0
  const passos = Array.isArray(c.passos) && c.passos.length ? c.passos : null

  if (!passos) {
    const texto = textoDaCampanha(c, dest)
    return [{ digitacaoMs, presenca: 'composing', enviar: () => sendText(token, dest.celular, texto) }]
  }

  return passos.map((p): Envio => {
    if (p.tipo === 'texto') {
      const texto = textoDoPasso(p, indice, dest.nome)
      return { digitacaoMs: p.digitacao_seg * 1000, presenca: 'composing', enviar: () => sendText(token, dest.celular, texto) }
    }
    return {
      digitacaoMs: p.digitacao_seg * 1000,
      presenca: p.tipo === 'audio' ? 'recording' : 'composing',
      enviar: async () => {
        const { data, error } = await supabase.storage.from(BUCKET_MIDIA).createSignedUrl(p.caminho, 60 * 60)
        if (error || !data?.signedUrl) throw new ErroTransitorio(`link da mídia: ${error?.message ?? 'sem URL'}`)
        const legenda = p.legenda ? montarTexto(p.legenda, [], indice, dest.nome) : null
        await sendMedia(token, dest.celular, TIPOS_MIDIA[p.tipo].uazapi, data.signedUrl, { legenda, nomeArquivo: p.nome_arquivo })
      },
    }
  })
}
async function atualizarTotais(supabase: Supabase, contaId: string, campanhaId: string): Promise<void> {
  const contar = (status: 'enviado' | 'falhou' | 'pulado') =>
    supabase.from('campanha_destinatarios').select('id', { count: 'exact', head: true })
      .eq('campanha_id', campanhaId).eq('conta_id', contaId).eq('status', status)
  const [env, fal, pul] = await Promise.all([contar('enviado'), contar('falhou'), contar('pulado')])
  const { error } = await supabase.from('campanhas_wa').update({
    total_enviados: env.count ?? 0, total_falhas: fal.count ?? 0, total_pulados: pul.count ?? 0,
  }).eq('id', campanhaId).eq('conta_id', contaId)
  if (error) console.error(`${log} atualizar totais falhou`, { contaId, campanhaId, error })
}

async function concluirSeAcabou(supabase: Supabase, contaId: string, campanhaId: string): Promise<void> {
  const { count, error } = await supabase.from('campanha_destinatarios')
    .select('id', { count: 'exact', head: true })
    .eq('campanha_id', campanhaId).eq('conta_id', contaId).eq('status', 'pendente')
  if (error || (count ?? 0) > 0) return
  await atualizarTotais(supabase, contaId, campanhaId)
  const { error: updErr } = await supabase.from('campanhas_wa')
    .update({ status: 'concluida', concluido_em: new Date().toISOString() })
    .eq('id', campanhaId).eq('conta_id', contaId).eq('status', 'enviando')
  if (updErr) console.error(`${log} concluir campanha falhou`, { contaId, campanhaId, updErr })
}
