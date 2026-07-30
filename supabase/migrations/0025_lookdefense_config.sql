-- Credenciais LookDefense IPTV por conta (criptografadas em repouso pelo Supabase Vault não necessário aqui,
-- pois a coluna ld_password é tratada como campo sensível — RLS garante acesso apenas ao owner).
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS ld_username text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ld_password text DEFAULT NULL;
