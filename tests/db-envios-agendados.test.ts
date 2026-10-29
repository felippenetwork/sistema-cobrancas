// Migration 0045 (envios agendados para uma pessoa), no Postgres real com as migrations do
// projeto: regras do banco e isolamento entre contas.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criarBanco, criarConta, type BancoTeste } from './helpers/pg-supabase'

let db: BancoTeste
let contaA: string, contaB: string, donoA: string, donoB: string

const PASSOS = `'[{"tipo":"texto","texto":"Oi {{nome}}","variacoes":[],"digitacao_seg":5}]'::jsonb`

const inserir = (conta: string, extra = '', valores = '') =>
  db.sql<{ id: string; status: string }>(
    `insert into public.envios_agendados (conta_id, celular, passos, agendado_para${extra})
     values ($1, '5521999990001', ${PASSOS}, now() + interval '1 hour'${valores}) returning id, status`, [conta])

beforeAll(async () => {
  db = await criarBanco()
  ;({ contaId: contaA, donoId: donoA } = await criarConta(db, 'A'))
  ;({ contaId: contaB, donoId: donoB } = await criarConta(db, 'B'))
})
afterAll(() => db.fechar())

describe('envios_agendados', () => {
  it('nasce pendente', async () => {
    const r = await inserir(contaA)
    expect(r.rows[0].status).toBe('pendente')
  })

  it('o banco recusa número inválido, sequência vazia ou com mais de 30 caixinhas e situação desconhecida', async () => {
    const tentar = (sql: string) => db.sql(sql, [contaA]).then(() => 'aceitou', () => 'recusou')
    const base = (celular: string, passos: string, status = 'pendente') =>
      `insert into public.envios_agendados (conta_id, celular, passos, agendado_para, status) values ($1, '${celular}', ${passos}, now(), '${status}')`
    expect(await tentar(base('21 99999-0001', PASSOS))).toBe('recusou')
    expect(await tentar(base('5521999990001', `'[]'::jsonb`))).toBe('recusou')
    expect(await tentar(base('5521999990001', `'${JSON.stringify(Array(31).fill({ tipo: 'texto' }))}'::jsonb`))).toBe('recusou')
    expect(await tentar(base('5521999990001', PASSOS, 'enviando'))).toBe('recusou')
  })

  it('o dono vê e cancela os próprios', async () => {
    const { rows: [a] } = await inserir(contaA)
    const r = await db.como(donoA).query(`update public.envios_agendados set status = 'cancelado' where id = $1 returning id`, [a.id])
    expect(r.rows).toHaveLength(1)
  })

  it('o dono de OUTRA conta não vê, não altera e não apaga', async () => {
    await inserir(contaA)
    expect((await db.como(donoB).query(`select id from public.envios_agendados`)).rows).toHaveLength(0)
    expect((await db.como(donoB).query(`update public.envios_agendados set status = 'cancelado' returning id`)).rows).toHaveLength(0)
    expect((await db.como(donoB).query(`delete from public.envios_agendados returning id`)).rows).toHaveLength(0)
  })

  it('ninguém agenda em nome de outra conta', async () => {
    const r = await db.como(donoB).tentar(
      `insert into public.envios_agendados (conta_id, celular, passos, agendado_para) values ($1, '5521999990001', ${PASSOS}, now())`, [contaA])
    expect(r.ok).toBe(false)
  })

  it('apagar o cliente não apaga o agendamento: ele fica sem o vínculo', async () => {
    const { rows: [cli] } = await db.sql<{ id: string }>(
      `insert into public.clientes (conta_id, nome, celular) values ($1, 'Maria', '5521999990001') returning id`, [contaA])
    const { rows: [a] } = await inserir(contaA, ', cliente_id', `, '${cli.id}'`)
    await db.sql(`delete from public.clientes where id = $1`, [cli.id])
    const r = await db.sql(`select cliente_id from public.envios_agendados where id = $1`, [a.id])
    expect(r.rows).toEqual([{ cliente_id: null }])
  })
})
