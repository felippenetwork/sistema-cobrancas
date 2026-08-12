-- Reseta notificações que ficaram presas em 'processando' após o deploy com bug.
-- Status 'processando' é temporário; se o processo morreu antes de completar,
-- a notificação deve voltar para 'fila' para ser reprocessada pelo cron.
UPDATE public.notificacoes_enviadas
SET status = 'fila'
WHERE status = 'processando';
