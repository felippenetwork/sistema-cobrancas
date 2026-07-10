-- Habilita Realtime para mensagens_wa
-- Sem isso, INSERT/UPDATE não disparam eventos no cliente (useEffect fica surdo).
ALTER PUBLICATION supabase_realtime ADD TABLE mensagens_wa;
