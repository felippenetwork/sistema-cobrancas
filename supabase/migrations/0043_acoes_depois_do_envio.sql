-- Ações depois do envio (pedido do Felippe, 2026-10-26): lista ORDENADA do que fazer na conversa
-- de cada contato logo depois que a mensagem sai — pôr/tirar etiqueta, tirar todas as etiquetas,
-- arquivar/desarquivar, fixar/desafixar a conversa, fixar a mensagem enviada, silenciar, marcar
-- como lida/não lida, salvar na agenda, anotar. Formato validado em lib/disparo/acoes.ts.
--   modelos_wa.acoes   → padrão do modelo (vem preenchido no disparo)
--   campanhas_wa.acoes → o que o disparo executa (cópia, editável na criação)
-- Retrocompatível: disparo antigo continua usando etiqueta_adicionar/etiqueta_remover (0039).
alter table public.modelos_wa
  add column if not exists acoes jsonb not null default '[]'::jsonb;
alter table public.modelos_wa drop constraint if exists modelos_wa_acoes_check;
alter table public.modelos_wa add constraint modelos_wa_acoes_check
  check (jsonb_typeof(acoes) = 'array' and jsonb_array_length(acoes) <= 15);

alter table public.campanhas_wa
  add column if not exists acoes jsonb not null default '[]'::jsonb;
alter table public.campanhas_wa drop constraint if exists campanhas_wa_acoes_check;
alter table public.campanhas_wa add constraint campanhas_wa_acoes_check
  check (jsonb_typeof(acoes) = 'array' and jsonb_array_length(acoes) <= 15);
