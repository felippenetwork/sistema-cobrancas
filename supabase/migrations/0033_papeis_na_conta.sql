-- SEG-N4 — papéis dentro da conta valendo no BANCO, não só na interface.
--
-- Uma conta tem três papéis: dono (contas.owner_user_id), admin e atendente
-- (membros_conta.role). Desde a 0020, conta_do_usuario() vale para os três e as policies
-- abaixo só checavam isso. Resultado: um atendente, usando o próprio login direto na API,
-- lia e alterava configuracoes (tokens da Meta, credenciais do EfiBank, chave PIX) e se
-- promovia a admin em membros_conta. O papel só era conferido na tela e na action de /equipe.
--
-- Depois desta migration:
--   configuracoes        → só dono/admin leem e escrevem (admin da plataforma continua lendo)
--   membros_conta        → todos os membros LISTAM a equipe; só dono/admin cadastram, alteram, removem
--   meios_pagamento      → todos leem (a cobrança usa); só dono/admin escrevem (o texto da chave PIX
--                          vai para o cliente; trocá-lo desvia pagamentos)
--
-- Fluxos do atendente que precisam das credenciais (enviar mensagem, listar templates) passam a
-- ler no servidor com service role, depois de getConta() confirmar que ele é da conta.

create or replace function public.pode_administrar_conta(p_conta_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_conta_id is not null
     and p_conta_id = public.conta_do_usuario()
     and (
       exists (select 1 from public.contas where id = p_conta_id and owner_user_id = auth.uid())
       or exists (
         select 1 from public.membros_conta
          where conta_id = p_conta_id and user_id = auth.uid() and ativo = true and role = 'admin'
       )
     );
$$;

-- ── configuracoes ────────────────────────────────────────────────────────────
drop policy if exists cfg_sel on public.configuracoes;
drop policy if exists cfg_ins on public.configuracoes;
drop policy if exists cfg_upd on public.configuracoes;

create policy cfg_sel on public.configuracoes for select
  using (public.pode_administrar_conta(conta_id) or public.is_admin());
create policy cfg_ins on public.configuracoes for insert
  with check (public.pode_administrar_conta(conta_id));
create policy cfg_upd on public.configuracoes for update
  using (public.pode_administrar_conta(conta_id))
  with check (public.pode_administrar_conta(conta_id));

-- ── membros_conta (membros_select da 0020 continua: qualquer membro lista a equipe) ──
drop policy if exists membros_insert on public.membros_conta;
drop policy if exists membros_update on public.membros_conta;
drop policy if exists membros_delete on public.membros_conta;

create policy membros_insert on public.membros_conta for insert
  with check (public.pode_administrar_conta(conta_id));
create policy membros_update on public.membros_conta for update
  using (public.pode_administrar_conta(conta_id))
  with check (public.pode_administrar_conta(conta_id));
create policy membros_delete on public.membros_conta for delete
  using (public.pode_administrar_conta(conta_id));

-- ── meios_pagamento ──────────────────────────────────────────────────────────
drop policy if exists meios_all on public.meios_pagamento;

create policy meios_sel on public.meios_pagamento for select
  using (conta_id = public.conta_do_usuario());
create policy meios_ins on public.meios_pagamento for insert
  with check (public.pode_administrar_conta(conta_id));
create policy meios_upd on public.meios_pagamento for update
  using (public.pode_administrar_conta(conta_id))
  with check (public.pode_administrar_conta(conta_id));
create policy meios_del on public.meios_pagamento for delete
  using (public.pode_administrar_conta(conta_id));
