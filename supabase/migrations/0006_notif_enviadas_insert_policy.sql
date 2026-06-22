-- Permite que server actions (criarCobrancaAction, cobrarManualAction, etc.)
-- enfilerem notificações em nome do usuário autenticado.
-- A tabela já tinha policy de SELECT; apenas INSERT faltava.
create policy nenv_ins on public.notificacoes_enviadas
  for insert
  with check (conta_id = public.conta_do_usuario());
