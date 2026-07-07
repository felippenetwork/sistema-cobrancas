-- Registra o momento exato em que a conexão WhatsApp foi detectada como encerrada.
-- Usado na tela de Conexão para informar o usuário sem estimular reconexão automática.

ALTER TABLE conexoes
  ADD COLUMN IF NOT EXISTS desconectado_em timestamptz;
