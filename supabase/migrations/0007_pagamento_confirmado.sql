-- Adiciona o tipo 'pagamento_confirmado' ao enum notif_tipo.
-- Disparado pelo baixarParcelaAction ao dar baixa numa parcela.
alter type public.notif_tipo add value if not exists 'pagamento_confirmado';
