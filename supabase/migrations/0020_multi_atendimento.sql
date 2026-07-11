-- ════════════════════════════════════════════════════════════════════════════════
-- 0020_multi_atendimento.sql
-- Sistema de multi-atendimento + WhatsApp Business API (templates e campanhas)
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. Membros da conta (atendentes convidados via e-mail) ────────────────────
create table public.membros_conta (
  id        uuid primary key default gen_random_uuid(),
  conta_id  uuid not null references public.contas(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  nome      text not null,
  email     text not null,
  role      text not null default 'atendente'
              check (role in ('admin', 'atendente')),
  ativo     boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (conta_id, user_id)
);
alter table public.membros_conta enable row level security;

-- ── 2. Departamentos ──────────────────────────────────────────────────────────
create table public.departamentos (
  id        uuid primary key default gen_random_uuid(),
  conta_id  uuid not null references public.contas(id) on delete cascade,
  nome      text not null,
  cor       text not null default '#6366f1',
  criado_em timestamptz not null default now()
);
alter table public.departamentos enable row level security;

-- Departamento "Geral" criado automaticamente para cada nova conta
create or replace function public.criar_departamento_geral()
returns trigger language plpgsql security definer as $$
begin
  insert into public.departamentos (conta_id, nome, cor)
  values (new.id, 'Geral', '#6366f1');
  return new;
end;
$$;

create trigger trg_departamento_geral
  after insert on public.contas
  for each row execute function public.criar_departamento_geral();

-- Criar "Geral" para contas existentes que ainda não têm departamento
insert into public.departamentos (conta_id, nome, cor)
select id, 'Geral', '#6366f1'
from public.contas c
where not exists (
  select 1 from public.departamentos d where d.conta_id = c.id
);

-- ── 3. Atendimentos (fila + histórico de sessões) ─────────────────────────────
create table public.atendimentos (
  id              uuid primary key default gen_random_uuid(),
  conta_id        uuid not null references public.contas(id) on delete cascade,
  numero          integer not null default 0,
  celular         text not null,
  cliente_id      uuid references public.clientes(id),
  departamento_id uuid references public.departamentos(id),
  status          text not null default 'aguardando'
                    check (status in ('aguardando', 'em_atendimento', 'finalizado')),
  atendente_id    uuid references auth.users(id),
  ultima_mensagem text,
  ultima_msg_em   timestamptz,
  criado_em       timestamptz not null default now(),
  aceito_em       timestamptz,
  finalizado_em   timestamptz
);
alter table public.atendimentos enable row level security;

create index idx_atendimentos_conta_status  on public.atendimentos (conta_id, status);
create index idx_atendimentos_conta_celular on public.atendimentos (conta_id, celular);

-- Apenas 1 atendimento aberto (aguardando|em_atendimento) por celular por conta
create unique index atendimentos_aberto_uniq
  on public.atendimentos (conta_id, celular)
  where status != 'finalizado';

-- Número do ticket sequencial por conta
create or replace function public.gerar_numero_atendimento()
returns trigger language plpgsql security definer as $$
begin
  select coalesce(max(numero), 0) + 1 into new.numero
  from public.atendimentos
  where conta_id = new.conta_id;
  return new;
end;
$$;

create trigger trg_numero_atendimento
  before insert on public.atendimentos
  for each row execute function public.gerar_numero_atendimento();

-- ── 4. Modelos WhatsApp Business (Meta Cloud API) ─────────────────────────────
create table public.modelos_wa (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid not null references public.contas(id) on delete cascade,
  nome             text not null,
  categoria        text not null default 'UTILITY'
                     check (categoria in ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  idioma           text not null default 'pt_BR',
  corpo            text not null,
  cabecalho        text,
  rodape           text,
  botoes           jsonb,
  variaveis        jsonb,
  status           text not null default 'rascunho'
                     check (status in ('rascunho', 'em_analise', 'aprovado', 'rejeitado')),
  meta_template_id text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
alter table public.modelos_wa enable row level security;

-- ── 5. Campanhas de disparo ───────────────────────────────────────────────────
create table public.campanhas_wa (
  id                  uuid primary key default gen_random_uuid(),
  conta_id            uuid not null references public.contas(id) on delete cascade,
  nome                text not null,
  modelo_id           uuid references public.modelos_wa(id),
  status              text not null default 'rascunho'
                        check (status in ('rascunho', 'agendada', 'enviando', 'concluida', 'cancelada')),
  total_destinatarios integer not null default 0,
  total_enviados      integer not null default 0,
  total_falhas        integer not null default 0,
  agendado_para       timestamptz,
  iniciado_em         timestamptz,
  concluido_em        timestamptz,
  criado_em           timestamptz not null default now()
);
alter table public.campanhas_wa enable row level security;

create table public.campanha_destinatarios (
  id          uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas_wa(id) on delete cascade,
  conta_id    uuid not null references public.contas(id) on delete cascade,
  cliente_id  uuid references public.clientes(id),
  celular     text not null,
  variaveis   jsonb,
  status      text not null default 'pendente'
                check (status in ('pendente', 'enviado', 'falhou', 'lido')),
  wa_id       text,
  enviado_em  timestamptz,
  erro        text
);
alter table public.campanha_destinatarios enable row level security;

-- ── 6. Vincular mensagens_wa ao atendimento ───────────────────────────────────
alter table public.mensagens_wa
  add column if not exists atendimento_id uuid references public.atendimentos(id);

-- ── 7. Atualizar conta_do_usuario() — suporta owners E membros ───────────────
create or replace function public.conta_do_usuario()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.contas where owner_user_id = auth.uid()
  union all
  select conta_id from public.membros_conta
    where user_id = auth.uid() and ativo = true
  limit 1;
$$;

-- ── 8. RLS Policies ───────────────────────────────────────────────────────────

-- membros_conta: qualquer membro da conta pode listar; só admin insere/exclui (validado na app)
create policy membros_select on public.membros_conta
  for select using (conta_id = public.conta_do_usuario());
create policy membros_insert on public.membros_conta
  for insert with check (conta_id = public.conta_do_usuario());
create policy membros_update on public.membros_conta
  for update using (conta_id = public.conta_do_usuario())
  with check (conta_id = public.conta_do_usuario());
create policy membros_delete on public.membros_conta
  for delete using (conta_id = public.conta_do_usuario());

-- departamentos
create policy departamentos_all on public.departamentos
  for all using (conta_id = public.conta_do_usuario())
  with check (conta_id = public.conta_do_usuario());

-- atendimentos
create policy atendimentos_all on public.atendimentos
  for all using (conta_id = public.conta_do_usuario())
  with check (conta_id = public.conta_do_usuario());

-- modelos_wa
create policy modelos_wa_all on public.modelos_wa
  for all using (conta_id = public.conta_do_usuario())
  with check (conta_id = public.conta_do_usuario());

-- campanhas_wa
create policy campanhas_wa_all on public.campanhas_wa
  for all using (conta_id = public.conta_do_usuario())
  with check (conta_id = public.conta_do_usuario());

-- campanha_destinatarios
create policy campanha_dest_all on public.campanha_destinatarios
  for all using (conta_id = public.conta_do_usuario())
  with check (conta_id = public.conta_do_usuario());

-- ── 9. Realtime para atendimentos ─────────────────────────────────────────────
alter publication supabase_realtime add table public.atendimentos;
