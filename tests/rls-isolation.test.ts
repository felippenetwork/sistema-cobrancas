/**
 * Teste de isolamento RLS — Sprint 1, entregável obrigatório.
 *
 * Prova que NENHUMA conta consegue ler, escrever ou alterar dados de outra.
 * Usa service role para setup/teardown; usa anon key + JWT do usuário para
 * os testes em si (exatamente como o browser faria).
 *
 * Pré-requisito: .env.local preenchido com SUPABASE_URL, SUPABASE_SERVICE_KEY
 * e NEXT_PUBLIC_SUPABASE_ANON_KEY apontando para um projeto Supabase com os
 * migrations 0001 + 0002 + 0003 aplicados.
 *
 * Rodar: npm test
 */

import { createClient } from '@supabase/supabase-js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// --- Configuração -----------------------------------------------------------

const SUPABASE_URL    = process.env.SUPABASE_URL!
const SERVICE_KEY     = process.env.SUPABASE_SERVICE_KEY!
const ANON_KEY        = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const TEST_PASSWORD   = 'TestIsolamento@2026'
const SUFFIX          = Date.now()

// Cliente admin (service role — ignora RLS, só para setup/teardown)
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Estado dos testes
let userAId: string, userBId: string
let contaAId: string, contaBId: string
let clienteAId: string

const emailA = `rls-a-${SUFFIX}@test.local`
const emailB = `rls-b-${SUFFIX}@test.local`

// Helper: cria cliente autenticado como um usuário específico
async function loginAs(email: string) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (error) throw new Error(`Login falhou para ${email}: ${error.message}`)
  return client
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    throw new Error(
      'Variáveis de ambiente ausentes. Copie .env.example para .env.local e preencha os valores.',
    )
  }

  // Criar usuários (email_confirm: true pula o fluxo de verificação nos testes)
  const { data: uA, error: eA } = await admin.auth.admin.createUser({
    email: emailA, password: TEST_PASSWORD, email_confirm: true,
  })
  if (eA) throw new Error(`Criar user A: ${eA.message}`)
  userAId = uA.user.id

  const { data: uB, error: eB } = await admin.auth.admin.createUser({
    email: emailB, password: TEST_PASSWORD, email_confirm: true,
  })
  if (eB) throw new Error(`Criar user B: ${eB.message}`)
  userBId = uB.user.id

  // Criar contas (simula provisionamento pelo Admin)
  const { data: cA, error: ecA } = await admin
    .from('contas')
    .insert({ owner_user_id: userAId, nome_empresa: 'Empresa Teste A', status: 'ativa', validade_plano: '2099-12-31' })
    .select('id')
    .single()
  if (ecA) throw new Error(`Criar conta A: ${ecA.message}`)
  contaAId = cA.id

  const { data: cB, error: ecB } = await admin
    .from('contas')
    .insert({ owner_user_id: userBId, nome_empresa: 'Empresa Teste B', status: 'ativa', validade_plano: '2099-12-31' })
    .select('id')
    .single()
  if (ecB) throw new Error(`Criar conta B: ${ecB.message}`)
  contaBId = cB.id

  // Inserir cliente na conta A (via service role)
  const { data: cli, error: eCli } = await admin
    .from('clientes')
    .insert({
      conta_id:  contaAId,
      nome:      'Cliente',
      sobrenome: 'Da Conta A',
      celular:   '5511999990001',
      cpf:       '52998224725', // CPF válido (verificado)
      email:     'cliente-a@test.local',
    })
    .select('id')
    .single()
  if (eCli) throw new Error(`Criar cliente A: ${eCli.message}`)
  clienteAId = cli.id
})

afterAll(async () => {
  // Ordem importa: FK constraints.
  // contas.owner_user_id → auth.users ON DELETE RESTRICT
  // → deletar conta antes do user.
  if (contaAId) await admin.from('contas').delete().eq('id', contaAId)
  if (contaBId) await admin.from('contas').delete().eq('id', contaBId)
  if (userAId)  await admin.auth.admin.deleteUser(userAId)
  if (userBId)  await admin.auth.admin.deleteUser(userBId)
})

// ---------------------------------------------------------------------------
// TESTES
// ---------------------------------------------------------------------------

describe('RLS — isolamento entre contas', () => {

  it('Conta A enxerga seus próprios clientes', async () => {
    const clientA = await loginAs(emailA)
    const { data, error } = await clientA.from('clientes').select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(clienteAId)
  })

  it('Conta B não enxerga nenhum cliente (lista vazia)', async () => {
    const clientB = await loginAs(emailB)
    const { data, error } = await clientB.from('clientes').select('id')
    expect(error).toBeNull()
    // RLS retorna lista vazia, não erro — o atacante nem sabe que existe dado
    expect(data).toHaveLength(0)
  })

  it('Conta B não consegue buscar o cliente A por ID explícito', async () => {
    const clientB = await loginAs(emailB)
    const { data, error } = await clientB
      .from('clientes')
      .select('id')
      .eq('id', clienteAId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('Conta B não consegue inserir cliente forjando conta_id da conta A', async () => {
    const clientB = await loginAs(emailB)
    const { error } = await clientB.from('clientes').insert({
      conta_id:  contaAId, // <-- tentativa de injetar na conta A
      nome:      'Invasor',
      sobrenome: 'Forjado',
      celular:   '5511999990099',
      cpf:       '11144477735', // CPF válido diferente
      email:     'invasor@test.local',
    })
    // WITH CHECK da policy rejeita: conta_id != conta_do_usuario() para B
    expect(error).not.toBeNull()
  })

  it('Conta B não consegue atualizar dados do cliente A', async () => {
    const clientB = await loginAs(emailB)
    const { data } = await clientB
      .from('clientes')
      .update({ nome: 'MODIFICADO' })
      .eq('id', clienteAId)
      .select('id')
    // USING da policy filtra a linha — update afeta 0 linhas
    expect(data).toHaveLength(0)
  })

  it('Conta B não consegue deletar cliente da conta A', async () => {
    const clientB = await loginAs(emailB)
    const { data } = await clientB
      .from('clientes')
      .delete()
      .eq('id', clienteAId)
      .select('id')
    expect(data).toHaveLength(0)
    // Confirmar que o cliente A ainda existe via service role
    const { data: check } = await admin.from('clientes').select('id').eq('id', clienteAId)
    expect(check).toHaveLength(1)
  })

  it('Conta B não enxerga a conta A na tabela contas', async () => {
    const clientB = await loginAs(emailB)
    const { data } = await clientB.from('contas').select('id')
    const ids = (data ?? []).map((r: any) => r.id)
    expect(ids).not.toContain(contaAId)
    expect(ids).toContain(contaBId) // B vê apenas a própria conta
  })

  it('Conta B não consegue alterar status/validade da conta A', async () => {
    const clientB = await loginAs(emailB)
    const { data } = await clientB
      .from('contas')
      .update({ status: 'ativa', validade_plano: '2099-12-31' })
      .eq('id', contaAId)
      .select('id')
    // contas_owner_upd foi removido em 0002 — nenhuma policy permite update pelo tenant
    expect(data).toHaveLength(0)
  })

})
