// Papéis dentro de uma conta (dono / admin / atendente), provados no Postgres com as
// migrations reais. Achado SEG-N4 (auditoria 2026-09-19): a migration 0020 fez
// conta_do_usuario() valer também para membros e as policies de configuracoes e
// membros_conta só checam isso — então um atendente lia e alterava as credenciais da
// conta (inclusive as do EfiBank, desviando PIX) e podia se promover a admin pela API.
// O papel só era conferido na interface e na action de /equipe. Mesma classe de risco:
// meios_pagamento (o texto da chave PIX que vai para o cliente).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adicionarMembro, criarBanco, criarConta, criarEquipe, type BancoTeste } from './helpers/pg-supabase'

let db: BancoTeste
let contaA: string, contaB: string
let donoA: string, donoB: string, adminA: string, atendenteA: string

// Usuário do auth ainda sem vínculo com nenhuma conta (alvo de convite).
const criarConvidado = async () =>
  (await db.sql<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [`convidado-${Math.random()}@teste.local`])).rows[0].id

beforeAll(async () => {
  db = await criarBanco()
  ;({ contaId: contaA, donoId: donoA } = await criarConta(db, 'A'))
  ;({ contaId: contaB, donoId: donoB } = await criarConta(db, 'B'))
  adminA = await adicionarMembro(db, contaA, 'admin')
  atendenteA = await adicionarMembro(db, contaA, 'atendente')

  await db.sql(
    `insert into public.configuracoes (conta_id, efi_client_id, efi_client_secret, efi_pix_key, ld_password)
     values ($1, 'CLIENTID-A', 'EFISECRET-A', 'chave-pix-A', 'SENHA-LD-A'),
            ($2, 'CLIENTID-B', 'EFISECRET-B', 'chave-pix-B', 'SENHA-LD-B')`,
    [contaA, contaB],
  )
  await db.sql(
    `insert into public.clientes (conta_id, nome, celular) values ($1, 'Cliente A', '5521900000001')`,
    [contaA],
  )
  await db.sql(
    `insert into public.meios_pagamento (conta_id, nome, mensagem, is_padrao) values ($1, 'Pix A', 'chave-pix-da-conta-A', true)`,
    [contaA],
  )
})
afterAll(() => db.fechar())

const lerSegredos = (usuario: string) =>
  db.como(usuario).query<{ efi_client_id: string; efi_client_secret: string }>(
    `select efi_client_id, efi_client_secret from public.configuracoes where conta_id = $1`, [contaA])

describe('credenciais da conta (configuracoes)', () => {
  it('o dono lê as credenciais', async () => {
    expect((await lerSegredos(donoA)).rows).toEqual([{ efi_client_id: 'CLIENTID-A', efi_client_secret: 'EFISECRET-A' }])
  })

  it('um administrador da equipe lê as credenciais', async () => {
    expect((await lerSegredos(adminA)).rows).toHaveLength(1)
  })

  it('um ATENDENTE não lê as credenciais da conta', async () => {
    expect((await lerSegredos(atendenteA)).rows).toHaveLength(0)
  })

  it('o dono e o administrador conseguem alterar as credenciais', async () => {
    for (const usuario of [donoA, adminA]) {
      const r = await db.como(usuario).query(
        `update public.configuracoes set efi_pix_key = 'nova-chave' where conta_id = $1 returning conta_id`, [contaA])
      expect(r.rows).toHaveLength(1)
    }
  })

  it('um ATENDENTE não consegue trocar a chave PIX / credenciais (desvio de pagamentos)', async () => {
    const r = await db.como(atendenteA).tentar(
      `update public.configuracoes set efi_pix_key = 'chave-do-atacante', efi_client_secret = 'x' where conta_id = $1 returning conta_id`, [contaA])
    expect(r.ok ? r.rows : []).toHaveLength(0)
    const { rows } = await db.sql<{ efi_client_secret: string }>(`select efi_client_secret from public.configuracoes where conta_id = $1`, [contaA])
    expect(rows[0].efi_client_secret).toBe('EFISECRET-A')
  })

  it('um ATENDENTE não consegue criar/recriar a linha de configuração (upsert)', async () => {
    const r = await db.como(atendenteA).tentar(
      `insert into public.configuracoes (conta_id, efi_client_secret) values ($1, 'x')
       on conflict (conta_id) do update set efi_client_secret = excluded.efi_client_secret returning conta_id`, [contaA])
    expect(r.ok ? r.rows : []).toHaveLength(0)
  })

  it('o dono de OUTRA conta não enxerga nem altera', async () => {
    expect((await lerSegredos(donoB)).rows).toHaveLength(0)
    const r = await db.como(donoB).query(`update public.configuracoes set efi_pix_key = 'x' where conta_id = $1 returning conta_id`, [contaA])
    expect(r.rows).toHaveLength(0)
  })
})

describe('equipe (membros_conta)', () => {
  const papelDe = async (userId: string) =>
    (await db.sql<{ role: string }>(`select role from public.membros_conta where user_id = $1`, [userId])).rows[0]?.role

  it('todos os membros da conta conseguem LISTAR a equipe (o atendimento precisa disso)', async () => {
    for (const usuario of [donoA, adminA, atendenteA]) {
      const r = await db.como(usuario).query(`select user_id from public.membros_conta where conta_id = $1`, [contaA])
      expect(r.rows.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('um ATENDENTE não consegue se promover a administrador', async () => {
    const eq = await criarEquipe(db, 'promocao')
    const r = await db.como(eq.atendenteId).tentar(
      `update public.membros_conta set role = 'admin' where user_id = $1 returning role`, [eq.atendenteId])
    expect(r.ok ? r.rows : []).toHaveLength(0)
    expect(await papelDe(eq.atendenteId)).toBe('atendente')
  })

  it('um ATENDENTE não consegue cadastrar membro (nem ele mesmo de novo) como admin', async () => {
    const eq = await criarEquipe(db, 'cadastro')
    const r = await db.como(eq.atendenteId).tentar(
      `insert into public.membros_conta (conta_id, user_id, nome, email, role)
       values ($1, $2, 'Intruso', 'intruso@teste.local', 'admin')`, [eq.contaId, eq.atendenteId])
    expect(r.ok).toBe(false)
  })

  it('um ATENDENTE não consegue remover nem desativar outros membros', async () => {
    const eq = await criarEquipe(db, 'remocao')
    const del = await db.como(eq.atendenteId).tentar(`delete from public.membros_conta where user_id = $1 returning user_id`, [eq.adminId])
    expect(del.ok ? del.rows : []).toHaveLength(0)
    const upd = await db.como(eq.atendenteId).tentar(`update public.membros_conta set ativo = false where user_id = $1 returning user_id`, [eq.adminId])
    expect(upd.ok ? upd.rows : []).toHaveLength(0)
    const { rows } = await db.sql<{ ativo: boolean }>(`select ativo from public.membros_conta where user_id = $1`, [eq.adminId])
    expect(rows[0].ativo).toBe(true)
  })

  it('o dono e o administrador conseguem gerenciar a equipe', async () => {
    const eq = await criarEquipe(db, 'gestao')
    for (const gerente of [eq.donoId, eq.adminId]) {
      const novo = await adicionarMembro(db, eq.contaId, 'atendente', `novo-${gerente.slice(0, 6)}`)
      const r = await db.como(gerente).query(`update public.membros_conta set ativo = false where user_id = $1 returning user_id`, [novo])
      expect(r.rows).toHaveLength(1)
    }
  })

  it('o dono e o administrador conseguem convidar (inserir) membros', async () => {
    const eq = await criarEquipe(db, 'convite')
    for (const gerente of [eq.donoId, eq.adminId]) {
      const convidado = await criarConvidado()
      const r = await db.como(gerente).tentar(
        `insert into public.membros_conta (conta_id, user_id, nome, email, role)
         values ($1, $2, 'Convidado', $3, 'atendente') returning user_id`, [eq.contaId, convidado, `${convidado}@teste.local`])
      expect(r.ok).toBe(true)
    }
  })

  it('ninguém de fora da conta mexe na equipe dela', async () => {
    const r = await db.como(donoB).tentar(`update public.membros_conta set role = 'admin' where user_id = $1 returning user_id`, [atendenteA])
    expect(r.ok ? r.rows : []).toHaveLength(0)
  })
})

describe('meios de pagamento (o texto da chave PIX enviado ao cliente)', () => {
  const lerMeio = () => db.sql<{ mensagem: string }>(`select mensagem from public.meios_pagamento where conta_id = $1`, [contaA])

  it('todos os membros leem (a cobrança precisa escolher o meio)', async () => {
    for (const usuario of [donoA, adminA, atendenteA]) {
      const r = await db.como(usuario).query(`select mensagem from public.meios_pagamento where conta_id = $1`, [contaA])
      expect(r.rows).toEqual([{ mensagem: 'chave-pix-da-conta-A' }])
    }
  })

  it('um ATENDENTE não consegue trocar a chave PIX que vai para o cliente', async () => {
    const r = await db.como(atendenteA).tentar(
      `update public.meios_pagamento set mensagem = 'pix-do-atacante' where conta_id = $1 returning id`, [contaA])
    expect(r.ok ? r.rows : []).toHaveLength(0)
    expect((await lerMeio()).rows[0].mensagem).toBe('chave-pix-da-conta-A')
  })

  it('um ATENDENTE não consegue criar nem apagar meios de pagamento', async () => {
    const ins = await db.como(atendenteA).tentar(
      `insert into public.meios_pagamento (conta_id, nome, mensagem) values ($1, 'Pix falso', 'pix-do-atacante')`, [contaA])
    expect(ins.ok).toBe(false)
    const del = await db.como(atendenteA).tentar(`delete from public.meios_pagamento where conta_id = $1 returning id`, [contaA])
    expect(del.ok ? del.rows : []).toHaveLength(0)
    expect((await lerMeio()).rows).toHaveLength(1)
  })

  it('o dono e o administrador conseguem gerenciar', async () => {
    for (const usuario of [donoA, adminA]) {
      const r = await db.como(usuario).query(
        `update public.meios_pagamento set nome = $2 where conta_id = $1 returning id`, [contaA, `Pix (${usuario.slice(0, 4)})`])
      expect(r.rows).toHaveLength(1)
    }
  })

  it('o dono de OUTRA conta não altera', async () => {
    const r = await db.como(donoB).query(`update public.meios_pagamento set mensagem = 'x' where conta_id = $1 returning id`, [contaA])
    expect(r.rows).toHaveLength(0)
  })
})

describe('o atendente continua conseguindo trabalhar (nada foi restringido além do necessário)', () => {
  it('lê os clientes da própria conta', async () => {
    const r = await db.como(atendenteA).query(`select nome from public.clientes where conta_id = $1`, [contaA])
    expect(r.rows).toEqual([{ nome: 'Cliente A' }])
  })

  it('abre e atualiza atendimentos da própria conta', async () => {
    const criado = await db.como(atendenteA).query(
      `insert into public.atendimentos (conta_id, celular, status) values ($1, '5521900000009', 'aguardando') returning id`, [contaA])
    expect(criado.rows).toHaveLength(1)
    const upd = await db.como(atendenteA).query(
      `update public.atendimentos set status = 'em_atendimento', atendente_id = $2 where id = $1 returning id`, [criado.rows[0].id, atendenteA])
    expect(upd.rows).toHaveLength(1)
  })
})
