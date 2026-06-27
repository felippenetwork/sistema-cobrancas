'use server'

// Ações de conexão WhatsApp.
// O frontend grava um "comando" na tabela conexoes;
// o worker (VPS) lê via Realtime + polling, executa e limpa o campo.

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getConta() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) throw new Error('Conta não encontrada.')
  return { supabase, contaId: conta.id as string }
}

/** Solicita ao worker que inicie/reinicie a conexão WhatsApp. */
export async function conectarAction() {
  const { supabase, contaId } = await getConta()

  await supabase.from('conexoes').upsert(
    { conta_id: contaId, status: 'conectando', comando: 'reconectar', qr_code: null },
    { onConflict: 'conta_id' },
  )

  revalidatePath('/conexao')
}

/** Solicita ao worker que encerre a conexão. */
export async function desconectarAction() {
  const { supabase, contaId } = await getConta()

  await supabase.from('conexoes').upsert(
    {
      conta_id:         contaId,
      status:           'desconectado',
      comando:          'desconectar',
      qr_code:          null,
      numero_conectado: null,
      device_name:      null,
    },
    { onConflict: 'conta_id' },
  )

  revalidatePath('/conexao')
}

/** Solicita ao worker que sincronize o estado. */
export async function reiniciarAction() {
  const { supabase, contaId } = await getConta()

  const { data: atual } = await supabase
    .from('conexoes').select('status').eq('conta_id', contaId).maybeSingle()

  if ((atual as any)?.status === 'conectado') {
    await supabase.from('conexoes')
      .update({ comando: 'reconectar', qr_code: null })
      .eq('conta_id', contaId)
  } else {
    await supabase.from('conexoes').upsert(
      { conta_id: contaId, status: 'conectando', comando: 'reconectar', qr_code: null },
      { onConflict: 'conta_id' },
    )
  }

  revalidatePath('/conexao')
}

export async function refreshStatusAction() {
  // Não é mais necessário — o worker faz polling ativo e atualiza o banco automaticamente.
}
