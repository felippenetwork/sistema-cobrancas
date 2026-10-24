-- Modelos de disparo com sequência de mensagens (pedido do Felippe, 2026-10-24): as
-- "caixinhas" (texto/mídia com o próprio "digitando…") saem do formulário do disparo e passam a
-- morar no modelo (/wa-templates). O disparo, normal ou progressivo, só escolhe o modelo e
-- COPIA a sequência para campanhas_wa.passos na criação — editar o modelo depois não muda um
-- disparo que já está rodando.
-- Retrocompatível: modelo antigo (sem `passos`) continua valendo como um texto só (`corpo`).

alter table public.modelos_wa
  add column if not exists passos jsonb;

alter table public.modelos_wa drop constraint if exists modelos_wa_passos_check;
alter table public.modelos_wa add constraint modelos_wa_passos_check
  check (passos is null or (jsonb_typeof(passos) = 'array' and jsonb_array_length(passos) between 1 and 10));

-- O disparo guarda a própria cópia da sequência: excluir um modelo não pode mais ser barrado
-- pelos disparos antigos que o usaram (a FK sem ação travava a exclusão para sempre).
alter table public.campanhas_wa drop constraint if exists campanhas_wa_modelo_id_fkey;
alter table public.campanhas_wa add constraint campanhas_wa_modelo_id_fkey
  foreign key (modelo_id) references public.modelos_wa(id) on delete set null;
