-- Mensagens rápidas: textos predefinidos que o atendente pode inserir com "/" no chat
CREATE TABLE IF NOT EXISTS public.mensagens_rapidas (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id   UUID        NOT NULL REFERENCES public.contas(id) ON DELETE CASCADE,
  titulo     TEXT        NOT NULL,
  texto      TEXT        NOT NULL,
  ordem      INTEGER     NOT NULL DEFAULT 0,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mensagens_rapidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mensagens_rapidas da conta"
  ON public.mensagens_rapidas FOR ALL
  USING (
    conta_id IN (
      SELECT id       FROM public.contas        WHERE owner_user_id = auth.uid()
      UNION
      SELECT conta_id FROM public.membros_conta WHERE user_id = auth.uid() AND ativo = true
    )
  );

CREATE INDEX IF NOT EXISTS mensagens_rapidas_conta_ordem
  ON public.mensagens_rapidas (conta_id, ordem);
