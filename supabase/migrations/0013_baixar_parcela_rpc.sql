-- RPC atômica para dar baixa numa parcela.
-- Envolve as 3 operações core (parcela + lancamento + cancelar notifs) numa única transação.
-- Chamada pelo baixarParcelaAction via service role (createAdminClient).
-- p_conta_id vem da sessão autenticada do usuário — nunca do cliente.

create or replace function public.baixar_parcela(
  p_parcela_id   uuid,
  p_conta_id     uuid,
  p_hoje         date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela  record;
  v_cobranca record;
  v_abertas  integer;
begin
  -- 1. Marcar parcela como paga (atômico: falha se já paga ou de outra conta)
  update parcelas
     set status         = 'paga',
         data_pagamento = p_hoje
   where id       = p_parcela_id
     and conta_id = p_conta_id
     and status   = 'aberta'
  returning id, valor, conta_id, cobranca_id
  into v_parcela;

  if v_parcela.id is null then
    return jsonb_build_object('ok', false, 'erro', 'Parcela não encontrada ou já paga');
  end if;

  -- 2. Registrar lançamento de entrada
  insert into lancamentos (conta_id, tipo, origem, parcela_id, valor, data)
  values (v_parcela.conta_id, 'entrada', 'parcela', v_parcela.id, v_parcela.valor, p_hoje);

  -- 3. Cancelar notificações em fila desta parcela
  update notificacoes_enviadas
     set status = 'cancelado'
   where parcela_id = p_parcela_id
     and conta_id   = p_conta_id
     and status     = 'fila';

  -- 4. Verificar se a cobrança pode ser concluída (não-recorrente + todas pagas)
  select recorrente, cliente_id, dia_pagamento, valor_mensalidade
    into v_cobranca
    from cobrancas
   where id       = v_parcela.cobranca_id
     and conta_id = p_conta_id;

  if found and not v_cobranca.recorrente then
    select count(*) into v_abertas
      from parcelas
     where cobranca_id = v_parcela.cobranca_id
       and status      <> 'paga';

    if v_abertas = 0 then
      update cobrancas
         set status = 'concluida'
       where id       = v_parcela.cobranca_id
         and conta_id = p_conta_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok',          true,
    'parcela_id',  v_parcela.id,
    'cobranca_id', v_parcela.cobranca_id,
    'conta_id',    v_parcela.conta_id,
    'recorrente',  coalesce(v_cobranca.recorrente, false),
    'cliente_id',  v_cobranca.cliente_id
  );
end;
$$;

-- Somente service role pode invocar — anon e authenticated NÃO têm acesso
revoke all on function public.baixar_parcela(uuid, uuid, date) from public;
revoke all on function public.baixar_parcela(uuid, uuid, date) from authenticated;
revoke all on function public.baixar_parcela(uuid, uuid, date) from anon;
