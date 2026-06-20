-- =====================================================================
-- 0005_email_sprint7.sql
-- Infraestrutura de e-mail (Sprint 7):
--   • resend_message_id em notificacoes_enviadas (webhook de status)
--   • optout_email em clientes (descadastro via link de unsubscribe)
-- =====================================================================

-- Rastrear o ID da mensagem Resend para atualizar status via webhook
alter table public.notificacoes_enviadas
  add column if not exists resend_message_id text;

create index if not exists idx_notif_resend_msg_id
  on public.notificacoes_enviadas (resend_message_id)
  where resend_message_id is not null;

-- Opt-out de e-mail por cliente (link de unsubscribe obrigatório por lei)
alter table public.clientes
  add column if not exists optout_email boolean not null default false;

comment on column public.clientes.optout_email is
  'Cliente clicou em "descadastrar" de e-mails. Worker não envia e-mail quando true.';
comment on column public.notificacoes_enviadas.resend_message_id is
  'ID retornado pelo Resend ao enviar (ex: re_xxx). Usado para correlacionar eventos do webhook.';
