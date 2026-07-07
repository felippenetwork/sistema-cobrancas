-- Policy SELECT faltando em baixas_externas (app precisa ler para exibir status)
CREATE POLICY "conta pode ler baixa_externa" ON public.baixas_externas
  FOR SELECT TO authenticated
  USING (
    conta_id = (SELECT c.id FROM public.contas c WHERE c.owner_user_id = auth.uid())
  );
