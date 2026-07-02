-- Adiciona policy de UPDATE para o tenant em notificacoes_enviadas.
-- Sem esta policy, UPDATE feito pelo cliente anon (anon key + sessão) falhava silenciosamente
-- com 0 linhas afetadas — RLS FORCE bloqueava sem retornar erro.
-- Afetado: cancelarCobrancaAction (cancela notifs ao cancelar cobrança) e
--          baixarParcelaAction (cancela notifs ao dar baixa em parcela).
create policy "tenant_update" on public.notificacoes_enviadas
  for update
  using  (conta_id = public.conta_do_usuario())
  with check (conta_id = public.conta_do_usuario());
