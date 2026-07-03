'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatBRL, formatData } from '@/lib/utils/format'
import { substituirVariaveis } from '@/lib/utils/variaveis'
import { revalidatePath } from 'next/cache'

async function getContaId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) throw new Error('Conta não encontrada.')
  return { contaId: conta.id as string }
}

// UPDATE não tem policy RLS — usa service role escopado por conta_id
export async function cancelarNotificacaoAction(id: string) {
  const { contaId } = await getContaId()

  const admin = createAdminClient()
  const { error } = await admin
    .from('notificacoes_enviadas')
    .update({ status: 'cancelado' })
    .eq('id', id)
    .eq('conta_id', contaId)
    .eq('status', 'fila')
  if (error) console.error('[cancelarNotificacao]', error, { id, contaId })

  revalidatePath('/log')
}

// UPDATE não tem policy RLS — usa service role escopado por conta_id
export async function reenviarNotificacaoAction(id: string) {
  const { contaId } = await getContaId()

  const admin = createAdminClient()
  const { error } = await admin
    .from('notificacoes_enviadas')
    .update({
      status:        'fila',
      agendado_para: new Date().toISOString(),
      enviado_em:    null,
    })
    .eq('id', id)
    .eq('conta_id', contaId)
    .in('status', ['falhou', 'cancelado'])
  if (error) console.error('[reenviarNotificacao]', error, { id, contaId })

  revalidatePath('/log')
}

// Força o envio imediato chamando o uazapi diretamente, sem passar pelo worker.
// Requer UAZAPI_URL e UAZAPI_GLOBAL_TOKEN no ambiente do Next.js.
export async function forcarEnvioAction(id: string): Promise<{ error?: string }> {
  const { contaId } = await getContaId()
  const admin = createAdminClient()

  // ── 1. Claim atômico ─────────────────────────────────────────────────────
  // UPDATE retorna a linha somente se o status ainda era fila|cancelado.
  // Muda para 'cancelado' para o worker não pegar a mesma linha concorrentemente.
  // Em caso de sucesso o status é atualizado para 'enviado' no passo 5.
  const { data: notif } = await admin
    .from('notificacoes_enviadas')
    .update({ status: 'cancelado' })
    .eq('id', id)
    .eq('conta_id', contaId)
    .eq('canal', 'whatsapp')
    .in('status', ['fila', 'cancelado'])
    .select('id, parcela_id, cobranca_id, cliente_id, tipo, mensagem_final')
    .maybeSingle()

  if (!notif) return { error: 'Notificação não encontrada.' }

  // ── 2. Buscar cliente ────────────────────────────────────────────────────
  const { data: cliente } = await admin
    .from('clientes')
    .select('celular, nome, sobrenome, deleted_at')
    .eq('id', notif.cliente_id as string)
    .maybeSingle()

  if (!cliente || (cliente as any).deleted_at) return { error: 'Cliente não encontrado ou excluído.' }
  const celular = (cliente as any).celular as string | null
  if (!celular) return { error: 'Cliente sem celular cadastrado.' }

  // ── 3. Resolver mensagem ─────────────────────────────────────────────────
  let mensagem: string

  if (notif.tipo === 'agendada') {
    const corpo = ((notif.mensagem_final as string) ?? '').trim()
    if (!corpo) return { error: 'Mensagem não configurada.' }
    mensagem = await resolverVarsLeves(admin, {
      contaId,
      clienteId: notif.cliente_id as string,
      template:  corpo,
    })
  } else {
    const { data: cfg } = await admin
      .from('notificacoes_config')
      .select('template_whatsapp')
      .eq('conta_id', contaId)
      .eq('tipo', notif.tipo)
      .maybeSingle()

    const template = ((cfg as any)?.template_whatsapp as string | null)?.trim()
    if (!template) return { error: 'Template WhatsApp não configurado para este tipo.' }

    let parcelaId = notif.parcela_id as string | null
    if (!parcelaId && notif.cobranca_id) {
      const { data: p } = await admin
        .from('parcelas')
        .select('id')
        .eq('cobranca_id', notif.cobranca_id as string)
        .order('numero', { ascending: true })
        .limit(1)
        .maybeSingle()
      parcelaId = (p as any)?.id ?? null
    }
    if (!parcelaId) return { error: 'Parcela não encontrada para montar a mensagem.' }

    mensagem = await resolverVars(admin, {
      contaId,
      parcelaId,
      clienteId:  notif.cliente_id as string,
      template,
      cobrancaId: notif.cobranca_id as string | null,
    })
  }

  // ── 4. Chamar uazapi diretamente ─────────────────────────────────────────
  const uazapiUrl   = (process.env.UAZAPI_URL ?? '').replace(/\/$/, '')
  const globalToken = process.env.UAZAPI_ADMIN_TOKEN ?? process.env.UAZAPI_GLOBAL_TOKEN ?? ''

  if (!uazapiUrl || !globalToken) {
    return { error: 'UAZAPI_URL / UAZAPI_ADMIN_TOKEN não configurados no servidor.' }
  }

  const instName = `quita${(contaId).replace(/-/g, '').slice(0, 10)}`

  let instanceToken: string | null = null
  try {
    const resp = await fetch(`${uazapiUrl}/instance/all`, {
      headers: { admintoken: globalToken },
    })
    if (resp.ok) {
      const all = await resp.json()
      if (Array.isArray(all)) {
        const inst = all.find((i: any) => i.name === instName)
        if (inst?.status === 'connected') instanceToken = inst.token as string
      }
    }
  } catch {
    return { error: 'Erro ao conectar ao servidor WhatsApp.' }
  }

  if (!instanceToken) {
    return { error: 'WhatsApp desconectado. Reconecte em Conexão WA e tente novamente.' }
  }

  try {
    const resp = await fetch(`${uazapiUrl}/send/text`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', token: instanceToken },
      body:    JSON.stringify({ number: celular, text: mensagem }),
    })
    if (!resp.ok) {
      const txt = await resp.text()
      return { error: `Falha ao enviar: ${txt}` }
    }
  } catch {
    return { error: 'Erro de rede ao enviar a mensagem.' }
  }

  // ── 5. Marcar como enviado ───────────────────────────────────────────────
  await admin
    .from('notificacoes_enviadas')
    .update({ status: 'enviado', mensagem_final: mensagem, enviado_em: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'cancelado')

  revalidatePath('/log')
  return {}
}

// ── Helpers de resolução de variáveis ───────────────────────────────────────
// A substituição pura (substituirVariaveis) vive em lib/utils/variaveis.ts.
// O worker mantém cópia própria em worker/src/variaveis.ts — processos separados.
// Ao adicionar nova variável de template, atualizar ambos os arquivos.

async function resolverVarsLeves(
  admin: ReturnType<typeof createAdminClient>,
  { contaId, clienteId, template }: { contaId: string; clienteId: string; template: string },
): Promise<string> {
  const [{ data: cliente }, { data: saudacoes }] = await Promise.all([
    admin.from('clientes').select('nome, sobrenome').eq('id', clienteId).single(),
    admin.from('saudacoes').select('texto').eq('conta_id', contaId),
  ])
  const textos   = ((saudacoes ?? []) as any[]).map((s: any) => s.texto as string)
  const saudacao = textos.length ? textos[Math.floor(Math.random() * textos.length)] : 'Olá!'
  const nome     = (cliente as any)?.nome ?? ''
  const sobrenome = (cliente as any)?.sobrenome ?? ''
  return template
    .replace(/#NOMECOMPLETO#/g, `${nome} ${sobrenome}`.trim())
    .replace(/#NOME#/g,         nome)
    .replace(/#SAUDACAO#/g,     saudacao)
}

async function resolverVars(
  admin: ReturnType<typeof createAdminClient>,
  { contaId, parcelaId, clienteId, template, cobrancaId }: {
    contaId: string; parcelaId: string; clienteId: string; template: string; cobrancaId?: string | null
  },
): Promise<string> {
  async function buscarPix() {
    if (cobrancaId) {
      const { data: cob } = await admin
        .from('cobrancas').select('meio_pagamento_id').eq('id', cobrancaId).maybeSingle()
      const meioid = (cob as any)?.meio_pagamento_id
      if (meioid) {
        const { data: meio } = await admin
          .from('meios_pagamento').select('mensagem').eq('id', meioid).maybeSingle()
        if ((meio as any)?.mensagem) return meio
      }
    }
    const { data } = await admin
      .from('meios_pagamento').select('mensagem').eq('conta_id', contaId).eq('is_padrao', true).maybeSingle()
    return data
  }

  const [{ data: parcela }, { data: cliente }, { data: saudacoes }, pix] = await Promise.all([
    admin.from('parcelas').select('valor, data_vencimento').eq('id', parcelaId).single(),
    admin.from('clientes').select('nome, sobrenome').eq('id', clienteId).single(),
    admin.from('saudacoes').select('texto').eq('conta_id', contaId),
    buscarPix(),
  ])

  const textos   = ((saudacoes ?? []) as any[]).map((s: any) => s.texto as string)
  const saudacao = textos.length ? textos[Math.floor(Math.random() * textos.length)] : 'Olá!'

  return substituirVariaveis(template, {
    valor:        formatBRL(parseFloat((parcela as any)?.valor ?? '0')),
    nomecompleto: `${(cliente as any)?.nome ?? ''} ${(cliente as any)?.sobrenome ?? ''}`.trim(),
    nome:         (cliente as any)?.nome ?? '',
    pix:          (pix as any)?.mensagem ?? '(Pix não configurado)',
    saudacao,
    vencimento:   formatData((parcela as any)?.data_vencimento),
  })
}
