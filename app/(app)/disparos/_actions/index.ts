'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getConta } from '@/lib/conta'
import { interpretarLista, minutosDoDia } from '@/lib/disparo/progressivo'

type Result = { error: string | null }
type Supabase = Awaited<ReturnType<typeof getConta>>['supabase']

const LOTE = 500

export async function criarCampanhaAction(
  _prev: { error: string | null; id?: string },
  formData: FormData,
): Promise<{ error: string | null; id?: string }> {
  try {
    const { supabase, contaId } = await getConta()

    const nome     = (formData.get('nome')      as string)?.trim()
    const modeloId = (formData.get('modelo_id') as string) || null

    if (!nome) return { error: 'Informe o nome da campanha.' }

    const { data, error } = await supabase
      .from('campanhas_wa')
      .insert({
        conta_id: contaId, nome, modelo_id: modeloId, status: 'rascunho',
        registrar_enviados:  formData.get('registrar_enviados') === 'on',
        excluir_ja_enviados: formData.get('excluir_ja_enviados') === 'on',
      })
      .select('id')
      .single()

    if (error) return { error: error.message }

    revalidatePath('/disparos')
    return { error: null, id: data.id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function adicionarDestinatariosAction(
  campanhaId: string,
  celulares: string[],
): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    // Valida que a campanha pertence à conta
    const { data: campanha } = await supabase
      .from('campanhas_wa')
      .select('id, status')
      .eq('id', campanhaId)
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!campanha) return { error: 'Campanha não encontrada.' }
    if (campanha.status !== 'rascunho') return { error: 'Só é possível editar campanhas em rascunho.' }

    // Busca clientes por celular para vincular cliente_id
    const celularesUnicos = [...new Set(celulares.map(c => c.replace(/\D/g, '').trim()).filter(Boolean))]

    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, celular, nome')
      .eq('conta_id', contaId)
      .in('celular', celularesUnicos)

    const clienteMap = new Map(clientes?.map(c => [c.celular, c]) ?? [])

    const destinatarios = celularesUnicos.map((celular, ordem) => ({
      campanha_id: campanhaId,
      conta_id:    contaId,
      celular,
      ordem,
      nome:        clienteMap.get(celular)?.nome ?? null,
      cliente_id:  clienteMap.get(celular)?.id ?? null,
      status:      'pendente' as const,
    }))

    const { error: insErr } = await supabase
      .from('campanha_destinatarios')
      .insert(destinatarios)

    if (insErr) return { error: insErr.message }

    // Atualiza contador
    await supabase
      .from('campanhas_wa')
      .update({ total_destinatarios: celularesUnicos.length })
      .eq('id', campanhaId)
      .eq('conta_id', contaId)

    revalidatePath('/disparos')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

async function whatsappConectado(supabase: Supabase, contaId: string): Promise<boolean> {
  const { data: conexao } = await supabase
    .from('conexoes')
    .select('uazapi_instance_token, status')
    .eq('conta_id', contaId)
    .maybeSingle()
  return !!conexao?.uazapi_instance_token && conexao.status === 'conectado'
}

/**
 * "Não enviar para quem já recebeu": marca como 'pulado', já na largada, todo contato da
 * campanha que está em contatos_disparados (o cron confere de novo antes de cada envio, para
 * quem receber de outro disparo no meio do caminho). Devolve quantos foram pulados.
 */
async function pularJaDisparados(supabase: Supabase, contaId: string, campanhaId: string): Promise<number | null> {
  const { data: dests, error } = await supabase
    .from('campanha_destinatarios')
    .select('celular')
    .eq('campanha_id', campanhaId)
    .eq('conta_id', contaId)
    .eq('status', 'pendente')
    .range(0, 9999)
  if (error) {
    console.error('[disparos] leitura dos contatos para pular falhou', { contaId, campanhaId, error })
    return null
  }

  const celulares = (dests ?? []).map(d => d.celular)
  let pulados = 0
  for (let i = 0; i < celulares.length; i += LOTE) {
    const lote = celulares.slice(i, i + LOTE)
    const { data: ja, error: jaErr } = await supabase
      .from('contatos_disparados').select('celular').eq('conta_id', contaId).in('celular', lote)
    if (jaErr) {
      console.error('[disparos] checagem de já disparados falhou', { contaId, campanhaId, jaErr })
      return null
    }
    const repetidos = (ja ?? []).map(j => j.celular)
    if (!repetidos.length) continue
    const { error: updErr } = await supabase
      .from('campanha_destinatarios')
      .update({ status: 'pulado', erro: 'Já recebeu um disparo antes' })
      .eq('campanha_id', campanhaId)
      .eq('conta_id', contaId)
      .eq('status', 'pendente')
      .in('celular', repetidos)
    if (updErr) {
      console.error('[disparos] marcar pulados falhou', { contaId, campanhaId, updErr })
      return null
    }
    pulados += repetidos.length
  }

  const { error: totErr } = await supabase
    .from('campanhas_wa').update({ total_pulados: pulados }).eq('id', campanhaId).eq('conta_id', contaId)
  if (totErr) console.error('[disparos] gravar total de pulados falhou', { contaId, campanhaId, totErr })
  return pulados
}

// Só marca a campanha como 'enviando' — quem processa de verdade é o cron
// /api/cron/whatsapp-uazapi (a cada 1min), respeitando o ritmo anti-ban
// (intervalo 45-80s configurado + 15-20s de simulação de digitação por
// envio). Um clique não dispara mais um loop síncrono aqui: com esse ritmo,
// qualquer campanha um pouco maior estouraria o tempo de execução da Vercel
// e ficaria pela metade. A campanha continua sendo drenada mesmo se esta
// tela for fechada — o progresso aparece pelos totais em campanhas_wa.
export async function enviarCampanhaAction(campanhaId: string): Promise<{
  error: string | null
}> {
  try {
    const { supabase, contaId } = await getConta()

    const { data: campanha } = await supabase
      .from('campanhas_wa')
      .select('id, status, modelo_id, total_destinatarios, excluir_ja_enviados, modelos_wa(corpo, status)')
      .eq('id', campanhaId)
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!campanha) return { error: 'Campanha não encontrada.' }
    if (!['rascunho', 'agendada'].includes(campanha.status)) {
      return { error: 'Campanha já foi enviada ou está em andamento.' }
    }

    const modelo = (campanha as any).modelos_wa
    if (!modelo?.corpo) return { error: 'Selecione um template antes de enviar.' }

    if (!campanha.total_destinatarios) return { error: 'Nenhum destinatário cadastrado.' }

    if (!(await whatsappConectado(supabase, contaId))) {
      return { error: 'WhatsApp não está conectado. Verifique a conexão.' }
    }

    if (campanha.excluir_ja_enviados && (await pularJaDisparados(supabase, contaId, campanhaId)) === null) {
      return { error: 'Não foi possível conferir quem já recebeu. Tente de novo.' }
    }

    await supabase
      .from('campanhas_wa')
      .update({ status: 'enviando', iniciado_em: new Date().toISOString() })
      .eq('id', campanhaId)
      .eq('conta_id', contaId)

    revalidatePath('/disparos')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// ── Disparo progressivo ───────────────────────────────────────────────────────

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.')

const schemaProgressivo = z.object({
  nome:        z.string().trim().min(1, 'Informe o nome do disparo.').max(80),
  mensagem:    z.string().trim().min(1, 'Escreva a mensagem.').max(4000),
  variacoes:   z.array(z.string().trim().max(4000)).max(5),
  lista:       z.string().max(400_000),
  janelaInicio: hora,
  janelaFim:    hora,
  inicio:      z.number().int().min(1, 'Comece com pelo menos 1 envio por dia.').max(200),
  maximo:      z.number().int().min(1).max(200, 'O máximo é 200 envios por dia.'),
  registrarEnviados: z.boolean(),
  excluirJaEnviados: z.boolean(),
})
  .refine(d => d.maximo >= d.inicio, { message: 'O máximo por dia precisa ser maior ou igual ao início.' })
  .refine(d => minutosDoDia(d.janelaFim) - minutosDoDia(d.janelaInicio) >= 30, { message: 'A janela de horário precisa ter pelo menos 30 minutos.' })

export type NovoProgressivo = z.input<typeof schemaProgressivo>

export async function criarProgressivoAction(input: NovoProgressivo): Promise<{ error: string | null; pulados?: number }> {
  try {
    const parsed = schemaProgressivo.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
    const d = parsed.data

    const { contatos } = interpretarLista(d.lista)
    if (!contatos.length) return { error: 'Cole pelo menos um número válido na lista.' }
    if (contatos.length > 10_000) return { error: 'A lista pode ter no máximo 10.000 números.' }

    const { supabase, contaId } = await getConta()
    if (!(await whatsappConectado(supabase, contaId))) {
      return { error: 'WhatsApp não está conectado. Conecte em Conexão WA antes de iniciar.' }
    }

    const { data: campanha, error: insErr } = await supabase
      .from('campanhas_wa')
      .insert({
        conta_id: contaId,
        nome: d.nome,
        tipo: 'progressivo',
        status: 'rascunho',
        mensagem: d.mensagem,
        variacoes: d.variacoes.filter(Boolean),
        janela_inicio: d.janelaInicio,
        janela_fim: d.janelaFim,
        prog_inicio: d.inicio,
        prog_maximo: d.maximo,
        registrar_enviados: d.registrarEnviados,
        excluir_ja_enviados: d.excluirJaEnviados,
        total_destinatarios: contatos.length,
      })
      .select('id')
      .single()
    if (insErr || !campanha) {
      console.error('[disparos] criar progressivo falhou', { contaId, insErr })
      return { error: 'Não foi possível criar o disparo. Tente de novo.' }
    }

    // Lista em lotes; qualquer falha desfaz a campanha inteira (os contatos caem junto, cascade).
    for (let i = 0; i < contatos.length; i += LOTE) {
      const lote = contatos.slice(i, i + LOTE).map((c, j) => ({
        campanha_id: campanha.id, conta_id: contaId, celular: c.celular, nome: c.nome, ordem: i + j, status: 'pendente' as const,
      }))
      const { error } = await supabase.from('campanha_destinatarios').insert(lote)
      if (error) {
        console.error('[disparos] gravar lista do progressivo falhou', { contaId, campanhaId: campanha.id, error })
        await supabase.from('campanhas_wa').delete().eq('id', campanha.id).eq('conta_id', contaId)
        return { error: 'Não foi possível salvar a lista. Nada foi enviado — tente de novo.' }
      }
    }

    let pulados = 0
    if (d.excluirJaEnviados) {
      const r = await pularJaDisparados(supabase, contaId, campanha.id)
      if (r === null) {
        await supabase.from('campanhas_wa').delete().eq('id', campanha.id).eq('conta_id', contaId)
        return { error: 'Não foi possível conferir quem já recebeu. Nada foi enviado — tente de novo.' }
      }
      pulados = r
    }

    const { error: iniErr } = await supabase
      .from('campanhas_wa')
      .update({ status: 'enviando', iniciado_em: new Date().toISOString() })
      .eq('id', campanha.id)
      .eq('conta_id', contaId)
    if (iniErr) {
      console.error('[disparos] iniciar progressivo falhou', { contaId, campanhaId: campanha.id, iniErr })
      return { error: 'O disparo foi salvo como rascunho, mas não iniciou. Tente de novo.' }
    }

    revalidatePath('/disparos')
    return { error: null, pulados }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// ── Pausar / retomar / cancelar ───────────────────────────────────────────────

type StatusCampanha = 'rascunho' | 'agendada' | 'enviando' | 'pausada' | 'cancelada'

async function mudarStatus(campanhaId: string, de: StatusCampanha[], para: 'pausada' | 'enviando' | 'cancelada'): Promise<Result> {
  if (!z.string().uuid().safeParse(campanhaId).success) return { error: 'Campanha inválida.' }
  try {
    const { supabase, contaId } = await getConta()
    const { data, error } = await supabase
      .from('campanhas_wa')
      .update({ status: para })
      .eq('id', campanhaId)
      .eq('conta_id', contaId)
      .in('status', de)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[disparos] mudar status falhou', { contaId, campanhaId, para, error })
      return { error: 'Não foi possível atualizar o disparo. Tente de novo.' }
    }
    if (!data) return { error: 'Este disparo não pode mais ser alterado.' }

    revalidatePath('/disparos')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function pausarCampanhaAction(campanhaId: string): Promise<Result> {
  return mudarStatus(campanhaId, ['enviando'], 'pausada')
}

export async function retomarCampanhaAction(campanhaId: string): Promise<Result> {
  return mudarStatus(campanhaId, ['pausada'], 'enviando')
}

export async function cancelarCampanhaAction(campanhaId: string): Promise<Result> {
  return mudarStatus(campanhaId, ['rascunho', 'agendada', 'enviando', 'pausada'], 'cancelada')
}
