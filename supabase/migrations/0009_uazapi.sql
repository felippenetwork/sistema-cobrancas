-- =====================================================================
-- 0009_uazapi.sql
-- Migra gerenciamento de conexão WhatsApp de Baileys para uazapi.
-- • uazapi_instance_token: token da instância uazapi (usado para enviar msgs e verificar status)
-- • comando: não é mais necessário (ações chamam uazapi diretamente), mantido para compatibilidade
-- =====================================================================

alter table public.conexoes
  add column if not exists uazapi_instance_token text;

comment on column public.conexoes.uazapi_instance_token is
  'Token da instância uazapi. Gerado ao conectar; limpo ao desconectar. Usado pelo worker para enviar mensagens.';
