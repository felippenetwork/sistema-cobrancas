'use server'

// Chatbot (/chatbot): fluxos, recebimento de mensagens (webhook da uazapi) e os contatos do robô.
// Regras do robô em lib/chatbot/fluxo.ts; quem responde as mensagens é lib/chatbot/processar.ts.

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getConta } from '@/lib/conta'
import { createAdminClient } from '@/lib/supabase/admin'
import { setWebhook, UazapiRateLimitError } from '@/lib/uazapi'
import { schemaEtapas } from '@/lib/chatbot/fluxo'
import { urlDoWebhook } from '@/lib/chatbot/url'
import { pastaDaConta } from '@/lib/disparo/passos'
import { normalizarCelular } from '@/lib/disparo/progressivo'

type Result = { error: string | null; id?: string }

const uuid = z.string().uuid()
const etiqueta = z.object({ id: z.string().min(1).max(100), nome: z.string().max(100) })
const palavras = z.array(z.string().trim().min(1).max(40)).max(20)

const schemaFluxo = z.object({
  nome:            z.string().trim().min(1, 'Informe o nome do fluxo.').max(80),
  ativo:           z.boolean(),
  etapas:          schemaEtapas,
  gatilhoPalavras: palavras,
  gatilhoEtiquetas: z.array(etiqueta).max(20),
  excluirEtiquetas: z.array(etiqueta).max(20),
  palavrasHumano:  palavras,
  msgNaoEntendi:   z.string().trim().min(1, 'Escreva a mensagem de "não entendi".').max(1000),
  msgHumano:       z.string().trim().min(1, 'Escreva a mensagem de quando a pessoa pede atendimento.').max(1000),
  avisoNumero:     z.string().max(30),
})

export type FluxoEntrada = z.input<typeof schemaFluxo>

/** Valida e monta as colunas do fluxo; mídia só da pasta desta conta. */
function colunasDoFluxo(input: FluxoEntrada, contaId: string) {
  const parsed = schemaFluxo.safeParse(input)
  if (!parsed.success) return { erro: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  const d = parsed.data
  if (d.etapas.some(e => e.passos.some(p => p.tipo !== 'texto' && !p.caminho.startsWith(pastaDaConta(contaId))))) {
    return { erro: 'Arquivo de mídia inválido. Envie o arquivo de novo.' }
  }
  const aviso = d.avisoNumero.trim() ? normalizarCelular(d.avisoNumero) : null
  if (d.avisoNumero.trim() && !aviso) return { erro: 'Número para aviso inválido. Use DDD + número, ex.: 21 99999-0000.' }
  const unicas = (l: string[]) => [...new Set(l.map(p => p.toLowerCase()))]
  return {
    colunas: {
      nome: d.nome,
      ativo: d.ativo,
      etapas: d.etapas.map(e => ({
        ...e,
        passos: e.passos.map(p => (p.tipo === 'texto' ? { ...p, variacoes: p.variacoes.filter(Boolean) } : p)),
      })),
      gatilho_palavras: unicas(d.gatilhoPalavras),
      gatilho_etiquetas: d.gatilhoEtiquetas.map(x => x.id),
      gatilho_etiquetas_nomes: d.gatilhoEtiquetas.map(x => x.nome),
      excluir_etiquetas: d.excluirEtiquetas.map(x => x.id),
      excluir_etiquetas_nomes: d.excluirEtiquetas.map(x => x.nome),
      palavras_humano: unicas(d.palavrasHumano),
      msg_nao_entendi: d.msgNaoEntendi,
      msg_humano: d.msgHumano,
      aviso_numero: aviso,
    },
  }
}

export async function salvarFluxoAction(fluxoId: string | null, input: FluxoEntrada): Promise<Result> {
  if (fluxoId !== null && !uuid.safeParse(fluxoId).success) return { error: 'Fluxo inválido.' }
  try {
    const { supabase, contaId } = await getConta()
    const r = colunasDoFluxo(input, contaId)
    if ('erro' in r) return { error: r.erro ?? 'Dados inválidos.' }

    if (fluxoId === null) {
      const { data, error } = await supabase.from('bot_fluxos').insert({ conta_id: contaId, ...r.colunas }).select('id').single()
      if (error) {
        console.error('[chatbot] criar fluxo falhou', { contaId, error })
        return { error: 'Não foi possível criar o fluxo. Tente de novo.' }
      }
      revalidatePath('/chatbot')
      return { error: null, id: data.id }
    }

    const { data, error } = await supabase.from('bot_fluxos')
      .update({ ...r.colunas, atualizado_em: new Date().toISOString() })
      .eq('id', fluxoId).eq('conta_id', contaId)
      .select('id').maybeSingle()
    if (error) {
      console.error('[chatbot] salvar fluxo falhou', { contaId, fluxoId, error })
      return { error: 'Não foi possível salvar o fluxo. Tente de novo.' }
    }
    if (!data) return { error: 'Fluxo não encontrado.' }
    revalidatePath('/chatbot')
    revalidatePath(`/chatbot/${fluxoId}`)
    return { error: null, id: fluxoId }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function alternarFluxoAction(fluxoId: string, ativo: boolean): Promise<Result> {
  if (!uuid.safeParse(fluxoId).success) return { error: 'Fluxo inválido.' }
  try {
    const { supabase, contaId } = await getConta()
    const { data, error } = await supabase.from('bot_fluxos')
      .update({ ativo, atualizado_em: new Date().toISOString() })
      .eq('id', fluxoId).eq('conta_id', contaId).select('id').maybeSingle()
    if (error) {
      console.error('[chatbot] ligar/desligar fluxo falhou', { contaId, fluxoId, error })
      return { error: 'Não foi possível atualizar o fluxo. Tente de novo.' }
    }
    if (!data) return { error: 'Fluxo não encontrado.' }
    revalidatePath('/chatbot')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function excluirFluxoAction(fluxoId: string): Promise<Result> {
  if (!uuid.safeParse(fluxoId).success) return { error: 'Fluxo inválido.' }
  try {
    const { supabase, contaId } = await getConta()
    const { error } = await supabase.from('bot_fluxos').delete().eq('id', fluxoId).eq('conta_id', contaId)
    if (error) {
      console.error('[chatbot] excluir fluxo falhou', { contaId, fluxoId, error })
      return { error: 'Não foi possível excluir o fluxo. Tente de novo.' }
    }
    revalidatePath('/chatbot')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

/**
 * Liga o recebimento de mensagens: cria o segredo da conta (uma vez) e aponta o webhook da
 * instância para o sistema. Token lido com service role DEPOIS de getConta().
 */
export async function ativarRecebimentoAction(): Promise<Result> {
  try {
    const { contaId } = await getConta()
    const admin = createAdminClient()
    const { data: cx, error } = await admin.from('conexoes')
      .select('uazapi_instance_token, status, webhook_segredo').eq('conta_id', contaId).maybeSingle()
    if (error) {
      console.error('[chatbot] leitura da conexão falhou', { contaId, error })
      return { error: 'Não foi possível ler a conexão do WhatsApp. Tente de novo.' }
    }
    if (!cx?.uazapi_instance_token || cx.status !== 'conectado') return { error: 'Conecte o WhatsApp em Conexão WA antes de ligar o robô.' }

    const segredo = cx.webhook_segredo ?? randomBytes(32).toString('hex')
    const url = urlDoWebhook(contaId, segredo)
    if (!url) {
      console.error('[chatbot] NEXT_PUBLIC_SITE_URL ausente: não dá para montar a URL do webhook', { contaId })
      return { error: 'O endereço do sistema não está configurado. Avise o suporte.' }
    }
    if (!cx.webhook_segredo) {
      const { error: updErr } = await admin.from('conexoes').update({ webhook_segredo: segredo }).eq('conta_id', contaId)
      if (updErr) {
        console.error('[chatbot] gravar segredo do webhook falhou', { contaId, updErr })
        return { error: 'Não foi possível ligar o robô. Tente de novo.' }
      }
    }
    await setWebhook(cx.uazapi_instance_token, url)
    revalidatePath('/chatbot')
    return { error: null }
  } catch (e) {
    console.error('[chatbot] ativar recebimento falhou', e)
    return { error: e instanceof UazapiRateLimitError ? 'O WhatsApp está limitando as chamadas agora. Aguarde um minuto e tente de novo.' : 'Não foi possível ligar o robô no WhatsApp. Tente de novo.' }
  }
}

// ── Contatos do robô ──────────────────────────────────────────────────────────

const schemaAcao = z.enum(['retomar', 'pausar', 'encerrar', 'permitir'])

/**
 * retomar  → o robô volta a responder (na etapa em que estava, ou espera um gatilho)
 * pausar   → robô parado para este contato (humano atende)
 * encerrar → sai do fluxo; volta a entrar só por gatilho
 * permitir → quem pediu SAIR volta a poder receber robô e disparos
 */
export async function mudarConversaAction(conversaId: string, acao: z.infer<typeof schemaAcao>): Promise<Result> {
  if (!uuid.safeParse(conversaId).success || !schemaAcao.safeParse(acao).success) return { error: 'Pedido inválido.' }
  try {
    const { supabase, contaId } = await getConta()
    const { data: c, error: lerErr } = await supabase.from('bot_conversas')
      .select('id, status, etapa_id').eq('id', conversaId).eq('conta_id', contaId).maybeSingle()
    if (lerErr) {
      console.error('[chatbot] leitura da conversa falhou', { contaId, conversaId, lerErr })
      return { error: 'Não foi possível atualizar o contato. Tente de novo.' }
    }
    if (!c) return { error: 'Contato não encontrado.' }

    const agora = new Date().toISOString()
    const patch =
      acao === 'pausar'   ? { status: 'humano' as const } :
      acao === 'retomar'  ? { status: c.etapa_id ? 'ativa' as const : 'encerrada' as const, nao_entendi: 0 } :
                            { status: 'encerrada' as const, etapa_id: null, nao_entendi: 0 }
    const { error } = await supabase.from('bot_conversas')
      .update({ ...patch, ocupado_ate: null, atualizado_em: agora })
      .eq('id', conversaId).eq('conta_id', contaId)
    if (error) {
      console.error('[chatbot] mudar conversa falhou', { contaId, conversaId, acao, error })
      return { error: 'Não foi possível atualizar o contato. Tente de novo.' }
    }
    const evento = { pausar: 'Robô pausado por você.', retomar: 'Robô devolvido por você.', encerrar: 'Conversa encerrada por você.', permitir: 'Você liberou este contato para receber mensagens de novo.' }[acao]
    await supabase.from('bot_mensagens').insert({ conta_id: contaId, conversa_id: conversaId, direcao: 'evento', texto: evento })
    revalidatePath('/chatbot')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export type MensagemHistorico = { id: string; direcao: 'recebida' | 'enviada' | 'evento'; texto: string; criado_em: string }

export async function historicoAction(conversaId: string): Promise<{ error: string | null; mensagens?: MensagemHistorico[] }> {
  if (!uuid.safeParse(conversaId).success) return { error: 'Contato inválido.' }
  try {
    const { supabase, contaId } = await getConta()
    const { data, error } = await supabase.from('bot_mensagens')
      .select('id, direcao, texto, criado_em')
      .eq('conversa_id', conversaId).eq('conta_id', contaId)
      .order('criado_em', { ascending: false })
      .limit(200)
    if (error) {
      console.error('[chatbot] leitura do histórico falhou', { contaId, conversaId, error })
      return { error: 'Não foi possível carregar o histórico. Tente de novo.' }
    }
    return { error: null, mensagens: (data ?? []).reverse() }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
