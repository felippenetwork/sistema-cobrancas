// Postgres de verdade, em memória (PGlite), com as migrations REAIS de supabase/migrations.
// Serve para provar RLS, permissões e RPCs sem tocar no projeto Supabase compartilhado
// (a skill testes-cobranx proíbe testar contra ele). Reproduz só o mínimo do ambiente
// Supabase: papéis anon/authenticated/service_role, auth.uid() e alguns schemas.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PASTA_MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')

const AMBIENTE_SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);

  create schema cron;
  create function cron.schedule(nome text, agenda text, comando text) returns bigint
    language sql as $$ select 1::bigint $$;

  create publication supabase_realtime;

  grant usage on schema public, auth to anon, authenticated, service_role;
  -- como no Supabase: tudo que as migrations criarem em public já nasce com grant para os papéis
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`

// Extensões que o PGlite não traz (pgcrypto: gen_random_uuid já é nativo; pg_cron: shim acima).
const EXTENSOES_IGNORADAS = /create extension if not exists ("?pgcrypto"?|pg_cron)[^;]*;/gi

export type Papel = 'authenticated' | 'service_role'

export type Executor = {
  query: <T = Record<string, any>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>
  /** Como query, mas devolve o erro em vez de lançar — para afirmar que o banco RECUSOU algo. */
  tentar: <T = Record<string, any>>(sql: string, params?: unknown[]) => Promise<{ ok: true; rows: T[] } | { ok: false; erro: string }>
}

export type BancoTeste = Awaited<ReturnType<typeof criarBanco>>

export async function criarBanco() {
  const pg = new PGlite()
  await pg.exec(AMBIENTE_SUPABASE)

  const arquivos = readdirSync(PASTA_MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
  for (const arquivo of arquivos) {
    const sql = readFileSync(join(PASTA_MIGRATIONS, arquivo), 'utf8').replace(EXTENSOES_IGNORADAS, '')
    try {
      await pg.exec(sql)
    } catch (e) {
      throw new Error(`A migration ${arquivo} falhou no Postgres de teste: ${(e as Error).message}`)
    }
  }

  const comoPapel = (papel: Papel, userId: string | null, opts: { semFk?: boolean } = {}): Executor => {
    const query: Executor['query'] = (sql, params) =>
      pg.transaction(async tx => {
        // FK desligada (papel "replica") só precisa valer para testes de RLS; tem que ser
        // definida ANTES de trocar de papel, porque só superusuário consegue mexer nisso.
        if (opts.semFk) await tx.exec(`set local session_replication_role = replica`)
        await tx.exec(`set local role ${papel}`)
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ''])
        return tx.query(sql, params) as any
      })
    return {
      query,
      tentar: async (sql, params) => {
        try { return { ok: true, rows: (await query(sql, params)).rows as any[] } }
        catch (e) { return { ok: false, erro: (e as Error).message } }
      },
    }
  }

  return {
    pg,
    /** Superusuário: montar cenário e conferir o estado real, ignorando RLS. */
    sql: <T = Record<string, any>>(sql: string, params?: unknown[]) => pg.query<T>(sql, params),
    /** Usuário autenticado do app — RLS valendo, como no navegador com o JWT dele. */
    como: (userId: string, opts?: { semFk?: boolean }) => comoPapel('authenticated', userId, opts),
    /** Service role (o que as rotas de servidor usam) — ignora RLS. */
    comoServico: () => comoPapel('service_role', null),
    fechar: () => pg.close(),
  }
}

// ── Cenários ──────────────────────────────────────────────────────────────────

let sequencia = 0

export async function criarUsuario(db: BancoTeste, apelido: string): Promise<string> {
  const { rows } = await db.sql<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [`${apelido}-${++sequencia}@teste.local`],
  )
  return rows[0].id
}

export async function criarConta(db: BancoTeste, nome: string): Promise<{ contaId: string; donoId: string }> {
  const donoId = await criarUsuario(db, `dono-${nome}`)
  const { rows } = await db.sql<{ id: string }>(
    `insert into public.contas (owner_user_id, nome_empresa, status, validade_plano)
     values ($1, $2, 'ativa', '2099-12-31') returning id`,
    [donoId, `Empresa ${nome}`],
  )
  return { contaId: rows[0].id, donoId }
}

export async function adicionarMembro(
  db: BancoTeste,
  contaId: string,
  role: 'admin' | 'atendente',
  apelido: string = role,
): Promise<string> {
  const userId = await criarUsuario(db, apelido)
  await db.sql(
    `insert into public.membros_conta (conta_id, user_id, nome, email, role)
     values ($1, $2, $3, $4, $5)`,
    [contaId, userId, `Membro ${apelido}`, `${apelido}-${userId}@teste.local`, role],
  )
  return userId
}

/** Conta nova com dono, um administrador e um atendente — para testes que alteram a equipe. */
export async function criarEquipe(db: BancoTeste, nome: string) {
  const { contaId, donoId } = await criarConta(db, nome)
  const adminId = await adicionarMembro(db, contaId, 'admin', `admin-${nome}`)
  const atendenteId = await adicionarMembro(db, contaId, 'atendente', `atendente-${nome}`)
  return { contaId, donoId, adminId, atendenteId }
}
