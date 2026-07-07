-- Garante que o mesmo número de celular não pode ser cadastrado duas vezes
-- na mesma conta (clientes ativos — soft-deleted ficam fora do índice).
--
-- ATENÇÃO: se já existirem números duplicados na mesma conta, esta migration
-- falhará. Resolva as duplicatas antes de aplicar.

CREATE UNIQUE INDEX uq_cliente_celular_por_conta
  ON public.clientes (conta_id, celular)
  WHERE deleted_at IS NULL;
