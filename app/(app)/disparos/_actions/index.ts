'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { getConta } from '@/lib/conta'
import { createAdminClient } from '@/lib/supabase/admin'
import { interpretarLista, minutosDoDia } from '@/lib/disparo/progressivo'
import { BUCKET_MIDIA, TAMANHO_MAX_MIDIA, TIPOS_MIDIA, pastaDaConta, passosDoModelo, type Passo, type TipoMidia } from '@/lib/disparo/passos'
import { extrairContatos, paraLinhas, resumirGrupos, type PreferenciaNome, type ResumoGrupo } from '@/lib/disparo/extracao'
import { listGroups, listLabels, listSavedContacts, UazapiRateLimitError, type UazapiEtiqueta } from '@/lib/uazapi'

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
    const modeloId = (formData.get('modelo_id') as string) || ''

    if (!nome) return { error: 'Informe o nome da campanha.' }
    const seq = await sequenciaDoModelo(supabase, contaId, modeloId)
    if ('erro' in seq) return { error: seq.erro }
    const fluxo = await fluxoDaConta(supabase, contaId, (formData.get('fluxo_id') as string) || null)
    if (typeof fluxo === 'object' && fluxo !== null) return { error: fluxo.erro }

    const { data, error } = await supabase
      .from('campanhas_wa')
      .insert({
        conta_id: contaId, nome, modelo_id: modeloId, status: 'rascunho', passos: seq.passos, fluxo_id: fluxo,
        registrar_enviados:  formData.get('registrar_enviados') === 'on',
        excluir_ja_enviados: formData.get('excluir_ja_enviados') === 'on',
        ...etiquetasDoForm(formData),
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

/**
 * Sequência do modelo escolhido, COPIADA para o disparo (editar o modelo depois não muda um
 * disparo em andamento). Modelo de outra conta responde "não encontrado".
 */
async function sequenciaDoModelo(supabase: Supabase, contaId: string, modeloId: string): Promise<{ passos: Passo[] } | { erro: string }> {
  if (!z.string().uuid().safeParse(modeloId).success) return { erro: 'Escolha um modelo para o disparo.' }
  const { data, error } = await supabase
    .from('modelos_wa').select('passos, corpo').eq('id', modeloId).eq('conta_id', contaId).maybeSingle()
  if (error) {
    console.error('[disparos] leitura do modelo falhou', { contaId, modeloId, error })
    return { erro: 'Não foi possível ler o modelo. Tente de novo.' }
  }
  if (!data) return { erro: 'Modelo não encontrado.' }
  const passos = passosDoModelo(data)
  if (!passos) return { erro: 'Este modelo está sem mensagem. Edite o modelo antes de disparar.' }
  // Mídia só da pasta desta conta: nunca aceitar caminho de arquivo de outra conta.
  if (passos.some(p => p.tipo !== 'texto' && !p.caminho.startsWith(pastaDaConta(contaId)))) {
    return { erro: 'Arquivo de mídia inválido no modelo. Envie o arquivo de novo no modelo.' }
  }
  return { passos }
}

/** Fluxo do chatbot escolhido para quem responder (opcional): tem de ser desta conta. */
async function fluxoDaConta(supabase: Supabase, contaId: string, fluxoId: string | null): Promise<string | null | { erro: string }> {
  if (!fluxoId) return null
  if (!z.string().uuid().safeParse(fluxoId).success) return { erro: 'Fluxo do chatbot inválido.' }
  const { data, error } = await supabase.from('bot_fluxos').select('id').eq('id', fluxoId).eq('conta_id', contaId).maybeSingle()
  if (error) {
    console.error('[disparos] leitura do fluxo falhou', { contaId, fluxoId, error })
    return { erro: 'Não foi possível ler o fluxo do chatbot. Tente de novo.' }
  }
  return data ? data.id : { erro: 'Fluxo do chatbot não encontrado.' }
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
      .select('id, status, total_destinatarios, excluir_ja_enviados, passos, modelos_wa(corpo)')
      .eq('id', campanhaId)
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!campanha) return { error: 'Campanha não encontrada.' }
    if (!['rascunho', 'agendada'].includes(campanha.status)) {
      return { error: 'Campanha já foi enviada ou está em andamento.' }
    }

    const modelo = campanha.modelos_wa as { corpo: string | null } | null
    if (!campanha.passos && !modelo?.corpo) return { error: 'Escolha um modelo antes de enviar.' }

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

const etiqueta = z.object({ id: z.string().min(1).max(100), nome: z.string().max(100) }).nullable()

const schemaProgressivo = z.object({
  nome:        z.string().trim().min(1, 'Informe o nome do disparo.').max(80),
  modeloId:    z.string(),
  fluxoId:     z.string().nullable().default(null),
  etiquetaAdicionar: etiqueta,
  etiquetaRemover:   etiqueta,
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
    const seq = await sequenciaDoModelo(supabase, contaId, d.modeloId)
    if ('erro' in seq) return { error: seq.erro }
    const fluxo = await fluxoDaConta(supabase, contaId, d.fluxoId)
    if (typeof fluxo === 'object' && fluxo !== null) return { error: fluxo.erro }
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
        modelo_id: d.modeloId,
        passos: seq.passos,
        fluxo_id: fluxo,
        etiqueta_adicionar:      d.etiquetaAdicionar?.id ?? null,
        etiqueta_adicionar_nome: d.etiquetaAdicionar?.nome ?? null,
        etiqueta_remover:        d.etiquetaRemover?.id ?? null,
        etiqueta_remover_nome:   d.etiquetaRemover?.nome ?? null,
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

// ── Etiquetas, grupos e mídia (uazapi / storage) ──────────────────────────────

function etiquetasDoForm(formData: FormData) {
  const valor = (campo: string) => ((formData.get(campo) as string | null) ?? '').trim().slice(0, 100) || null
  return {
    etiqueta_adicionar: valor('etiqueta_adicionar'), etiqueta_adicionar_nome: valor('etiqueta_adicionar_nome'),
    etiqueta_remover:   valor('etiqueta_remover'),   etiqueta_remover_nome:   valor('etiqueta_remover_nome'),
  }
}

/** Token e número da instância da conta — lidos com service role DEPOIS de getConta(). */
async function instanciaDaConta(): Promise<{ contaId: string; token: string; numero: string | null } | { erro: string }> {
  const { contaId } = await getConta()
  const { data, error } = await createAdminClient()
    .from('conexoes').select('uazapi_instance_token, status, numero_conectado').eq('conta_id', contaId).maybeSingle()
  if (error) {
    console.error('[disparos] leitura da conexão falhou', { contaId, error })
    return { erro: 'Não foi possível ler a conexão do WhatsApp. Tente de novo.' }
  }
  if (!data?.uazapi_instance_token || data.status !== 'conectado') return { erro: 'WhatsApp não está conectado. Conecte em Conexão WA.' }
  return { contaId, token: data.uazapi_instance_token, numero: data.numero_conectado }
}

function mensagemUazapi(err: unknown, padrao: string): string {
  if (err instanceof UazapiRateLimitError) return 'O WhatsApp está limitando as consultas agora. Aguarde um minuto e tente de novo.'
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'O WhatsApp demorou demais para responder. Tente de novo.'
  return padrao
}

export async function listarEtiquetasAction(): Promise<{ error: string | null; etiquetas?: UazapiEtiqueta[] }> {
  try {
    const inst = await instanciaDaConta()
    if ('erro' in inst) return { error: inst.erro }
    const etiquetas = await listLabels(inst.token)
    return { error: null, etiquetas: etiquetas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) }
  } catch (e) {
    console.error('[disparos] listar etiquetas falhou', e)
    return { error: mensagemUazapi(e, 'Não foi possível buscar as etiquetas. Elas só existem no WhatsApp Business.') }
  }
}

export async function listarGruposAction(): Promise<{ error: string | null; grupos?: ResumoGrupo[] }> {
  try {
    const inst = await instanciaDaConta()
    if ('erro' in inst) return { error: inst.erro }
    return { error: null, grupos: resumirGrupos(await listGroups(inst.token)) }
  } catch (e) {
    console.error('[disparos] listar grupos falhou', e)
    return { error: mensagemUazapi(e, 'Não foi possível buscar os grupos. Tente de novo.') }
  }
}

export async function importarGrupoAction(input: { jid: string; preferencia: PreferenciaNome }): Promise<{
  error: string | null; linhas?: string; total?: number; semTelefone?: number; semNome?: number; agendaIndisponivel?: boolean
}> {
  const parsed = z.object({ jid: z.string().endsWith('@g.us').max(100), preferencia: z.enum(['whatsapp', 'agenda']) }).safeParse(input)
  if (!parsed.success) return { error: 'Grupo inválido.' }
  try {
    const inst = await instanciaDaConta()
    if ('erro' in inst) return { error: inst.erro }

    const grupos = await listGroups(inst.token)
    if (!grupos.some(g => g.JID === parsed.data.jid)) return { error: 'Grupo não encontrado neste WhatsApp.' }

    // Agenda é melhor esforço: sem ela, os nomes vêm só do WhatsApp.
    let agenda = new Map<string, string>()
    let agendaIndisponivel = false
    try { agenda = await listSavedContacts(inst.token) } catch (e) {
      agendaIndisponivel = true
      console.error('[disparos] leitura da agenda falhou (segue sem)', { contaId: inst.contaId, e })
    }

    const { contatos, semTelefone } = extrairContatos(grupos, parsed.data.jid, agenda, parsed.data.preferencia, inst.numero)
    if (!contatos.length) return { error: 'Nenhum membro com número visível neste grupo.' }
    return {
      error: null, linhas: paraLinhas(contatos), total: contatos.length, semTelefone,
      semNome: contatos.filter(c => !c.nome).length, agendaIndisponivel,
    }
  } catch (e) {
    console.error('[disparos] importar grupo falhou', e)
    return { error: mensagemUazapi(e, 'Não foi possível ler o grupo. Tente de novo.') }
  }
}

/**
 * Autoriza o envio de UM arquivo direto do navegador para o bucket privado: o servidor escolhe
 * o caminho (sempre dentro de contas/{conta_id}/) e devolve uma URL de upload assinada.
 */
export async function prepararUploadMidiaAction(input: { tipo: TipoMidia; mime: string; tamanho: number; nome: string }): Promise<{
  error: string | null; caminho?: string; token?: string
}> {
  const parsed = z.object({
    tipo: z.enum(['imagem', 'video', 'audio', 'documento']),
    mime: z.string().max(100),
    tamanho: z.number().int().positive(),
    nome: z.string().max(200),
  }).safeParse(input)
  if (!parsed.success) return { error: 'Arquivo inválido.' }
  const { tipo, mime, tamanho, nome } = parsed.data

  const permitidos: readonly string[] = TIPOS_MIDIA[tipo].mimes
  if (!permitidos.includes(mime)) return { error: `Formato não aceito para ${TIPOS_MIDIA[tipo].rotulo.toLowerCase()}.` }
  if (tamanho > TAMANHO_MAX_MIDIA) return { error: 'O arquivo passa de 16 MB, o limite do WhatsApp.' }

  try {
    const { contaId } = await getConta()
    const extensao = (nome.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'
    const caminho = `${pastaDaConta(contaId)}${randomUUID()}.${extensao}`
    const { data, error } = await createAdminClient().storage.from(BUCKET_MIDIA).createSignedUploadUrl(caminho)
    if (error || !data?.token) {
      console.error('[disparos] url de upload falhou', { contaId, error })
      return { error: 'Não foi possível preparar o envio do arquivo. Tente de novo.' }
    }
    return { error: null, caminho, token: data.token }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}