// Migration 0038 (disparo progressivo + registro de quem já recebeu), no Postgres real com as
// migrations do projeto: regras do banco e isolamento de contatos_disparados entre contas.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criarBanco, criarConta, type BancoTeste } from './helpers/pg-supabase'

let db: BancoTeste
let contaA: string, contaB: string, donoA: string, donoB: string

const inserirCampanha = (conta: string, extra = '', valores = '') =>
  db.sql<{ id: string }>(
    `insert into public.campanhas_wa (conta_id, nome${extra}) values ($1, 'Teste'${valores}) returning id`, [conta])

beforeAll(async () => {
  db = await criarBanco()
  ;({ contaId: contaA, donoId: donoA } = await criarConta(db, 'A'))
  ;({ contaId: contaB, donoId: donoB } = await criarConta(db, 'B'))
  await db.sql(`insert into public.contatos_disparados (conta_id, celular, nome) values ($1, '5521999990001', 'Maria')`, [contaA])
})
afterAll(() => db.fechar())

describe('campanhas_wa depois da 0038', () => {
  it('campanha antiga (sem informar nada) continua sendo "normal", sem registro ligado', async () => {
    const { rows } = await db.sql<{ id: string }>(`insert into public.campanhas_wa (conta_id, nome) values ($1, 'Antiga') returning id`, [contaA])
    const r = await db.sql(`select tipo, registrar_enviados, excluir_ja_enviados, prog_dia from public.campanhas_wa where id = $1`, [rows[0].id])
    expect(r.rows[0]).toEqual({ tipo: 'normal', registrar_enviados: false, excluir_ja_enviados: false, prog_dia: 0 })
  })

  it('progressivo completo é aceito', async () => {
    const r = await inserirCampanha(contaA,
      ', tipo, mensagem, janela_inicio, janela_fim, prog_inicio, prog_maximo',
      `, 'progressivo', 'Oi {{nome}}', '09:00', '18:00', 1, 20`)
    expect(r.rows).toHaveLength(1)
  })

  it('o banco recusa progressivo sem janela, com janela invertida ou com máximo menor que o início', async () => {
    const tentar = (cols: string, vals: string) => inserirCampanha(contaA, cols, vals).then(() => 'aceitou', () => 'recusou')
    expect(await tentar(', tipo, mensagem, prog_inicio, prog_maximo', `, 'progressivo', 'Oi', 1, 20`)).toBe('recusou')
    expect(await tentar(', tipo, mensagem, janela_inicio, janela_fim, prog_inicio, prog_maximo', `, 'progressivo', 'Oi', '18:00', '09:00', 1, 20`)).toBe('recusou')
    expect(await tentar(', tipo, mensagem, janela_inicio, janela_fim, prog_inicio, prog_maximo', `, 'progressivo', 'Oi', '09:00', '18:00', 10, 5`)).toBe('recusou')
  })

  it('aceita o status "pausada" e o destinatário "pulado"', async () => {
    const { rows } = await inserirCampanha(contaA)
    await db.sql(`update public.campanhas_wa set status = 'pausada' where id = $1`, [rows[0].id])
    const d = await db.sql(
      `insert into public.campanha_destinatarios (campanha_id, conta_id, celular, status) values ($1, $2, '5521999990009', 'pulado') returning status`,
      [rows[0].id, contaA])
    expect(d.rows).toEqual([{ status: 'pulado' }])
  })
})

describe('0039: sequência de mensagens, etiquetas e bucket de mídia', () => {
  it('progressivo só com passos (sem mensagem) é aceito', async () => {
    const r = await inserirCampanha(contaA,
      ', tipo, passos, janela_inicio, janela_fim, prog_inicio, prog_maximo, etiqueta_adicionar',
      `, 'progressivo', '[{"tipo":"texto","texto":"Oi","variacoes":[],"digitacao_seg":20}]'::jsonb, '09:00', '18:00', 1, 20, 'L1'`)
    expect(r.rows).toHaveLength(1)
  })

  it('o banco recusa passos vazios, que não sejam lista ou com mais de 10 mensagens', async () => {
    const tentar = (passos: string) => inserirCampanha(contaA, ', passos', `, '${passos}'::jsonb`).then(() => 'aceitou', () => 'recusou')
    expect(await tentar('[]')).toBe('recusou')
    expect(await tentar('{"tipo":"texto"}')).toBe('recusou')
    expect(await tentar(JSON.stringify(Array(11).fill({ tipo: 'texto' })))).toBe('recusou')
  })

  it('progressivo sem mensagem e sem passos continua recusado', async () => {
    const r = await inserirCampanha(contaA, ', tipo, janela_inicio, janela_fim, prog_inicio, prog_maximo', `, 'progressivo', '09:00', '18:00', 1, 20`)
      .then(() => 'aceitou', () => 'recusou')
    expect(r).toBe('recusou')
  })

  it('o bucket das mídias existe e é PRIVADO', async () => {
    const { rows } = await db.sql<{ public: boolean }>(`select public from storage.buckets where id = 'disparo-midia'`)
    expect(rows).toEqual([{ public: false }])
  })
})

describe('0040: modelo com sequência de mensagens', () => {
  const inserirModelo = (passos: string | null) => db.sql<{ id: string }>(
    `insert into public.modelos_wa (conta_id, nome, corpo, passos) values ($1, 'M', 'Oi', ${passos === null ? 'null' : `'${passos}'::jsonb`}) returning id`, [contaA])

  it('aceita modelo com sequência e modelo antigo sem ela', async () => {
    expect((await inserirModelo('[{"tipo":"texto","texto":"Oi","variacoes":[],"digitacao_seg":20}]')).rows).toHaveLength(1)
    expect((await inserirModelo(null)).rows).toHaveLength(1)
  })

  it('recusa sequência vazia, que não seja lista ou com mais de 10 mensagens', async () => {
    const tentar = (p: string) => inserirModelo(p).then(() => 'aceitou', () => 'recusou')
    expect(await tentar('[]')).toBe('recusou')
    expect(await tentar('{"tipo":"texto"}')).toBe('recusou')
    expect(await tentar(JSON.stringify(Array(11).fill({ tipo: 'texto' })))).toBe('recusou')
  })

  it('excluir o modelo não é barrado pelos disparos que o usaram: eles ficam sem o vínculo', async () => {
    const { rows: [m] } = await inserirModelo(null)
    const { rows: [c] } = await inserirCampanha(contaA, ', modelo_id', `, '${m.id}'`)
    await db.sql(`delete from public.modelos_wa where id = $1`, [m.id])
    const r = await db.sql(`select modelo_id from public.campanhas_wa where id = $1`, [c.id])
    expect(r.rows).toEqual([{ modelo_id: null }])
  })

  it('o dono de outra conta não vê nem altera os modelos', async () => {
    await inserirModelo(null)
    expect((await db.como(donoB).query(`select id from public.modelos_wa`)).rows).toHaveLength(0)
    expect((await db.como(donoB).query(`update public.modelos_wa set nome = 'x' returning id`)).rows).toHaveLength(0)
  })
})

describe('contatos_disparados', () => {
  it('o dono vê os números da própria conta', async () => {
    const r = await db.como(donoA).query(`select celular, nome from public.contatos_disparados`)
    expect(r.rows).toEqual([{ celular: '5521999990001', nome: 'Maria' }])
  })

  it('o dono de OUTRA conta não vê, não altera e não apaga', async () => {
    expect((await db.como(donoB).query(`select id from public.contatos_disparados`)).rows).toHaveLength(0)
    const upd = await db.como(donoB).query(`update public.contatos_disparados set nome = 'x' returning id`)
    expect(upd.rows).toHaveLength(0)
    const del = await db.como(donoB).query(`delete from public.contatos_disparados returning id`)
    expect(del.rows).toHaveLength(0)
  })

  it('ninguém insere registro em nome de outra conta', async () => {
    const r = await db.como(donoB).tentar(
      `insert into public.contatos_disparados (conta_id, celular) values ($1, '5521999990002')`, [contaA])
    expect(r.ok).toBe(false)
  })

  it('o mesmo número pode estar registrado em duas contas (unicidade é por conta)', async () => {
    const r = await db.sql(`insert into public.contatos_disparados (conta_id, celular) values ($1, '5521999990001') returning id`, [contaB])
    expect(r.rows).toHaveLength(1)
  })

  it('dentro da mesma conta o número é único', async () => {
    const r = await db.sql(`insert into public.contatos_disparados (conta_id, celular) values ($1, '5521999990001')`, [contaA])
      .then(() => 'aceitou', () => 'recusou')
    expect(r).toBe('recusou')
  })
})
