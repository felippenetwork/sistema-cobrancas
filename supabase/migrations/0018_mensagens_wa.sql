-- Inbox de atendimento WhatsApp: armazena mensagens enviadas e recebidas por conversa.
CREATE TABLE public.mensagens_wa (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id    UUID        NOT NULL REFERENCES public.contas(id)   ON DELETE CASCADE,
  cliente_id  UUID                    REFERENCES public.clientes(id) ON DELETE SET NULL,
  celular     TEXT        NOT NULL,
  direcao     TEXT        NOT NULL CHECK (direcao IN ('in', 'out')),
  texto       TEXT        NOT NULL,
  tipo        TEXT        NOT NULL DEFAULT 'text',
  status      TEXT        NOT NULL DEFAULT 'enviado',
  wa_id       TEXT,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lida        BOOLEAN     NOT NULL DEFAULT false
);

-- Índice para listar conversas (grupo por celular, ordenado pelo mais recente)
CREATE INDEX idx_mwa_conversa  ON public.mensagens_wa (conta_id, celular, recebido_em DESC);
-- Índice para badge de não lidas
CREATE INDEX idx_mwa_nao_lidas ON public.mensagens_wa (conta_id, lida) WHERE NOT lida;
-- Deduplicação por ID externo do WhatsApp
CREATE UNIQUE INDEX uq_mwa_wa_id ON public.mensagens_wa (wa_id) WHERE wa_id IS NOT NULL;

ALTER TABLE public.mensagens_wa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensagens_wa FORCE  ROW LEVEL SECURITY;

-- SELECT: conta vê suas próprias mensagens
CREATE POLICY "mwa_sel" ON public.mensagens_wa FOR SELECT TO authenticated
  USING (conta_id = (SELECT c.id FROM public.contas c WHERE c.owner_user_id = auth.uid()));

-- INSERT: conta envia respostas (mensagens out)
CREATE POLICY "mwa_ins" ON public.mensagens_wa FOR INSERT TO authenticated
  WITH CHECK (conta_id = (SELECT c.id FROM public.contas c WHERE c.owner_user_id = auth.uid()));

-- UPDATE: marcar como lida
CREATE POLICY "mwa_upd" ON public.mensagens_wa FOR UPDATE TO authenticated
  USING (conta_id = (SELECT c.id FROM public.contas c WHERE c.owner_user_id = auth.uid()));
