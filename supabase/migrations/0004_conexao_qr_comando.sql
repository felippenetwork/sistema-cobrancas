-- =====================================================================
-- 0004_conexao_qr_comando.sql
-- Adiciona campos necessários para comunicação frontend ↔ worker (Baileys).
-- • qr_code: worker grava o QR; frontend lê via Realtime e renderiza.
-- • comando: frontend grava ('reconectar'|'desconectar'); worker consome e limpa.
-- =====================================================================

alter table public.conexoes
  add column if not exists qr_code text,    -- string bruta do QR (limpa quando conectado)
  add column if not exists comando  text;   -- comando pendente para o worker

comment on column public.conexoes.qr_code is
  'QR code gerado pelo Baileys. Worker atualiza; frontend renderiza via Realtime. Nulo quando conectado.';

comment on column public.conexoes.comando is
  'Comando para o worker: reconectar | desconectar. Worker lê, executa e limpa (= null).';
