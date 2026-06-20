-- =====================================================================
-- Sistema de Cobranças — Schema inicial Supabase (Postgres)
-- Multi-tenant com RLS. Fundação do Sprint 1.
-- Princípio: nenhuma conta lê/escreve dado de outra. Dinheiro é exato (numeric, nunca float).
-- Rodar no SQL Editor do Supabase OU como migration (supabase/migrations/0001_init.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. EXTENSÕES E TIPOS
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

do $$ begin
  create type conta_status        as enum ('ativa','suspensa','expirada');
  create type assinatura_status    as enum ('ativa','pendente','cancelada','inadimplente');
  create type cobranca_status      as enum ('ativa','concluida','cancelada');
  create type parcela_status       as enum ('aberta','paga','vencida');
  create type notif_tipo           as enum ('5d','3d','2d','1d','dia','vencido1d','manual','boasvindas');
  create type notif_canal          as enum ('whatsapp','email');
  create type notif_status         as enum ('fila','enviado','entregue','lido','aberto','falhou','cancelado');
  create type conexao_status       as enum ('conectado','desconectado','conectando');
  create type lancamento_tipo      as enum ('entrada','saida');
  create type lancamento_origem    as enum ('parcela','manual');
  create type meio_pagamento_tipo  as enum ('pix','outro');
  create type email_modo           as enum ('compartilhado','proprio');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 1. UTILITÁRIOS: updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ---------------------------------------------------------------------
-- 2. ADMIN DA PLATAFORMA (você) + CONFIG GLOBAL
-- ---------------------------------------------------------------------
create table public.plataforma_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.plataforma_config (
  id                      int primary key default 1,
  dominio_email_operador  text,                 -- ex.: cobranca.suaplataforma.com.br (autenticado 1x no Resend)
  updated_at              timestamptz not null default now(),
  constraint singleton check (id = 1)
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.plataforma_admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- 3. CONTAS (tenant) + função de resolução de tenant
-- ---------------------------------------------------------------------
create table public.contas (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null unique references auth.users(id) on delete restrict,
  nome_empresa    text not null,
  status          conta_status not null default 'ativa',
  validade_plano  date,
  limite_clientes int  not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_contas_upd before update on public.contas
  for each row execute function public.set_updated_at();

-- Resolve a conta do usuário logado. Base de TODAS as policies.
create or replace function public.conta_do_usuario()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.contas where owner_user_id = auth.uid() limit 1;
$$;

-- ---------------------------------------------------------------------
-- 4. TABELAS DE NEGÓCIO (todas com conta_id + RLS)
-- ---------------------------------------------------------------------

-- 4.1 Assinatura do SaaS (fluxo A — Mercado Pago)
create table public.assinaturas (
  id                 uuid primary key default gen_random_uuid(),
  conta_id           uuid not null references public.contas(id) on delete cascade,
  mp_preapproval_id  text,
  status             assinatura_status not null default 'pendente',
  valor              numeric(12,2),
  proximo_vencimento date,
  ultimo_evento_mp   jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_assinaturas_upd before update on public.assinaturas
  for each row execute function public.set_updated_at();

-- 4.2 Configurações da empresa (1 por conta)
create table public.configuracoes (
  conta_id          uuid primary key references public.contas(id) on delete cascade,
  nome_comercial    text,
  cpf_cnpj          text,
  endereco          text,
  contato           text,
  horario_inicio    time not null default '09:00',
  horario_fim       time not null default '20:00',
  intervalo_min_seg int  not null default 45,
  intervalo_max_seg int  not null default 80,
  updated_at        timestamptz not null default now(),
  constraint chk_intervalo check (intervalo_min_seg >= 1 and intervalo_max_seg >= intervalo_min_seg),
  constraint chk_janela    check (horario_fim > horario_inicio)
);
create trigger trg_config_upd before update on public.configuracoes
  for each row execute function public.set_updated_at();

-- 4.3 Remetente de e-mail (local_part por conta; modo proprio = gancho futuro)
create table public.email_remetente (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null unique references public.contas(id) on delete cascade,
  local_part      text not null,                  -- só [a-z0-9.-]; sistema sanitiza
  from_name       text,
  modo            email_modo not null default 'compartilhado',
  -- campos reservados p/ modo 'proprio' (NÃO usar no MVP):
  dominio_proprio text,
  resend_domain_id text,
  status_dominio  text,
  registros_dns   jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint chk_local_part check (local_part ~ '^[a-z0-9][a-z0-9.-]*$')
);
create trigger trg_email_rem_upd before update on public.email_remetente
  for each row execute function public.set_updated_at();
-- local_part único dentro do domínio compartilhado:
create unique index uq_local_part_compartilhado
  on public.email_remetente (local_part) where modo = 'compartilhado';

-- 4.4 Saudações (variações do #SAUDACAO#)
create table public.saudacoes (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references public.contas(id) on delete cascade,
  texto      text not null,
  created_at timestamptz not null default now()
);

-- 4.5 Meios de pagamento (Pix; is_padrao alimenta #PIX#)
create table public.meios_pagamento (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references public.contas(id) on delete cascade,
  tipo       meio_pagamento_tipo not null default 'pix',
  nome       text not null,
  mensagem   text not null,           -- texto da chave/instrução Pix
  is_padrao  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_meios_upd before update on public.meios_pagamento
  for each row execute function public.set_updated_at();
-- no máximo 1 padrão por conta:
create unique index uq_meio_padrao_por_conta
  on public.meios_pagamento (conta_id) where is_padrao = true;

-- 4.6 Clientes
create table public.clientes (
  id         uuid primary key default gen_random_uuid(),
  conta_id   uuid not null references public.contas(id) on delete cascade,
  nome       text not null,
  sobrenome  text not null,
  celular    text not null,           -- normalizado 55+DDD+numero
  cpf        text not null,           -- só dígitos, validado na aplicação
  email      text not null,
  deleted_at timestamptz,             -- soft delete
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_clientes_upd before update on public.clientes
  for each row execute function public.set_updated_at();
-- CPF único POR CONTA (não global), ignorando deletados:
create unique index uq_cliente_cpf_por_conta
  on public.clientes (conta_id, cpf) where deleted_at is null;
create index idx_clientes_conta on public.clientes (conta_id) where deleted_at is null;

-- 4.7 Cobranças (contrato-pai)
create table public.cobrancas (
  id                    uuid primary key default gen_random_uuid(),
  conta_id              uuid not null references public.contas(id) on delete cascade,
  cliente_id            uuid not null references public.clientes(id) on delete restrict,
  valor_mensalidade     numeric(12,2) not null,
  qtd_parcelas          int,                       -- ignorado se recorrente
  recorrente            boolean not null default false,
  dia_pagamento         int not null,              -- 1..31
  data_primeiro_pagamento date not null,
  observacao            text,
  enviar_boas_vindas    boolean not null default false,
  status                cobranca_status not null default 'ativa',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint chk_dia_pagamento check (dia_pagamento between 1 and 31),
  constraint chk_valor_pos     check (valor_mensalidade > 0)
);
create trigger trg_cobrancas_upd before update on public.cobrancas
  for each row execute function public.set_updated_at();
create index idx_cobrancas_conta on public.cobrancas (conta_id);
create index idx_cobrancas_cliente on public.cobrancas (cliente_id);

-- 4.8 Parcelas (mensalidades)
create table public.parcelas (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references public.contas(id) on delete cascade,
  cobranca_id     uuid not null references public.cobrancas(id) on delete cascade,
  numero          int not null,
  valor           numeric(12,2) not null,          -- override editável por parcela
  data_vencimento date not null,
  status          parcela_status not null default 'aberta',
  data_pagamento  date,
  observacao      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint chk_parcela_valor check (valor > 0)
);
create trigger trg_parcelas_upd before update on public.parcelas
  for each row execute function public.set_updated_at();
create index idx_parcelas_conta on public.parcelas (conta_id);
create index idx_parcelas_cobranca on public.parcelas (cobranca_id);
-- consultas por vencimento/status alimentam scheduler e indicadores:
create index idx_parcelas_venc_status on public.parcelas (conta_id, data_vencimento, status);

-- 4.9 Configuração de notificações (8 tipos por conta, conteúdo por canal)
create table public.notificacoes_config (
  id                uuid primary key default gen_random_uuid(),
  conta_id          uuid not null references public.contas(id) on delete cascade,
  tipo              notif_tipo not null,
  horario           time not null default '10:00',
  ativo_whatsapp    boolean not null default false,
  template_whatsapp text,
  ativo_email       boolean not null default false,
  assunto_email     text,
  template_email    text,
  updated_at        timestamptz not null default now(),
  unique (conta_id, tipo)
);
create trigger trg_notif_cfg_upd before update on public.notificacoes_config
  for each row execute function public.set_updated_at();

-- 4.10 Notificações enviadas (idempotência + base do Log)
create table public.notificacoes_enviadas (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references public.contas(id) on delete cascade,
  parcela_id    uuid references public.parcelas(id) on delete cascade,  -- null p/ boasvindas/manual
  cliente_id    uuid not null references public.clientes(id) on delete cascade,
  tipo          notif_tipo not null,
  canal         notif_canal not null,
  mensagem_final text,
  status        notif_status not null default 'fila',
  agendado_para timestamptz,
  enviado_em    timestamptz,
  created_at    timestamptz not null default now()
);
-- IDEMPOTÊNCIA: nunca duplicar o mesmo tipo no mesmo canal p/ a mesma parcela:
create unique index uq_notif_idempotencia
  on public.notificacoes_enviadas (parcela_id, tipo, canal)
  where parcela_id is not null;
create index idx_notif_conta_data on public.notificacoes_enviadas (conta_id, created_at);
create index idx_notif_fila on public.notificacoes_enviadas (status, agendado_para) where status = 'fila';

-- 4.11 Conexão WhatsApp (Baileys — 1 por conta)
create table public.conexoes (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid not null unique references public.contas(id) on delete cascade,
  status           conexao_status not null default 'desconectado',
  numero_conectado text,
  device_name      text,
  session_ref      text,                  -- referência à sessão persistida (segura, server-side)
  ultima_conexao   timestamptz,
  updated_at       timestamptz not null default now()
);
create trigger trg_conexoes_upd before update on public.conexoes
  for each row execute function public.set_updated_at();

-- 4.12 Lançamentos (caixa — Dashboard Entradas/Saídas)
create table public.lancamentos (
  id          uuid primary key default gen_random_uuid(),
  conta_id    uuid not null references public.contas(id) on delete cascade,
  tipo        lancamento_tipo not null,
  origem      lancamento_origem not null,
  parcela_id  uuid references public.parcelas(id) on delete set null,
  valor       numeric(12,2) not null,
  data        date not null default current_date,
  descricao   text,
  created_at  timestamptz not null default now(),
  constraint chk_lanc_valor check (valor > 0)
);
create index idx_lancamentos_conta_data on public.lancamentos (conta_id, data);

-- 4.13 Auditoria (impersonação e ações admin)
create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor         text not null,            -- 'admin' | 'conta'
  actor_id      uuid,
  acao          text not null,
  conta_id_alvo uuid references public.contas(id) on delete set null,
  detalhe       jsonb,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. RLS — habilitar + forçar em TODAS as tabelas de negócio
-- ---------------------------------------------------------------------
alter table public.contas                enable row level security;
alter table public.contas                force  row level security;
alter table public.assinaturas           enable row level security;
alter table public.assinaturas           force  row level security;
alter table public.configuracoes         enable row level security;
alter table public.configuracoes         force  row level security;
alter table public.email_remetente       enable row level security;
alter table public.email_remetente       force  row level security;
alter table public.saudacoes             enable row level security;
alter table public.saudacoes             force  row level security;
alter table public.meios_pagamento       enable row level security;
alter table public.meios_pagamento       force  row level security;
alter table public.clientes              enable row level security;
alter table public.clientes              force  row level security;
alter table public.cobrancas             enable row level security;
alter table public.cobrancas             force  row level security;
alter table public.parcelas              enable row level security;
alter table public.parcelas              force  row level security;
alter table public.notificacoes_config   enable row level security;
alter table public.notificacoes_config   force  row level security;
alter table public.notificacoes_enviadas enable row level security;
alter table public.notificacoes_enviadas force  row level security;
alter table public.conexoes              enable row level security;
alter table public.conexoes              force  row level security;
alter table public.lancamentos           enable row level security;
alter table public.lancamentos           force  row level security;
alter table public.plataforma_admins     enable row level security;
alter table public.plataforma_admins     force  row level security;
alter table public.plataforma_config     enable row level security;
alter table public.plataforma_config     force  row level security;
alter table public.audit_log             enable row level security;
alter table public.audit_log             force  row level security;

-- ---------------------------------------------------------------------
-- 6. POLICIES
-- Padrão tenant: dono da conta acessa só o que tem conta_id = conta_do_usuario().
-- Admin: acesso total (is_admin()). Service role (worker) ignora RLS por natureza.
-- ---------------------------------------------------------------------

-- 6.1 contas: dono vê/edita a própria; admin tudo
create policy contas_owner_sel on public.contas for select
  using (owner_user_id = auth.uid() or public.is_admin());
create policy contas_admin_all on public.contas for all
  using (public.is_admin()) with check (public.is_admin());
create policy contas_owner_upd on public.contas for update
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- 6.2 Helper: macro de policy por tenant aplicada tabela a tabela.
-- (Postgres não tem "for each table"; replicamos o bloco abaixo.)

-- assinaturas (dono lê; admin gerencia)
create policy assin_sel on public.assinaturas for select
  using (conta_id = public.conta_do_usuario() or public.is_admin());
create policy assin_admin_all on public.assinaturas for all
  using (public.is_admin()) with check (public.is_admin());

-- configuracoes
create policy cfg_sel on public.configuracoes for select
  using (conta_id = public.conta_do_usuario() or public.is_admin());
create policy cfg_ins on public.configuracoes for insert
  with check (conta_id = public.conta_do_usuario());
create policy cfg_upd on public.configuracoes for update
  using (conta_id = public.conta_do_usuario()) with check (conta_id = public.conta_do_usuario());

-- email_remetente
create policy email_sel on public.email_remetente for select
  using (conta_id = public.conta_do_usuario() or public.is_admin());
create policy email_ins on public.email_remetente for insert
  with check (conta_id = public.conta_do_usuario());
create policy email_upd on public.email_remetente for update
  using (conta_id = public.conta_do_usuario()) with check (conta_id = public.conta_do_usuario());

-- saudacoes
create policy saud_all on public.saudacoes for all
  using (conta_id = public.conta_do_usuario()) with check (conta_id = public.conta_do_usuario());

-- meios_pagamento
create policy meios_all on public.meios_pagamento for all
  using (conta_id = public.conta_do_usuario()) with check (conta_id = public.conta_do_usuario());

-- clientes
create policy cli_all on public.clientes for all
  using (conta_id = public.conta_do_usuario()) with check (conta_id = public.conta_do_usuario());

-- cobrancas
create policy cob_all on public.cobrancas for all
  using (conta_id = public.conta_do_usuario()) with check (conta_id = public.conta_do_usuario());

-- parcelas
create policy parc_all on public.parcelas for all
  using (conta_id = public.conta_do_usuario()) with check (conta_id = public.conta_do_usuario());

-- notificacoes_config
create policy ncfg_all on public.notificacoes_config for all
  using (conta_id = public.conta_do_usuario()) with check (conta_id = public.conta_do_usuario());

-- notificacoes_enviadas (dono lê o Log; escrita é do worker via service role)
create policy nenv_sel on public.notificacoes_enviadas for select
  using (conta_id = public.conta_do_usuario() or public.is_admin());

-- conexoes
create policy conx_all on public.conexoes for all
  using (conta_id = public.conta_do_usuario()) with check (conta_id = public.conta_do_usuario());

-- lancamentos
create policy lanc_all on public.lancamentos for all
  using (conta_id = public.conta_do_usuario()) with check (conta_id = public.conta_do_usuario());

-- plataforma_admins / config / audit_log: só admin
create policy padm_all on public.plataforma_admins for all
  using (public.is_admin()) with check (public.is_admin());
create policy pcfg_all on public.plataforma_config for all
  using (public.is_admin()) with check (public.is_admin());
create policy audit_sel on public.audit_log for select
  using (public.is_admin());

-- =====================================================================
-- NOTAS DE OPERAÇÃO
-- - O worker (VPS) usa SERVICE ROLE e por isso ignora RLS: é ele quem
--   escreve notificacoes_enviadas, atualiza status Baileys/Resend e gera
--   parcelas. Manter a service key SOMENTE no servidor (.env), nunca no client.
-- - conta_id NUNCA vem do navegador: a aplicação preenche via conta_do_usuario().
-- - Provisionar admin: insert em plataforma_admins (user_id do seu auth user).
-- - Teste de isolamento (obrigatório Sprint 1): logar como conta A não pode
--   ler/alterar dado da conta B. Escrever e rodar esse teste.
-- =====================================================================
