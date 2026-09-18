'use server'

// Ações de conexão WhatsApp — fala DIRETO com a uazapi a partir da Vercel.
// Não depende mais de worker/VPS: antes o frontend só gravava um "comando" na
// tabela conexoes e esperava um worker na Vortexus processá-lo. Esse worker
// não roda mais, então nada nunca consumia o comando e a tela ficava presa em
// "Gerando QR Code…" para sempre. Agora cada ação chama a uazapi e grava o
// resultado no banco na hora — mesmo padrão usado no botão "Forçar" do Log
// (app/(app)/log/_actions/log.ts) e no ERP-Rifas (src/components/conexao).

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import {
  instName,
  createInstance,
  deleteInstance,
  deleteInstanceByName,
  connectInstance,
  getAllInstances,
  setWebhook,
  UazapiRateLimitError,
  type InstanceInfo,
} from '@/lib/uazapi'

function webhookUrlDaConta(contaId: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (!base) return null
  return `${base}/api/webhooks/whatsapp?conta=${contaId}`
}

type AdminClient = ReturnType<typeof createAdminClient>

async function getConta() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) throw new Error('Conta não encontrada.')
  return { contaId: conta.id as string }
}

// Grava o resultado de uma checagem/conexão no banco. Nunca apaga um QR válido
// já salvo só porque esta chamada específica não trouxe nada novo (ex: ainda
// gerando) — só sobrescreve quando tem uma resposta melhor pra mostrar.
async function aplicarInfo(
  admin: AdminClient,
  contaId: string,
  info: InstanceInfo,
  tokenParaGravar?: string,
) {
  if (info.rateLimited) {
    await admin.from('conexoes').update({ rate_limitado: true }).eq('conta_id', contaId)
    return
  }

  if (info.status === 'connected') {
    await admin.from('conexoes').upsert(
      {
        conta_id:          contaId,
        status:            'conectado',
        qr_code:           null,
        numero_conectado:  info.phone,
        device_name:       info.nome ?? null,
        rate_limitado:     false,
        ultima_conexao:    new Date().toISOString(),
        ...(tokenParaGravar ? { uazapi_instance_token: tokenParaGravar } : {}),
      },
      { onConflict: 'conta_id' },
    )
    return
  }

  if (info.status === 'qr_ready' && info.qr) {
    await admin.from('conexoes').upsert(
      { conta_id: contaId, status: 'conectando', qr_code: info.qr, rate_limitado: false },
      { onConflict: 'conta_id' },
    )
    return
  }

  // 'connecting' sem QR ainda, ou 'disconnected' vindo de uma checagem pontual —
  // não decide sozinho que caiu; quem decide "desconectado" é desconectarAction
  // ou o cron de sincronização (/api/cron/whatsapp-uazapi).
}

/** Conecta do zero: apaga instância antiga (se houver), cria nova, gera QR. */
export async function conectarAction() {
  const { contaId } = await getConta()
  const admin = createAdminClient()
  const name  = instName(contaId)

  await admin.from('conexoes').upsert(
    { conta_id: contaId, status: 'conectando', qr_code: null, comando: null },
    { onConflict: 'conta_id' },
  )

  // Ciclo limpo: apaga instância antiga antes de criar outra — evita acumular
  // instâncias mortas no uazapi (mesmo comportamento do worker antigo).
  await deleteInstanceByName(name)

  let token: string
  try {
    const created = await createInstance(name)
    token = created.token
  } catch (err) {
    await admin.from('conexoes').update({ status: 'desconectado' }).eq('conta_id', contaId)
    throw new Error(
      err instanceof UazapiRateLimitError
        ? 'A uazapi está limitando as conexões agora. Aguarde um instante e tente de novo.'
        : 'Não foi possível criar a instância no uazapi. Tente novamente em instantes.',
    )
  }

  await admin.from('conexoes').upsert(
    { conta_id: contaId, status: 'conectando', qr_code: null,
      uazapi_instance_token: token, rate_limitado: false },
    { onConflict: 'conta_id' },
  )

  // Sem isso a uazapi não avisa o sistema de mensagens recebidas/status de
  // entrega — o painel nunca fica sabendo de nada até o próximo poll manual.
  const webhookUrl = webhookUrlDaConta(contaId)
  if (webhookUrl) await setWebhook(token, webhookUrl)

  const info = await connectInstance(token)
  await aplicarInfo(admin, contaId, info)

  revalidatePath('/conexao')
}

/** Desconecta: apaga a instância no uazapi e limpa o estado local. */
export async function desconectarAction() {
  const { contaId } = await getConta()
  const admin = createAdminClient()

  const { data: atual } = await admin
    .from('conexoes').select('uazapi_instance_token').eq('conta_id', contaId).maybeSingle()

  if (atual?.uazapi_instance_token) await deleteInstance(atual.uazapi_instance_token)
  else await deleteInstanceByName(instName(contaId))

  await admin.from('conexoes').upsert(
    {
      conta_id:               contaId,
      status:                 'desconectado',
      qr_code:                null,
      comando:                null,
      numero_conectado:       null,
      device_name:            null,
      rate_limitado:          false,
      uazapi_instance_token:  null,
      desconectado_em:        new Date().toISOString(),
    },
    { onConflict: 'conta_id' },
  )

  revalidatePath('/conexao')
}

/**
 * Reconsulta o status sem apagar a instância — usada pelo botão "Atualizar" e
 * pelo polling automático da tela enquanto está "conectando". NUNCA chama
 * conectar()/apaga a instância aqui: se a conta já estiver conectada no
 * celular, um 429 ou uma resposta ambígua da uazapi não pode derrubar a
 * sessão por engano (mesma lição aplicada no worker/uazapi-manager.ts hoje).
 */
export async function reiniciarAction() {
  const { contaId } = await getConta()
  const admin = createAdminClient()

  const { data: atual } = await admin
    .from('conexoes').select('uazapi_instance_token').eq('conta_id', contaId).maybeSingle()

  let token = atual?.uazapi_instance_token ?? null

  if (!token) {
    try {
      const all  = await getAllInstances()
      const inst = all.find(i => i.name === instName(contaId))
      if (inst?.token) token = inst.token
    } catch (err) {
      if (!(err instanceof UazapiRateLimitError)) throw err
    }
  }

  if (!token) {
    // Nunca existiu instância pra essa conta — equivalente a conectar do zero.
    await conectarAction()
    return
  }

  const info = await connectInstance(token)
  await aplicarInfo(admin, contaId, info, token)

  revalidatePath('/conexao')
}

/** Chamada pelo polling da própria tela enquanto qr/"conectando" — mesma lógica de reiniciarAction. */
export async function verificarStatusAction() {
  await reiniciarAction()
}
