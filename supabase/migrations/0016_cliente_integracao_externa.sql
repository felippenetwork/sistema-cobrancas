-- Campos de integração com painéis externos (LookDefense IPTV/P2P)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS tipo_integracao TEXT DEFAULT NULL
    CONSTRAINT clientes_tipo_integracao_check
      CHECK (tipo_integracao IN ('lookdefense_iptv', 'lookdefense_p2p')),
  ADD COLUMN IF NOT EXISTS login_externo TEXT DEFAULT NULL;

-- Fila de jobs para renovação automática em sistemas externos
CREATE TABLE IF NOT EXISTS public.baixas_externas (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conta_id         UUID        NOT NULL REFERENCES public.contas(id),
  cliente_id       UUID        NOT NULL REFERENCES public.clientes(id),
  parcela_id       UUID        NOT NULL REFERENCES public.parcelas(id),
  login_externo    TEXT        NOT NULL,
  tipo_integracao  TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pendente',
  tentativas       SMALLINT    NOT NULL DEFAULT 0,
  erro             TEXT,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processado_em    TIMESTAMPTZ
);

ALTER TABLE public.baixas_externas ENABLE ROW LEVEL SECURITY;

-- Índice para o worker (polling por status + criado_em)
CREATE INDEX IF NOT EXISTS idx_baixas_externas_pendente
  ON public.baixas_externas (criado_em)
  WHERE status = 'pendente';

-- App pode inserir jobs apenas para a própria conta
CREATE POLICY "conta pode inserir baixa_externa" ON public.baixas_externas
  FOR INSERT TO authenticated
  WITH CHECK (
    conta_id = (SELECT c.id FROM public.contas c WHERE c.owner_user_id = auth.uid())
  );
