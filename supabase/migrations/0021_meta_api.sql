-- Credenciais da Meta Cloud API por conta
-- Cada conta pode ter seu próprio número oficial registrado na Meta
alter table public.configuracoes
  add column if not exists meta_access_token    text,
  add column if not exists meta_phone_number_id text,
  add column if not exists meta_waba_id         text;
