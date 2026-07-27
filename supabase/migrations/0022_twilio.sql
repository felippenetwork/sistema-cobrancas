alter table public.configuracoes
  add column if not exists twilio_account_sid text,
  add column if not exists twilio_auth_token   text,
  add column if not exists twilio_from_number  text;
