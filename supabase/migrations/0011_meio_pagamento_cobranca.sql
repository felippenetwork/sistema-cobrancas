-- =====================================================================
-- 0011_meio_pagamento_cobranca.sql
-- Permite escolher o meio de pagamento por cobrança.
-- Se null, o worker usa o meio marcado como padrão da conta (comportamento anterior).
-- =====================================================================

alter table public.cobrancas
  add column if not exists meio_pagamento_id uuid
    references public.meios_pagamento(id) on delete set null;

comment on column public.cobrancas.meio_pagamento_id is
  'Meio de pagamento específico desta cobrança. Null = usa o padrão da conta.';
