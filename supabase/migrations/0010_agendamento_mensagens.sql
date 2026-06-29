-- =====================================================================
-- 0010_agendamento_mensagens.sql
-- Suporte a mensagens avulsas agendadas.
-- ATENÇÃO: alter type ... add value não pode ser usado na mesma
-- transação que outros DDL — fica isolado nesta migration.
-- =====================================================================

-- 1. Novo valor no enum de tipo de notificação
alter type public.notif_tipo add value if not exists 'agendada';

-- 2. Coluna assunto para e-mail agendado (nullable — só preenchida pelo canal e-mail)
alter table public.notificacoes_enviadas
  add column if not exists assunto text;

comment on column public.notificacoes_enviadas.assunto is
  'Assunto do e-mail. Preenchido apenas em notificações do tipo agendada via canal e-mail.';
