// Migration 0041 (chatbot), no Postgres real com as migrations do projeto: isolamento entre
// contas em bot_fluxos / bot_conversas / bot_mensagens e as regras do banco.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criarBanco, criarConta, type BancoTeste } from './helpers/pg-supabase'

let db: BancoTeste
let contaA: string, contaB: string, donoA: string, donoB: string
let fluxoA: string, conversaA: string

beforeAll(async () => {
  db = await criarBanco()
  ;({ contaId: contaA, donoId: donoA } = await criarConta(db, 'A'))
  ;({ contaId: contaB, donoId: donoB } = await criarConta(db, 'B'))
  fluxoA = (await db.sql<{ id: string }>(`insert into public.bot_fluxos (conta_id, nome) values ($1, 'Vendas') returning id`, [contaA])).rows[0].id
  conversaA = (await db.sql<{ id: string }>(
    `insert into public.bot_conversas (conta_id, celular, fluxo_id) values ($1, '5521999990001', $2) returning id`, [contaA, fluxoA])).rows[0].id
  await db.sql(`insert into public.bot_mensagens (conta_id, conversa_id, direcao, texto, wa_id) values ($1, $2, 'recebida', 'oi', 'W1')`, [contaA, conversaA])
})
afterAll(() => db.fechar())

describe('isolamento entre contas', () => {
  for (const tabela of ['bot_fluxos', 'bot_conversas', 'bot_mensagens']) {
    it(`${tabela}: o dono vê o seu; o de outra conta não vê, não altera e não apaga`, async () => {
      expect((await db.como(donoA).query(`select id from public.${tabela}`)).rows).toHaveLength(1)
      expect((await db.como(donoB).query(`select id from public.${tabela}`)).rows).toHaveLength(0)
      expect((await db.como(donoB).query(`update public.${tabela} set conta_id = conta_id returning id`)).rows).toHaveLength(0)
      expect((await db.como(donoB).query(`delete from public.${tabela} returning id`)).rows).toHaveLength(0)
    })
  }

  it('ninguém cria fluxo, conversa ou mensagem em nome de outra conta', async () => {
    expect((await db.como(donoB).tentar(`insert into public.bot_fluxos (conta_id, nome) values ($1, 'x')`, [contaA])).ok).toBe(false)
    expect((await db.como(donoB).tentar(`insert into public.bot_conversas (conta_id, celular) values ($1, '5521999990009')`, [contaA])).ok).toBe(false)
    expect((await db.como(donoB).tentar(
      `insert into public.bot_mensagens (conta_id, conversa_id, direcao, texto) values ($1, $2, 'evento', 'x')`, [contaA, conversaA])).ok).toBe(false)
  })
})

describe('regras do banco', () => {
  it('fluxo novo nasce desligado, com as mensagens padrão e "atendente/humano"', async () => {
    const r = await db.sql(`select ativo, palavras_humano, msg_nao_entendi from public.bot_fluxos where id = $1`, [fluxoA])
    expect(r.rows[0]).toMatchObject({ ativo: false, palavras_humano: ['atendente', 'humano'] })
  })

  it('uma conversa por contato na conta; o mesmo número pode existir em outra conta', async () => {
    const dup = await db.sql(`insert into public.bot_conversas (conta_id, celular) values ($1, '5521999990001')`, [contaA]).then(() => 'aceitou', () => 'recusou')
    expect(dup).toBe('recusou')
    const outra = await db.sql(`insert into public.bot_conversas (conta_id, celular) values ($1, '5521999990001') returning id`, [contaB])
    expect(outra.rows).toHaveLength(1)
  })

  it('a mesma mensagem da uazapi (wa_id) não entra duas vezes na conta', async () => {
    const dup = await db.sql(
      `insert into public.bot_mensagens (conta_id, conversa_id, direcao, texto, wa_id) values ($1, $2, 'recebida', 'oi', 'W1')`, [contaA, conversaA])
      .then(() => 'aceitou', () => 'recusou')
    expect(dup).toBe('recusou')
  })

  it('recusa status, celular e número de aviso inválidos', async () => {
    const tentar = (sql: string, p: unknown[]) => db.sql(sql, p).then(() => 'aceitou', () => 'recusou')
    expect(await tentar(`update public.bot_conversas set status = 'outro' where id = $1`, [conversaA])).toBe('recusou')
    expect(await tentar(`insert into public.bot_conversas (conta_id, celular) values ($1, '21-9999')`, [contaA])).toBe('recusou')
    expect(await tentar(`update public.bot_fluxos set aviso_numero = '(21) 9999' where id = $1`, [fluxoA])).toBe('recusou')
  })

  it('excluir o fluxo tira o vínculo das conversas e dos disparos, sem apagá-los', async () => {
    const f = (await db.sql<{ id: string }>(`insert into public.bot_fluxos (conta_id, nome) values ($1, 'Temp') returning id`, [contaA])).rows[0].id
    const cv = (await db.sql<{ id: string }>(`insert into public.bot_conversas (conta_id, celular, fluxo_id) values ($1, '5521999990002', $2) returning id`, [contaA, f])).rows[0].id
    const cp = (await db.sql<{ id: string }>(`insert into public.campanhas_wa (conta_id, nome, fluxo_id) values ($1, 'D', $2) returning id`, [contaA, f])).rows[0].id
    await db.sql(`delete from public.bot_fluxos where id = $1`, [f])
    expect((await db.sql(`select fluxo_id from public.bot_conversas where id = $1`, [cv])).rows).toEqual([{ fluxo_id: null }])
    expect((await db.sql(`select fluxo_id from public.campanhas_wa where id = $1`, [cp])).rows).toEqual([{ fluxo_id: null }])
  })

  it('apagar a conversa leva o histórico junto', async () => {
    const cv = (await db.sql<{ id: string }>(`insert into public.bot_conversas (conta_id, celular) values ($1, '5521999990003') returning id`, [contaA])).rows[0].id
    await db.sql(`insert into public.bot_mensagens (conta_id, conversa_id, direcao, texto) values ($1, $2, 'evento', 'x')`, [contaA, cv])
    await db.sql(`delete from public.bot_conversas where id = $1`, [cv])
    expect((await db.sql(`select id from public.bot_mensagens where conversa_id = $1`, [cv])).rows).toHaveLength(0)
  })
})
