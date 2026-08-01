-- Credenciais EfiBanK (EfiPay) por conta
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS efi_client_id     TEXT,
  ADD COLUMN IF NOT EXISTS efi_client_secret TEXT,
  ADD COLUMN IF NOT EXISTS efi_pix_key       TEXT,
  ADD COLUMN IF NOT EXISTS efi_cert_base64   TEXT,
  ADD COLUMN IF NOT EXISTS efi_sandbox       BOOLEAN NOT NULL DEFAULT false;

-- Cobranças PIX geradas via EfiBanK, vinculadas a parcelas
CREATE TABLE IF NOT EXISTS public.cobrancas_pix (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id       UUID          NOT NULL REFERENCES public.contas(id)   ON DELETE CASCADE,
  parcela_id     UUID          NOT NULL REFERENCES public.parcelas(id) ON DELETE CASCADE,
  txid           TEXT          NOT NULL,
  valor          NUMERIC(10,2) NOT NULL,
  status         TEXT          NOT NULL DEFAULT 'ativa',
  pix_copia_cola TEXT,
  qr_code_base64 TEXT,
  link_pagamento TEXT,
  expira_em      TIMESTAMPTZ,
  pago_em        TIMESTAMPTZ,
  criado_em      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(conta_id, txid)
);

ALTER TABLE public.cobrancas_pix ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cobrancas_pix da conta"
  ON public.cobrancas_pix FOR ALL
  USING (
    conta_id IN (
      SELECT id       FROM public.contas        WHERE owner_user_id = auth.uid()
      UNION
      SELECT conta_id FROM public.membros_conta WHERE user_id = auth.uid() AND ativo = true
    )
  );
