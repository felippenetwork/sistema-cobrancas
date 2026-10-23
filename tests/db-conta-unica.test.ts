// Migration 0037 (2026-10-23): multi-atendimento, equipe e PIX do cliente final saíram do produto.
// Provado no Postgres com as migrations reais: a conta volta a ter um único usuário (o dono), as
// credenciais e meios de pagamento continuam fechados para quem não é dono, e conta nova continua
// nascendo (o trigger que criava o departamento "Geral" saiu junto com a tabela).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criarBanco, criarConta, criarUsuario, type BancoTeste } from './helpers/pg-supabase'

let db: BancoTeste
let contaA: string, contaB: string
let donoA: string, donoB: string

beforeAll(async () => {
  db = await criarBanco()
  ;({ contaId: contaA, donoId: donoA } = await criarConta(db, 'A'))
  ;({ contaId: contaB, donoId: donoB } = await criarConta(db, 'B'))

  await db.sql(
    `insert into public.configuracoes (conta_id, nome_comercial) values ($1, 'Empresa A'), ($2, 'Empresa B')`,
    [contaA, contaB],
  )
  await db.sql(
    `insert into public.meios_pagamento (conta_id, nome, mensagem, is_padrao) values ($1, 'Pix A', 'chave-pix-da-conta-A', true)`,
    [contaA],
  )
})
afterAll(() => db.fechar())

describe('schema depois da 0037', () => {
  it('as tabelas do atendimento, da equipe e do PIX não existem mais', async () => {
    const { rows } = await db.sql<{ tabela: string }>(
      `select table_name as tabela from information_schema.tables
        where table_schema = 'public'
          and table_name in ('mensagens_wa', 'atendimentos', 'departamentos', 'mensagens_rapidas', 'membros_conta', 'cobrancas_pix')`,
    )
    expect(rows).toEqual([])
  })

  it('configuracoes não guarda mais credencial de EfiBank nem de Mercado Pago', async () => {
    const { rows } = await db.sql<{ coluna: string }>(
      `select column_name as coluna from information_schema.columns
        where table_schema = 'public' and table_name = 'configuracoes'
          and (column_name like 'efi\\_%' or column_name in ('mp_access_token', 'mp_webhook_secret', 'pix_provedor'))`,
    )
    expect(rows).toEqual([])
  })

  it('conta nova continua sendo criada (sem o trigger do departamento "Geral")', async () => {
    const { contaId } = await criarConta(db, 'nova')
    expect(contaId).toBeTruthy()
  })
})

describe('a conta é só do dono', () => {
  it('conta_do_usuario() devolve a conta do dono e nada para quem não tem conta', async () => {
    const dono = await db.como(donoA).query<{ conta: string | null }>(`select public.conta_do_usuario() as conta`)
    expect(dono.rows[0].conta).toBe(contaA)

    const semConta = await criarUsuario(db, 'sem-conta')
    const r = await db.como(semConta).query<{ conta: string | null }>(`select public.conta_do_usuario() as conta`)
    expect(r.rows[0].conta).toBeNull()
  })

  it('pode_administrar_conta() vale só para o dono da própria conta', async () => {
    const r = await db.como(donoA).query<{ propria: boolean; alheia: boolean }>(
      `select public.pode_administrar_conta($1) as propria, public.pode_administrar_conta($2) as alheia`, [contaA, contaB])
    expect(r.rows[0]).toEqual({ propria: true, alheia: false })
  })

  it('usuário sem conta não lê configurações nem meios de pagamento de ninguém', async () => {
    const intruso = await criarUsuario(db, 'intruso')
    expect((await db.como(intruso).query(`select conta_id from public.configuracoes`)).rows).toHaveLength(0)
    expect((await db.como(intruso).query(`select id from public.meios_pagamento`)).rows).toHaveLength(0)
  })
})

describe('credenciais e meios de pagamento continuam isolados', () => {
  it('o dono lê e altera as próprias configurações', async () => {
    expect((await db.como(donoA).query(`select nome_comercial from public.configuracoes where conta_id = $1`, [contaA])).rows)
      .toEqual([{ nome_comercial: 'Empresa A' }])
    const r = await db.como(donoA).query(
      `update public.configuracoes set nome_comercial = 'Empresa A2' where conta_id = $1 returning conta_id`, [contaA])
    expect(r.rows).toHaveLength(1)
  })

  it('o dono de OUTRA conta não lê nem altera as configurações', async () => {
    expect((await db.como(donoB).query(`select conta_id from public.configuracoes where conta_id = $1`, [contaA])).rows).toHaveLength(0)
    const r = await db.como(donoB).query(
      `update public.configuracoes set nome_comercial = 'x' where conta_id = $1 returning conta_id`, [contaA])
    expect(r.rows).toHaveLength(0)
  })

  it('o dono gerencia os meios de pagamento; o de outra conta não troca a chave PIX', async () => {
    const proprio = await db.como(donoA).query(
      `update public.meios_pagamento set nome = 'Pix (dono)' where conta_id = $1 returning id`, [contaA])
    expect(proprio.rows).toHaveLength(1)

    const alheio = await db.como(donoB).tentar(
      `update public.meios_pagamento set mensagem = 'pix-do-atacante' where conta_id = $1 returning id`, [contaA])
    expect(alheio.ok ? alheio.rows : []).toHaveLength(0)
    const { rows } = await db.sql<{ mensagem: string }>(`select mensagem from public.meios_pagamento where conta_id = $1`, [contaA])
    expect(rows[0].mensagem).toBe('chave-pix-da-conta-A')
  })
})
