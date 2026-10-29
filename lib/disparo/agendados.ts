// Envios agendados para UMA pessoa (/agendamentos, tabela envios_agendados): "o cliente pediu
// para eu lembrar ele tal hora". Chamado pelo cron /api/cron/whatsapp-uazapi ANTES dos lembretes
// da conta, porque tem hora marcada.
//
// - Sai na hora escolhida pelo dono, a qualquer hora do dia (ele marcou a hora; não passa pela
//   janela 09–20h, igual às mensagens avulsas antigas).
// - Mesma sequência de caixinhas dos modelos (texto/mídia/ação, lib/disparo/passos.ts), com
//   {{nome}} e {{periododia}} pela hora em que sai.
// - WhatsApp desconectado na hora: sai quando voltar, até ATRASO_MAXIMO_MS depois. Mais que isso,
//   vira 'falhou' — um "lembra de mim às 15h" chegando no dia seguinte faz mais mal do que bem.
// - Mesmas invariantes do disparo: claim atômico pendente → enviado antes de mandar; rate limit
//   ou falha passageira antes de qualquer mensagem sair devolvem para 'pendente'; depois que
//   algo saiu, nada devolve para 'pendente'. Entre dois agendados seguidos, o intervalo anti-ban.
import { createAdminClient } from '@/lib/supabase/admin'
import { UazapiRateLimitError } from '@/lib/uazapi'
import { duracaoSequenciaMs, schemaPassos } from './passos'
import { enviarSequencia, enviosDosPassos, ErroTransitorio } from './envio-passos'
import type { JanelaConta } from './campanhas'

type Supabase = ReturnType<typeof createAdminClient>

export const ATRASO_MAXIMO_MS = 6 * 60 * 60_000

const log = '[disparo/agendados]'
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

type Agendado = { id: string; celular: string; nome: string | null; passos: unknown; agendado_para: string }

type Resultado = 'enviado' | 'falhou' | 'ocupado' | 'parar'

export async function processarAgendados(
  supabase: Supabase,
  contaId: string,
  token: string,
  cfg: JanelaConta,
  inicioExecucao: number,
  budgetMs: number,
): Promise<{ enviados: number; pararConta: boolean }> {
  const intMin = (cfg?.intervalo_min_seg ?? 45) * 1000
  const intMax = Math.max((cfg?.intervalo_max_seg ?? 80) * 1000, intMin)

  let enviados = 0
  let tentou = false
  while (Date.now() - inicioExecucao < budgetMs) {
    const { data, error } = await supabase
      .from('envios_agendados')
      .select('id, celular, nome, passos, agendado_para')
      .eq('conta_id', contaId)
      .eq('status', 'pendente')
      .lte('agendado_para', new Date().toISOString())
      .order('agendado_para', { ascending: true })
      .limit(1)
    if (error) {
      console.error(`${log} leitura da fila falhou`, { contaId, error })
      return { enviados, pararConta: false }
    }
    const ag = data?.[0] as Agendado | undefined
    if (!ag) break

    if (Date.now() - new Date(ag.agendado_para).getTime() > ATRASO_MAXIMO_MS) {
      await marcar(supabase, contaId, ag.id, { status: 'falhou', erro: 'Não saiu na hora marcada: o WhatsApp estava desconectado.' }, undefined, true)
      continue
    }

    const passos = schemaPassos.safeParse(ag.passos)
    if (!passos.success || !passos.data.length) {
      await marcar(supabase, contaId, ag.id, { status: 'falhou', erro: 'Mensagem inválida.' }, undefined, true)
      continue
    }

    // Ritmo anti-ban entre dois envios seguidos; a sequência inteira tem de caber nesta execução.
    const pausa = tentou ? intMin + Math.floor(Math.random() * (intMax - intMin + 1)) : 0
    if (Date.now() - inicioExecucao + pausa + duracaoSequenciaMs(passos.data) > budgetMs) break
    if (pausa) await sleep(pausa)

    const r = await enviarAgendado(supabase, contaId, token, ag, passos.data)
    if (r === 'parar') return { enviados, pararConta: true }
    if (r === 'enviado') enviados++
    if (r !== 'ocupado') tentou = true
  }
  return { enviados, pararConta: false }
}

async function enviarAgendado(
  supabase: Supabase,
  contaId: string,
  token: string,
  ag: Agendado,
  passos: ReturnType<typeof schemaPassos.parse>,
): Promise<Resultado> {
  // Claim atômico: só uma execução leva este envio (cancelado na tela no meio do caminho não sai).
  const { data: claimed, error: claimErr } = await supabase
    .from('envios_agendados')
    .update({ status: 'enviado', enviado_em: new Date().toISOString() })
    .eq('id', ag.id)
    .eq('conta_id', contaId)
    .eq('status', 'pendente')
    .select('id')
    .maybeSingle()
  if (claimErr) {
    console.error(`${log} claim falhou`, { contaId, agendadoId: ag.id, claimErr })
    return 'parar'
  }
  if (!claimed) return 'ocupado'

  const seq = await enviarSequencia(token, ag.celular, enviosDosPassos(supabase, token, ag.celular, passos, { indice: 0, nome: ag.nome }))
  const avisos = [...seq.avisos]
  let resultado: Resultado = 'enviado'

  if (seq.falha) {
    const err = seq.falha.erro
    if (seq.feitos === 0) {
      if (err instanceof UazapiRateLimitError || err instanceof ErroTransitorio) {
        if (err instanceof ErroTransitorio) console.error(`${log} falha passageira antes do envio`, { contaId, agendadoId: ag.id, err })
        await marcar(supabase, contaId, ag.id, { status: 'pendente', enviado_em: null }, 'não voltou para pendente — ficou "enviado" sem envio')
        return 'parar'
      }
      await marcar(supabase, contaId, ag.id, { status: 'falhou', enviado_em: null, erro: String(err).slice(0, 500) }, 'não marcou falhou — ficou "enviado" sem envio')
      return 'falhou'
    }
    // Parte da sequência já saiu: NUNCA volta para 'pendente' (reenviaria o começo).
    avisos.push(`Enviou ${seq.feitos} de ${seq.total} mensagens: ${err instanceof Error ? err.message : String(err)}`)
    if (err instanceof UazapiRateLimitError) resultado = 'parar'
  }

  if (avisos.length) await marcar(supabase, contaId, ag.id, { aviso: avisos.join(' · ').slice(0, 500) })
  return resultado
}

async function marcar(
  supabase: Supabase,
  contaId: string,
  id: string,
  patch: { status?: 'pendente' | 'falhou'; enviado_em?: null; erro?: string; aviso?: string },
  contexto = 'gravar situação falhou',
  /** Só se ainda estiver pendente (antes do claim: pode ter sido cancelado na tela). */
  soPendente = false,
): Promise<void> {
  let q = supabase.from('envios_agendados').update(patch).eq('id', id).eq('conta_id', contaId)
  if (soPendente) q = q.eq('status', 'pendente')
  const { error } = await q
  if (error) console.error(`${log} ${contexto}`, { contaId, agendadoId: id, error })
}
