-- Chatbot (etapa 3 do pedido do Felippe, 2026-10-23/26), só via uazapi:
--   - bot_fluxos: cada automação, com as etapas (jsonb validado em lib/chatbot/fluxo.ts), os
--     gatilhos (palavra-chave, etiqueta do WhatsApp Business, resposta a um disparo ligado) e as
--     etiquetas que EXCLUEM o contato do fluxo.
--   - bot_conversas: uma por contato (conta + celular) — em que fluxo/etapa está, as respostas
--     guardadas como variáveis, e se o robô está pausado (humano assumiu) ou se a pessoa pediu
--     para SAIR (aí também não recebe mais disparos).
--   - bot_mensagens: histórico do que o robô recebeu/enviou por contato (e a trava de mensagem
--     repetida pela uazapi: wa_id único por conta).
--   - conexoes.webhook_segredo: segredo POR CONTA na URL do webhook de mensagens recebidas.
--   - campanhas_wa.fluxo_id: quem responder ao disparo entra nesse fluxo.
-- O webhook volta só para o robô — não existe tela de conversas/atendimento.

-- ── conexoes ─────────────────────────────────────────────────────────────────
alter table public.conexoes
  add column if not exists webhook_segredo text check (webhook_segredo is null or length(webhook_segredo) between 32 and 128);

-- ── bot_fluxos ───────────────────────────────────────────────────────────────
create table if not exists public.bot_fluxos (
  id                       uuid primary key default gen_random_uuid(),
  conta_id                 uuid not null references public.contas(id) on delete cascade,
  nome                     text not null check (length(nome) between 1 and 80),
  ativo                    boolean not null default false,
  etapas                   jsonb not null default '[]'::jsonb
                             check (jsonb_typeof(etapas) = 'array' and jsonb_array_length(etapas) <= 30),
  gatilho_palavras         text[] not null default '{}' check (cardinality(gatilho_palavras) <= 20),
  gatilho_etiquetas        text[] not null default '{}' check (cardinality(gatilho_etiquetas) <= 20),
  gatilho_etiquetas_nomes  text[] not null default '{}',
  excluir_etiquetas        text[] not null default '{}' check (cardinality(excluir_etiquetas) <= 20),
  excluir_etiquetas_nomes  text[] not null default '{}',
  palavras_humano          text[] not null default '{atendente,humano}' check (cardinality(palavras_humano) <= 20),
  msg_nao_entendi          text not null default 'Não entendi. Responda com o número de uma das opções.'
                             check (length(msg_nao_entendi) between 1 and 1000),
  msg_humano               text not null default 'Certo! Já chamei alguém da equipe para falar com você.'
                             check (length(msg_humano) between 1 and 1000),
  aviso_numero             text check (aviso_numero is null or aviso_numero ~ '^[0-9]{10,15}$'),
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now()
);
create index if not exists bot_fluxos_conta_ativo_idx on public.bot_fluxos (conta_id) where ativo;

alter table public.bot_fluxos enable row level security;
alter table public.bot_fluxos force row level security;
create policy bot_fluxos_sel on public.bot_fluxos for select using (conta_id = public.conta_do_usuario());
create policy bot_fluxos_ins on public.bot_fluxos for insert with check (conta_id = public.conta_do_usuario());
create policy bot_fluxos_upd on public.bot_fluxos for update using (conta_id = public.conta_do_usuario())
  with check (conta_id = public.conta_do_usuario());
create policy bot_fluxos_del on public.bot_fluxos for delete using (conta_id = public.conta_do_usuario());

-- ── bot_conversas ────────────────────────────────────────────────────────────
create table if not exists public.bot_conversas (
  id             uuid primary key default gen_random_uuid(),
  conta_id       uuid not null references public.contas(id) on delete cascade,
  celular        text not null check (celular ~ '^[0-9]{10,15}$'),
  nome           text check (nome is null or length(nome) <= 80),
  fluxo_id       uuid references public.bot_fluxos(id) on delete set null,
  etapa_id       text check (etapa_id is null or length(etapa_id) <= 40),
  variaveis      jsonb not null default '{}'::jsonb check (jsonb_typeof(variaveis) = 'object'),
  status         text not null default 'ativa' check (status in ('ativa', 'humano', 'encerrada', 'descadastrado')),
  nao_entendi    integer not null default 0 check (nao_entendi >= 0),
  ocupado_ate    timestamptz,               -- trava enquanto o robô "digita" e envia
  versao         integer not null default 0, -- trava otimista de quem processa a mensagem
  iniciado_em    timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (conta_id, celular)
);
create index if not exists bot_conversas_conta_atualizado_idx on public.bot_conversas (conta_id, atualizado_em desc);
create index if not exists bot_conversas_descadastrados_idx on public.bot_conversas (conta_id, celular) where status = 'descadastrado';

alter table public.bot_conversas enable row level security;
alter table public.bot_conversas force row level security;
create policy bot_conversas_sel on public.bot_conversas for select using (conta_id = public.conta_do_usuario());
create policy bot_conversas_ins on public.bot_conversas for insert with check (conta_id = public.conta_do_usuario());
create policy bot_conversas_upd on public.bot_conversas for update using (conta_id = public.conta_do_usuario())
  with check (conta_id = public.conta_do_usuario());
create policy bot_conversas_del on public.bot_conversas for delete using (conta_id = public.conta_do_usuario());

-- ── bot_mensagens ────────────────────────────────────────────────────────────
create table if not exists public.bot_mensagens (
  id           uuid primary key default gen_random_uuid(),
  conta_id     uuid not null references public.contas(id) on delete cascade,
  conversa_id  uuid not null references public.bot_conversas(id) on delete cascade,
  direcao      text not null check (direcao in ('recebida', 'enviada', 'evento')),
  texto        text not null check (length(texto) <= 4000),
  wa_id        text check (wa_id is null or length(wa_id) <= 200),
  criado_em    timestamptz not null default now()
);
create index if not exists bot_mensagens_conversa_idx on public.bot_mensagens (conversa_id, criado_em);
-- A uazapi pode entregar a mesma mensagem mais de uma vez: só a 1ª chamada processa.
create unique index if not exists bot_mensagens_wa_id_uniq on public.bot_mensagens (conta_id, wa_id) where wa_id is not null;

alter table public.bot_mensagens enable row level security;
alter table public.bot_mensagens force row level security;
create policy bot_mensagens_sel on public.bot_mensagens for select using (conta_id = public.conta_do_usuario());
create policy bot_mensagens_ins on public.bot_mensagens for insert with check (conta_id = public.conta_do_usuario());
create policy bot_mensagens_upd on public.bot_mensagens for update using (conta_id = public.conta_do_usuario())
  with check (conta_id = public.conta_do_usuario());
create policy bot_mensagens_del on public.bot_mensagens for delete using (conta_id = public.conta_do_usuario());

-- ── campanhas_wa: fluxo de quem responder ao disparo ─────────────────────────
alter table public.campanhas_wa
  add column if not exists fluxo_id uuid references public.bot_fluxos(id) on delete set null;
-- Achar "esse número recebeu um disparo ligado a um fluxo?" sem varrer a conta inteira.
create index if not exists campanha_destinatarios_conta_celular_idx on public.campanha_destinatarios (conta_id, celular);
