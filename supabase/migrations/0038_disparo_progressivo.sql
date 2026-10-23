-- Disparo progressivo + registro de quem já recebeu (/disparos) — pedido do Felippe, 2026-10-23.
--
-- Progressivo: dia 1 sai `prog_inicio` mensagem(ns), dia 2 sai +1… até `prog_maximo`, e o ciclo
-- recomeça. Os envios do dia são sorteados dentro da janela (janela_inicio–janela_fim) e gravados
-- em campanha_destinatarios.agendado_para; o cron /api/cron/whatsapp-uazapi envia cada um na hora.
-- Regras puras em lib/disparo/progressivo.ts.
--
-- Registro: com `registrar_enviados`, cada número que recebeu entra em contatos_disparados; com
-- `excluir_ja_enviados`, quem já está lá é pulado (status 'pulado') e não recebe de novo.
-- Tudo retrocompatível: campanha existente continua 'normal', sem nenhuma opção ligada.

-- ── campanhas_wa ─────────────────────────────────────────────────────────────
alter table public.campanhas_wa
  add column if not exists tipo text not null default 'normal'
    constraint campanhas_wa_tipo_check check (tipo in ('normal', 'progressivo')),
  -- Texto próprio da campanha (o progressivo não usa modelo_id); {{nome}} = nome do contato.
  add column if not exists mensagem text
    constraint campanhas_wa_mensagem_check check (mensagem is null or length(trim(mensagem)) between 1 and 4000),
  -- Versões alternativas da mensagem, usadas em rodízio.
  add column if not exists variacoes text[] not null default '{}',
  add column if not exists janela_inicio time,
  add column if not exists janela_fim time,
  add column if not exists prog_inicio integer
    constraint campanhas_wa_prog_inicio_check check (prog_inicio is null or prog_inicio between 1 and 200),
  add column if not exists prog_maximo integer
    constraint campanhas_wa_prog_maximo_check check (prog_maximo is null or prog_maximo between 1 and 200),
  -- Quantos dias já foram planejados (posição no ciclo) e qual foi o último (data de São Paulo).
  add column if not exists prog_dia integer not null default 0,
  add column if not exists prog_planejado_em date,
  add column if not exists registrar_enviados boolean not null default false,
  add column if not exists excluir_ja_enviados boolean not null default false,
  add column if not exists total_pulados integer not null default 0;

alter table public.campanhas_wa
  add constraint campanhas_wa_progressivo_check check (
    tipo <> 'progressivo' or (
      mensagem is not null and janela_inicio is not null and janela_fim is not null
      and janela_fim > janela_inicio
      and prog_inicio is not null and prog_maximo is not null and prog_maximo >= prog_inicio
    )
  );

-- Progressivo dura semanas: precisa poder pausar e retomar.
alter table public.campanhas_wa drop constraint if exists campanhas_wa_status_check;
alter table public.campanhas_wa add constraint campanhas_wa_status_check
  check (status in ('rascunho', 'agendada', 'enviando', 'pausada', 'concluida', 'cancelada'));

create index if not exists idx_campanhas_wa_conta_status on public.campanhas_wa (conta_id, status);

-- ── campanha_destinatarios ───────────────────────────────────────────────────
alter table public.campanha_destinatarios
  add column if not exists nome text
    constraint campanha_dest_nome_check check (nome is null or length(nome) <= 80),
  -- Posição na lista colada (ordem de envio e rodízio das variações).
  add column if not exists ordem integer,
  -- Horário sorteado para o envio (progressivo). null = ainda não planejado.
  add column if not exists agendado_para timestamptz;

alter table public.campanha_destinatarios drop constraint if exists campanha_destinatarios_status_check;
alter table public.campanha_destinatarios add constraint campanha_destinatarios_status_check
  check (status in ('pendente', 'enviado', 'falhou', 'lido', 'pulado'));

create index if not exists idx_campanha_dest_fila
  on public.campanha_destinatarios (campanha_id, status, agendado_para);
create index if not exists idx_campanha_dest_ordem
  on public.campanha_destinatarios (campanha_id, status, ordem);

-- ── contatos_disparados: quem já recebeu algum disparo desta conta ──────────
create table if not exists public.contatos_disparados (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid not null references public.contas(id) on delete cascade,
  celular          text not null check (celular ~ '^[0-9]{10,15}$'),
  nome             text check (nome is null or length(nome) <= 80),
  campanha_id      uuid references public.campanhas_wa(id) on delete set null,
  primeiro_envio_em timestamptz not null default now(),
  ultimo_envio_em   timestamptz not null default now(),
  -- Unicidade POR CONTA (skill isolamento-de-contas): nunca global.
  unique (conta_id, celular)
);

alter table public.contatos_disparados enable row level security;
alter table public.contatos_disparados force row level security;

create policy contatos_disparados_sel on public.contatos_disparados
  for select using (conta_id = public.conta_do_usuario());
create policy contatos_disparados_ins on public.contatos_disparados
  for insert with check (conta_id = public.conta_do_usuario());
create policy contatos_disparados_upd on public.contatos_disparados
  for update using (conta_id = public.conta_do_usuario())
  with check (conta_id = public.conta_do_usuario());
create policy contatos_disparados_del on public.contatos_disparados
  for delete using (conta_id = public.conta_do_usuario());
