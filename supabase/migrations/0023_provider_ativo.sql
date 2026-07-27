alter table public.configuracoes
  add column if not exists meta_api_ativo boolean not null default true,
  add column if not exists twilio_ativo   boolean not null default true;
