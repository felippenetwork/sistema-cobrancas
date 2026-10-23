-- Remove do produto inteiro (decisão do Felippe, 2026-10-23):
--   1. Multi-atendimento: tela /atendimento, mensagens rápidas, equipe (membros convidados) e departamentos.
--   2. PIX do cliente final (EfiBank e Mercado Pago): só era gerado pelo botão do Atendimento.
-- A assinatura do SaaS pelo Mercado Pago (token da plataforma, tabela assinaturas) NÃO é afetada.
--
-- IRREVERSÍVEL: apaga o histórico de conversas, a equipe de cada conta, as cobranças PIX geradas e as
-- credenciais EfiBank/Mercado Pago salvas. Membros convidados perdem o acesso (caem em /sem-conta).
-- Tudo com IF EXISTS: roda igual com ou sem a 0036 aplicada.

-- ── 1. Conta nova não cria mais departamento "Geral" ─────────────────────────
-- (precisa sair ANTES de dropar departamentos, senão todo insert em contas falharia)
drop trigger if exists trg_departamento_geral on public.contas;
drop function if exists public.criar_departamento_geral();

-- ── 2. Tenant volta a ser só o dono da conta ─────────────────────────────────
-- Redefinidas antes do drop de membros_conta: o corpo das duas consultava essa tabela.
create or replace function public.conta_do_usuario()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.contas where owner_user_id = auth.uid() limit 1;
$$;

-- Mantida (as policies de configuracoes e meios_pagamento usam) — sem equipe, administrar = ser o dono.
create or replace function public.pode_administrar_conta(p_conta_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_conta_id is not null
     and exists (select 1 from public.contas where id = p_conta_id and owner_user_id = auth.uid());
$$;

-- ── 3. Tabelas do atendimento e do PIX ───────────────────────────────────────
-- Ordem importa: as policies de cobrancas_pix e mensagens_rapidas consultam membros_conta,
-- então as duas saem antes dela.
drop table if exists public.mensagens_wa;          -- referencia atendimentos; sai da publicação realtime junto
drop table if exists public.atendimentos;          -- leva trg_numero_atendimento
drop function if exists public.gerar_numero_atendimento();
drop table if exists public.departamentos;
drop table if exists public.mensagens_rapidas;
drop table if exists public.cobrancas_pix;
drop table if exists public.membros_conta;

-- ── 4. Credenciais do PIX do cliente final ───────────────────────────────────

alter table public.configuracoes
  drop column if exists efi_client_id,
  drop column if exists efi_client_secret,
  drop column if exists efi_pix_key,
  drop column if exists efi_cert_base64,
  drop column if exists efi_sandbox,
  drop column if exists mp_access_token,
  drop column if exists mp_webhook_secret,
  drop column if exists pix_provedor;
