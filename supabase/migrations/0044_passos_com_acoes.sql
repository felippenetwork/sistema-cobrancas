-- Caixinhas de AÇÃO no meio da sequência (pedido do Felippe, 2026-10-28): a sequência agora tem
-- até 10 mensagens + até 15 ações (validado em lib/disparo/passos.ts). O limite do banco era 10
-- caixinhas no total; passa a 30. Só afrouxa: nada existente deixa de valer.
alter table public.campanhas_wa drop constraint if exists campanhas_wa_passos_check;
alter table public.campanhas_wa add constraint campanhas_wa_passos_check
  check (passos is null or (jsonb_typeof(passos) = 'array' and jsonb_array_length(passos) between 1 and 30));

alter table public.modelos_wa drop constraint if exists modelos_wa_passos_check;
alter table public.modelos_wa add constraint modelos_wa_passos_check
  check (passos is null or (jsonb_typeof(passos) = 'array' and jsonb_array_length(passos) between 1 and 30));
