-- Necessário para validar a assinatura (X-Hub-Signature-256) dos webhooks
-- da Meta Cloud API — cada conta tem seu próprio app/número, logo seu
-- próprio App Secret (mesmo padrão de meta_access_token/meta_phone_number_id).
-- Sem isso, o webhook de mensagens (app/api/webhooks/whatsapp) não tinha
-- como confirmar que uma requisição realmente veio da Meta.
alter table public.configuracoes
  add column if not exists meta_app_secret text;
