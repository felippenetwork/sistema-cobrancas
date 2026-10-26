-- Chatbot: boas-vindas uma vez por pessoa (pedido do Felippe, 2026-10-26).
--   bot_fluxos.boas_vindas          → a automação também começa na primeira mensagem de alguém que
--                                     ainda não a recebeu (cada pessoa recebe uma vez só).
--   bot_fluxos.boas_vindas_clientes → true: vale para todos, inclusive quem já está em Clientes;
--                                     false: só para quem ainda não é cliente.
--   bot_conversas.fluxos_recebidos  → automações que o contato já recebeu (qualquer gatilho).
-- Retrocompatível: automação existente continua sem boas-vindas.

alter table public.bot_fluxos
  add column if not exists boas_vindas          boolean not null default false,
  add column if not exists boas_vindas_clientes boolean not null default false;

alter table public.bot_conversas
  add column if not exists fluxos_recebidos uuid[] not null default '{}';

alter table public.bot_conversas drop constraint if exists bot_conversas_fluxos_recebidos_check;
alter table public.bot_conversas add constraint bot_conversas_fluxos_recebidos_check
  check (cardinality(fluxos_recebidos) <= 100);
