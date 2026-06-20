'use server'

// Ações de conexão WhatsApp.
// O frontend grava um "comando" na tabela conexoes;
// o worker (VPS) lê via Realtime, executa e limpa o campo.
// Nunca há socket Baileys aqui — tudo no worker.

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

/** Solicita ao worker que encerre a conexão (logout). */
export async function desconectarAction() {
  const { supabase, contaId } = await getConta()

  await supabase.from('conexoes').upsert(
    { conta_id: contaId, status: 'desconectado', comando: 'desconectar', qr_code: null },
    { onConflict: 'conta_id' },
  )

  revalidatePath('/conexao')
}

/** Solicita ao worker que reinicie e gere novo QR sem derrubar o servidor. */
export async function reiniciarAction() {
  const { supabase, contaId } = await getConta()

  await supabase.from('conexoes').upsert(
    { conta_id: contaId, status: 'conectando', comando: 'reconectar', qr_code: null },
    { onConflict: 'conta_id' },
  )

  revalidatePath('/conexao')
}
