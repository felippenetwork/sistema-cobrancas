'use server'

import { createClient } from '@/lib/supabase/server'
import { validarCPF, normalizarCPF } from '@/lib/validations/cpf'
import { normalizarCelular } from '@/lib/validations/celular'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export type ActionState = { error: string | null; success?: boolean }

// ── Helper: retorna a conta do usuário logado ────────────────────────────────
async function getConta() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')

  const { data: conta } = await supabase
    .from('contas')
    .select('id, limite_clientes')
    .eq('owner_user_id', user.id)
    .single()
  if (!conta) throw new Error('Conta não encontrada.')

  return { supabase, contaId: conta.id as string, limite: conta.limite_clientes as number }
}

// ── Validações comuns ────────────────────────────────────────────────────────
function extrairCampos(formData: FormData) {
  return {
    nome:      (formData.get('nome')     as string).trim(),
    sobrenome: (formData.get('sobrenome') as string).trim(),
    cpfRaw:    (formData.get('cpf')      as string).trim(),
    celRaw:    (formData.get('celular')   as string).trim(),
    email:     (formData.get('email')    as string).trim().toLowerCase(),
  }
}

function validarCampos(campos: ReturnType<typeof extrairCampos>) {
  const { nome, sobrenome, cpfRaw, celRaw, email } = campos
  if (!nome || !sobrenome || !cpfRaw || !celRaw || !email) {
    return { error: 'Preencha todos os campos obrigatórios.' }
  }
  const cpf = normalizarCPF(cpfRaw)
  if (!validarCPF(cpf)) {
    return { error: 'CPF inválido. Verifique os dígitos informados.' }
  }
  const celular = normalizarCelular(celRaw)
  if (!celular) {
    return { error: 'Celular inválido. Use o formato (DDD) número, ex.: 11 99999-9999.' }
  }
  return { cpf, celular }
}

// ── Criar cliente ────────────────────────────────────────────────────────────
export async function criarClienteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId, limite } = await getConta()
    const campos = extrairCampos(formData)
    const validated = validarCampos(campos)
    if ('error' in validated) return validated as ActionState
    const { cpf, celular } = validated

    // Verificar limite de clientes do plano
    const { count } = await supabase
      .from('clientes')
      .select('*', { count: 'exact', head: true })
      .is('deleted_at', null)
    if ((count ?? 0) >= limite) {
      return { error: `Limite de ${limite} clientes atingido. Contate o suporte para ampliar o plano.` }
    }

    // CPF único por conta (RLS filtra automaticamente para a conta do usuário)
    const { data: cpfDuplicado } = await supabase
      .from('clientes')
      .select('id')
      .eq('cpf', cpf)
      .is('deleted_at', null)
      .maybeSingle()
    if (cpfDuplicado) return { error: 'CPF já cadastrado para outro cliente desta conta.' }

    const { error } = await supabase.from('clientes').insert({
      conta_id:  contaId,
      nome:      campos.nome,
      sobrenome: campos.sobrenome,
      celular,
      cpf,
      email:     campos.email,
    })
    if (error) return { error: error.message }

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/clientes')
  redirect('/clientes')
}

// ── Atualizar cliente ────────────────────────────────────────────────────────
export async function atualizarClienteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clienteId = formData.get('cliente_id') as string

  try {
    const { supabase } = await getConta()
    const campos = extrairCampos(formData)
    const validated = validarCampos(campos)
    if ('error' in validated) return validated as ActionState
    const { cpf, celular } = validated

    // CPF único excluindo o próprio cliente
    const { data: cpfDuplicado } = await supabase
      .from('clientes')
      .select('id')
      .eq('cpf', cpf)
      .neq('id', clienteId)
      .is('deleted_at', null)
      .maybeSingle()
    if (cpfDuplicado) return { error: 'CPF já cadastrado para outro cliente desta conta.' }

    const { error } = await supabase
      .from('clientes')
      .update({ nome: campos.nome, sobrenome: campos.sobrenome, celular, cpf, email: campos.email })
      .eq('id', clienteId)   // RLS garante que só altera cliente da própria conta
    if (error) return { error: error.message }

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/clientes')
  revalidatePath(`/clientes/${clienteId}`)
  return { error: null, success: true }
}

// ── Soft delete ──────────────────────────────────────────────────────────────
export async function excluirClienteAction(formData: FormData) {
  const clienteId  = formData.get('cliente_id') as string
  const redirectTo = formData.get('redirect_to') as string | null

  const { supabase } = await getConta()
  await supabase
    .from('clientes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', clienteId)

  revalidatePath('/clientes')
  if (redirectTo) redirect(redirectTo)
}
