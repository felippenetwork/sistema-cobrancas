-- Mercado Pago como segundo provedor de PIX para cobrança do cliente final (além da EfiBank).
-- Credencial por conta: o dinheiro cai na conta Mercado Pago de cada cliente do Cobranx, não na da plataforma.
--
-- API usada: Orders API (POST/GET /v1/orders) — confirmada em integração irmã (ERP-Rifas) contra o
-- sandbox e produção reais. A Orders API NÃO aceita notification_url por requisição: o Mercado Pago só
-- chama a URL fixa configurada no painel do app ("Suas integrações" → Webhooks) — por isso o webhook do
-- Cobranx é uma URL única (/api/webhooks/mercadopago-pix, sem parâmetro de conta) e cada conta precisa
-- configurar essa URL no PRÓPRIO app Mercado Pago e colar a Secret Key gerada lá.

ALTER TABLE public.configuracoes
  -- Access Token da conta Mercado Pago, SEMPRE cifrado pela aplicação (lib/crypto/segredos.ts, prefixo "enc:v1:").
  ADD COLUMN IF NOT EXISTS mp_access_token text,
  -- Secret Key do webhook (painel Mercado Pago → Suas integrações → Webhooks), cifrada do mesmo jeito.
  -- Usada para validar a assinatura x-signature das notificações desta conta.
  ADD COLUMN IF NOT EXISTS mp_webhook_secret text,
  -- Provedor que o botão de PIX do Atendimento usa. Default 'efibank' preserva o comportamento de quem já usa.
  ADD COLUMN IF NOT EXISTS pix_provedor text NOT NULL DEFAULT 'efibank'
    CONSTRAINT configuracoes_pix_provedor_check CHECK (pix_provedor IN ('efibank', 'mercadopago'));

ALTER TABLE public.cobrancas_pix
  -- txid guarda o id do pagamento no provedor (EfiBank: txid; Mercado Pago: id da ORDEM — Orders API).
  ADD COLUMN IF NOT EXISTS provedor text NOT NULL DEFAULT 'efibank'
    CONSTRAINT cobrancas_pix_provedor_check CHECK (provedor IN ('efibank', 'mercadopago'));

-- O webhook do Mercado Pago recebe uma URL fixa (sem conta_id) e precisa achar a linha só pelo id da
-- ordem — globalmente único (atribuído pelo Mercado Pago), nunca colide entre contas.
CREATE INDEX IF NOT EXISTS idx_cobrancas_pix_provedor_txid ON public.cobrancas_pix (provedor, txid);
