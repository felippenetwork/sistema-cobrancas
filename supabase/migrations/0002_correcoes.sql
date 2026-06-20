-- =====================================================================
-- Sistema de Cobranças — Migration 0002: correções e ajustes
-- Aplica os achados da análise pré-Sprint 1 (B1–B7) + ajustes A1 e A4.
-- Rodar DEPOIS de 0001_schema_inicial.sql.
-- Stack: Supabase (Postgres) + Vercel (app) + Vortexus (worker Baileys/fila).
-- =====================================================================

-- ---------------------------------------------------------------------
-- B1 [CRÍTICO] — Remover policy que deixava o tenant editar status,
-- validade_plano e limite_clientes da própria conta (escalada de privilégio).
-- Edição de nome_empresa pelo tenant passa a ser feita por Server Action
-- (campos explícitos), nunca via UPDATE direto do client.
-- ---------------------------------------------------------------------
drop policy if exists contas_owner_upd on public.contas;

-- (Sem policy de UPDATE para o tenant. O dono SELECT a própria conta via
--  contas_owner_sel; alterações vão por Server Action no servidor.
--  Admin continua com contas_admin_all.)

-- ---------------------------------------------------------------------
-- A1 — dia_pagamento prevalece sempre. data_primeiro_pagamento servia só
-- para definir mês/ano de início → renomeada para mes_ano_inicio (date,
-- por convenção use o 1º dia do mês). Remove a redundância de "dois dias".
-- ---------------------------------------------------------------------
alter table public.cobrancas
  rename column data_primeiro_pagamento to mes_ano_inicio;
comment on column public.cobrancas.mes_ano_inicio is
  'Mês/ano de início da cobrança (use dia 1). O DIA de vencimento é sempre dia_pagamento; se o dia não existir no mês, usar o último dia do mês.';

-- ---------------------------------------------------------------------
-- A4 / B8 — Idempotência de boas-vindas por cobrança.
-- Adiciona cobranca_id em notificacoes_enviadas e cria trava única para
-- boasvindas (parcela_id é NULL nesse caso). 'manual' NÃO entra em trava
-- (reenvio permitido); lembretes automáticos seguem com a trava por parcela.
-- ---------------------------------------------------------------------
alter table public.notificacoes_enviadas
  add column cobranca_id uuid references public.cobrancas(id) on delete set null;

create unique index uq_notif_boasvindas
  on public.notificacoes_enviadas (cobranca_id, tipo, canal)
  where tipo = 'boasvindas' and cobranca_id is not null;

-- ---------------------------------------------------------------------
-- B2 [ALTO] — notificacoes_enviadas.parcela_id deve preservar o log quando
-- a parcela é deletada. Trocar ON DELETE CASCADE por ON DELETE SET NULL.
-- ---------------------------------------------------------------------
alter table public.notificacoes_enviadas
  drop constraint notificacoes_enviadas_parcela_id_fkey;
alter table public.notificacoes_enviadas
  add  constraint notificacoes_enviadas_parcela_id_fkey
       foreign key (parcela_id) references public.parcelas(id) on delete set null;

-- ---------------------------------------------------------------------
-- B3 [ALTO] — Corrigir regex de local_part (rejeitar ".." e "." no fim).
-- ---------------------------------------------------------------------
alter table public.email_remetente
  drop constraint if exists chk_local_part;
alter table public.email_remetente
  add  constraint chk_local_part check (
    local_part ~ '^[a-z0-9]([a-z0-9-]*(\.[a-z0-9-]+)*)?$'
  );

-- ---------------------------------------------------------------------
-- B4 [MÉDIO] — Trigger de updated_at em plataforma_config (estava faltando).
-- ---------------------------------------------------------------------
drop trigger if exists trg_plat_cfg_upd on public.plataforma_config;
create trigger trg_plat_cfg_upd before update on public.plataforma_config
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- B5 [MÉDIO] — Impedir duplicata de número de parcela na mesma cobrança
-- (proteção contra concorrência no scheduler).
-- ---------------------------------------------------------------------
create unique index if not exists uq_parcela_numero_por_cobranca
  on public.parcelas (cobranca_id, numero);

-- ---------------------------------------------------------------------
-- B6 [MÉDIO] — Índice por data no audit_log + retenção definida (2 anos).
-- ---------------------------------------------------------------------
create index if not exists idx_audit_log_created_at
  on public.audit_log (created_at);

-- ---------------------------------------------------------------------
-- A2 — status 'vencida' é CALCULADO na query, não escrito no banco.
-- Índice ajustado para as queries reais (conta + status + vencimento).
-- ---------------------------------------------------------------------
drop index if exists public.idx_parcelas_venc_status;
create index if not exists idx_parcelas_conta_status_venc
  on public.parcelas (conta_id, status, data_vencimento);

-- ---------------------------------------------------------------------
-- B7 [BAIXO] — created_at faltando em notificacoes_config e conexoes.
-- ---------------------------------------------------------------------
alter table public.notificacoes_config
  add column if not exists created_at timestamptz not null default now();
alter table public.conexoes
  add column if not exists created_at timestamptz not null default now();

-- ---------------------------------------------------------------------
-- ITEM 7 — Expiração automática via pg_cron (roda no Supabase, independe do VPS).
-- Requer a extensão pg_cron (disponível no plano Pro). Se indisponível no seu
-- plano, COMENTAR este bloco e fazer a limpeza por job no Vortexus.
--   • notificacoes_enviadas: apagar após 10 dias.
--   • audit_log: apagar após 2 anos.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule(
  'expurgo_notificacoes_enviadas',
  '0 3 * * *',  -- todo dia às 03:00
  $$ delete from public.notificacoes_enviadas where created_at < now() - interval '10 days'; $$
);

select cron.schedule(
  'expurgo_audit_log',
  '30 3 * * *', -- todo dia às 03:30
  $$ delete from public.audit_log where created_at < now() - interval '2 years'; $$
);

-- =====================================================================
-- FIM 0002. Resumo:
--   B1 removido (segurança), A1 (mes_ano_inicio), A4/B8 (idempotência boasvindas),
--   B2 (set null), B3 (regex), B4 (trigger), B5 (unique parcela), B6 (índice audit),
--   A2 (índice ajustado p/ vencida calculada), B7 (created_at), expurgo via pg_cron.
-- Lembrete: status 'vencida' NÃO é gravado — é derivado na query
--   (status='aberta' AND data_vencimento < current_date). Fuso: America/Sao_Paulo.
-- =====================================================================
