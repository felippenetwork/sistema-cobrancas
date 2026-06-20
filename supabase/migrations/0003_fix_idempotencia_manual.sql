-- =====================================================================
-- 0003_fix_idempotencia_manual.sql
-- Corrige trava de idempotência: exclui tipo='manual' do unique index,
-- permitindo reenvio de cobrança manual (comportamento definido em A4).
-- Aplica-se após 0002_correcoes.sql.
-- =====================================================================

-- O índice atual (0001) bloqueia qualquer segundo envio de notificação
-- para a mesma (parcela_id, tipo, canal), incluindo 'manual'.
-- Como manual tem parcela_id preenchido mas reenvio deve ser permitido,
-- o índice precisa excluir explicitamente esse tipo.
drop index if exists public.uq_notif_idempotencia;

create unique index uq_notif_idempotencia
  on public.notificacoes_enviadas (parcela_id, tipo, canal)
  where parcela_id is not null
    and tipo != 'manual';

-- Resultado final dos índices de idempotência:
--   • Lembretes automáticos (5d/3d/2d/1d/dia/vencido1d): travados por (parcela_id, tipo, canal)
--   • manual: sem trava — reenvio livre pelo botão WhatsApp na parcela
--   • boasvindas: travado por (cobranca_id, tipo, canal) via uq_notif_boasvindas (0002)
