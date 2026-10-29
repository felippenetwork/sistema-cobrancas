-- Envio agendado para UMA pessoa (pedido do Felippe, 2026-10-29): "o cliente pediu para eu
-- lembrar ele tal hora". Cliente cadastrado ou número digitado, com a mesma sequência de
-- caixinhas dos modelos (texto/mídia/ação, validada em lib/disparo/passos.ts) e {{nome}} /
-- {{periododia}}. O cron /api/cron/whatsapp-uazapi envia na hora marcada (lib/disparo/agendados.ts).
-- A tela /agendamentos antiga (notificacoes_enviadas tipo 'agendada', só clientes e só texto)
-- continua sendo enviada pelo cron; agendamentos novos vêm para esta tabela.
create table if not exists public.envios_agendados (
  id             uuid primary key default gen_random_uuid(),
  conta_id       uuid not null references public.contas(id) on delete cascade,
  cliente_id     uuid references public.clientes(id) on delete set null,
  celular        text not null check (celular ~ '^[0-9]{10,15}$'),
  nome           text check (nome is null or length(nome) <= 80),
  passos         jsonb not null check (jsonb_typeof(passos) = 'array' and jsonb_array_length(passos) between 1 and 30),
  agendado_para  timestamptz not null,
  status         text not null default 'pendente' check (status in ('pendente', 'enviado', 'falhou', 'cancelado')),
  erro           text check (erro is null or length(erro) <= 500),
  aviso          text check (aviso is null or length(aviso) <= 500),
  enviado_em     timestamptz,
  criado_em      timestamptz not null default now()
);
-- O cron procura os pendentes vencidos de cada conta; a tela lista por data.
create index if not exists envios_agendados_fila_idx on public.envios_agendados (conta_id, agendado_para) where status = 'pendente';
create index if not exists envios_agendados_conta_idx on public.envios_agendados (conta_id, agendado_para desc);

alter table public.envios_agendados enable row level security;
alter table public.envios_agendados force row level security;
create policy envios_agendados_sel on public.envios_agendados for select using (conta_id = public.conta_do_usuario());
create policy envios_agendados_ins on public.envios_agendados for insert with check (conta_id = public.conta_do_usuario());
create policy envios_agendados_upd on public.envios_agendados for update using (conta_id = public.conta_do_usuario())
  with check (conta_id = public.conta_do_usuario());
create policy envios_agendados_del on public.envios_agendados for delete using (conta_id = public.conta_do_usuario());
