-- Remove a integração LookDefense (renovação automática de acesso IPTV/P2P) do produto.
-- Decisão do Felippe em 2026-09-21: remover do produto inteiro, para sempre.

DROP TABLE IF EXISTS public.baixas_externas;

ALTER TABLE public.clientes
  DROP COLUMN IF EXISTS tipo_integracao,
  DROP COLUMN IF EXISTS login_externo;

ALTER TABLE public.configuracoes
  DROP COLUMN IF EXISTS ld_username,
  DROP COLUMN IF EXISTS ld_password;
