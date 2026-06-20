---
name: supabase-rls
description: Regras de isolamento multi-tenant e Row Level Security (RLS) no Supabase deste projeto. Use SEMPRE que criar ou alterar tabela, migration, policy, query, server action, route handler ou qualquer acesso a banco. Garante que uma conta (tenant) NUNCA leia ou escreva dado de outra. Consulte antes de escrever qualquer SQL ou código que toque o banco.
---

# Supabase — Isolamento Multi-Tenant e RLS

> Sistema financeiro SaaS com múltiplas contas (tenants) no MESMO banco. Vazamento entre contas é **incidente crítico**, não bug comum. Estas regras vêm antes de qualquer otimização ou conveniência.

## 1. Conceito de tenant
- **1 conta = 1 empresa = 1 usuário (dono).** O tenant é a `conta`.
- O usuário autenticado (`auth.uid()`) mapeia para **uma** `conta` via `contas.owner_user_id`.
- Admin (você) é um papel separado, com acesso cross-tenant controlado (ver §5).

## 2. Regra inegociável: `conta_id` + RLS em TODA tabela de negócio
Toda tabela que guarda dado de cliente do SaaS **obrigatoriamente** tem:
- coluna `conta_id uuid not null references contas(id)`;
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
- `ALTER TABLE ... FORCE ROW LEVEL SECURITY;` (impede que o owner da tabela escape da policy);
- policies de SELECT/INSERT/UPDATE/DELETE filtrando por `conta_id`.

**Tabela sem RLS = trabalho rejeitado.** Não existe "depois eu coloco". A policy nasce junto com a tabela, na mesma migration.

## 3. Função helper de tenant
Crie uma função que resolve a conta do usuário logado e use em todas as policies:

```sql
create or replace function public.conta_do_usuario()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from public.contas where owner_user_id = auth.uid() limit 1;
$$;
```

## 4. Padrão de policy (replicar em cada tabela)

```sql
alter table public.clientes enable row level security;
alter table public.clientes force row level security;

create policy "tenant_select" on public.clientes
  for select using (conta_id = public.conta_do_usuario());

create policy "tenant_insert" on public.clientes
  for insert with check (conta_id = public.conta_do_usuario());

create policy "tenant_update" on public.clientes
  for update using (conta_id = public.conta_do_usuario())
              with check (conta_id = public.conta_do_usuario());

create policy "tenant_delete" on public.clientes
  for delete using (conta_id = public.conta_do_usuario());
```

- O `conta_id` **nunca** vem do cliente/front. É preenchido no servidor a partir de `conta_do_usuario()`. Nunca confiar em `conta_id` enviado pelo navegador.

## 5. Admin (cross-tenant) e service role
- **Service role key:** existe SÓ no servidor (worker, route handler, server action). **Nunca** no bundle do navegador, nunca em `NEXT_PUBLIC_*`. Service role ignora RLS — por isso é restrito ao backend e usado com parcimônia.
- **Painel Admin:** acesso a todas as contas é feito por papel admin no servidor, com auditoria. Toda ação admin sobre uma conta (inclusive **impersonação**) grava em `audit_log` (quem, qual conta, quando, o quê).
- O navegador do cliente usa **anon key** + sessão Supabase Auth; RLS faz o resto.

## 6. Unicidade por tenant (não global)
Campos "únicos" são únicos **dentro da conta**, não no banco todo:
```sql
-- CPF único por conta (não global): dois tenants podem ter o mesmo cliente
create unique index clientes_cpf_por_conta on public.clientes (conta_id, cpf) where deleted_at is null;
```
Aplicar o mesmo raciocínio a `local_part` de e-mail (único dentro do domínio compartilhado), etc.

## 7. Soft delete
- Exclusão de cliente é **soft delete** (`deleted_at`), preservando histórico financeiro.
- Policies/queries de listagem filtram `deleted_at is null`. Relatórios históricos ainda enxergam o registro.

## 8. Teste de isolamento (obrigatório no Sprint 1)
Escreva um teste automatizado que prova o isolamento, e rode-o sempre:
1. Cria conta A e conta B, cada uma com 1 cliente.
2. Autentica como A → consegue ler o cliente de A.
3. Autentica como A → **não** consegue ler nem alterar o cliente de B (retorno vazio / erro).
Se esse teste falhar ou não existir, a fundação não está pronta.

## 9. Antipadrões — NÃO fazer
- ❌ Query sem filtro de `conta_id` confiando "só no front".
- ❌ Tabela de negócio sem RLS.
- ❌ `conta_id` vindo do navegador.
- ❌ Service role no client / em `NEXT_PUBLIC_*`.
- ❌ Unicidade global onde deveria ser por conta.
- ❌ Excluir cliente apagando histórico financeiro (use soft delete).
- ❌ Ação de admin sem registro em `audit_log`.
