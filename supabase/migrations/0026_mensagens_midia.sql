-- Adiciona suporte a mídia e URL de arquivo nas mensagens WhatsApp
ALTER TABLE mensagens_wa
  ADD COLUMN IF NOT EXISTS midia_url TEXT;

-- Bucket público para armazenar mídia recebida/enviada via WhatsApp
INSERT INTO storage.buckets (id, name, public)
VALUES ('midia-wa', 'midia-wa', true)
ON CONFLICT (id) DO NOTHING;
