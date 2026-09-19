// Prova de isolamento entre contas — Sprint 1, entregável obrigatório.
//
// Reescrito em 2026-09-19 (achado da auditoria durante o SEG-N4): a versão anterior deste
// arquivo rodava contra um projeto Supabase real (SUPABASE_URL/SERVICE_KEY do .env.local),
// criando e apagando usuários e contas de verdade a cada `npx vitest run` — exatamente o que
// a skill testes-cobranx proíbe (nunca tocar o projeto compartilhado) e um risco real: qualquer
// interrupção entre o beforeAll e o afterAll deixava usuários/contas órfãos em produção.
// Agora usa o mesmo Postgres local (PGlite) do restante da suíte — mesma prova, sem o risco.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criarBanco, criarConta, type BancoTeste } from './helpers/pg-supabase'

let db: BancoTeste
let contaAId: string, contaBId: string, donoAId: string, donoBId: string
let clienteAId: string

beforeAll(async () => {
  db = await criarBanco()
  ;({ contaId: contaAId, donoId: donoAId } = await criarConta(db, 'A'))
  ;({ contaId: contaBId, donoId: donoBId } = await criarConta(db, 'B'))

  const { rows } = await db.sql<{ id: string }>(
    `insert into public.clientes (conta_id, nome, sobrenome, celular, cpf, email)
     values ($1, 'Cliente', 'Da Conta A', '5511999990001', '52998224725', 'cliente-a@test.local')
     returning id`,
    [contaAId],
  )
  clienteAId = rows[0].id
})
afterAll(() => db.fechar())

describe('RLS — isolamento entre contas', () => {
  it('Conta A enxerga seus próprios clientes', async () => {
    const { rows } = await db.como(donoAId).query<{ id: string }>(`select id from public.clientes`)
    expect(rows).toEqual([{ id: clienteAId }])
  })

  it('Conta B não enxerga nenhum cliente (lista vazia)', async () => {
    const { rows } = await db.como(donoBId).query(`select id from public.clientes`)
    // RLS retorna lista vazia, não erro — o atacante nem sabe que existe dado
    expect(rows).toHaveLength(0)
  })

  it('Conta B não consegue buscar o cliente A por ID explícito', async () => {
    const { rows } = await db.como(donoBId).query(`select id from public.clientes where id = $1`, [clienteAId])
    expect(rows).toHaveLength(0)
  })

  it('Conta B não consegue inserir cliente forjando conta_id da conta A', async () => {
    const r = await db.como(donoBId).tentar(
      `insert into public.clientes (conta_id, nome, sobrenome, celular, cpf, email)
       values ($1, 'Invasor', 'Forjado', '5511999990099', '11144477735', 'invasor@test.local')`,
      [contaAId],
    )
    // WITH CHECK da policy rejeita: conta_id != conta_do_usuario() para B
    expect(r.ok).toBe(false)
  })

  it('Conta B não consegue atualizar dados do cliente A', async () => {
    const { rows } = await db.como(donoBId).query(
      `update public.clientes set nome = 'MODIFICADO' where id = $1 returning id`, [clienteAId])
    // USING da policy filtra a linha — update afeta 0 linhas
    expect(rows).toHaveLength(0)
  })

  it('Conta B não consegue deletar cliente da conta A', async () => {
    const { rows } = await db.como(donoBId).query(`delete from public.clientes where id = $1 returning id`, [clienteAId])
    expect(rows).toHaveLength(0)
    // Confirmar que o cliente A ainda existe (via superusuário, ignorando RLS)
    const { rows: check } = await db.sql(`select id from public.clientes where id = $1`, [clienteAId])
    expect(check).toHaveLength(1)
  })

  it('Conta B não enxerga a conta A na tabela contas', async () => {
    const { rows } = await db.como(donoBId).query<{ id: string }>(`select id from public.contas`)
    const ids = rows.map(r => r.id)
    expect(ids).not.toContain(contaAId)
    expect(ids).toContain(contaBId) // B vê apenas a própria conta
  })

  it('Conta B não consegue alterar status/validade da conta A', async () => {
    const { rows } = await db.como(donoBId).query(
      `update public.contas set status = 'ativa', validade_plano = '2099-12-31' where id = $1 returning id`, [contaAId])
    // Nenhuma policy permite update de contas pelo tenant
    expect(rows).toHaveLength(0)
  })
})

describe('trava de regressão: toda tabela com conta_id tem RLS habilitado', () => {
  it('nenhuma tabela pública com coluna conta_id está com RLS desligado', async () => {
    // Pega automaticamente qualquer tabela nova que ganhe conta_id numa migration futura
    // e alguém esquecer o "enable row level security" (foi exatamente o achado SEG-N1/A6).
    const { rows } = await db.sql<{ tabela: string }>(`
      select c.relname as tabela
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'conta_id'
        )
    `)
    expect(rows).toEqual([])
  })
})
