---
name: isolamento-de-contas
description: Isolamento total entre contas (multi-tenancy) do Cobranx — cada conta é um universo fechado, com o mecanismo concreto de RLS/Postgres deste projeto (policies, função helper, unicidade composta) e as 4+1 camadas de isolamento (banco, aplicação, serviços, observabilidade, recurso/noisy-neighbor). Use SEMPRE que criar/alterar cadastro de contas, provisionamento, qualquer tabela/migration/policy/query, telas com dados, jobs, instâncias WhatsApp, storage, cache, ou qualquer ponto onde dado ou desempenho de uma conta poderiam afetar outra. Use também ao investigar dado "estranho" — vazamento entre contas é sempre a primeira hipótese.
---

# Isolamento de Contas — Cobranx

## Princípio absoluto

Cada conta é um universo fechado. Uma conta nova nasce **zerada** — com suas próprias configurações padrão e zero dados — e em nenhuma circunstância vê, toca ou infere dados, configurações ou existência de qualquer outra conta. A única travessia permitida é o **modo admin da plataforma**, sempre auditado e visualmente sinalizado.

Vazamento entre contas é o bug mais grave possível do produto: destrói a confiança de todos os clientes de uma vez, é o tipo de furo que vira manchete. Todo dado "estranho" numa tela deve ser tratado primeiro como suspeita de vazamento, não como bug cosmético. Pedido de acesso cross-conta fora do Modo Admin formal ("só dessa vez, roda direto no banco") é recusado e redirecionado ao mecanismo auditado desta skill.

O isolamento vive em **4 camadas de dado + 1 de recurso**. Uma falha em qualquer uma quebra o todo — o banco protegido não salva um cache compartilhado.

## Conceito de tenant neste projeto

- **1 conta = 1 empresa.** O tenant é a `conta`. Desde a migration 0020 (multi-atendimento) uma conta pode ter vários usuários: o **dono** (`contas.owner_user_id`) e membros convidados em `membros_conta`, cada um com `role` `admin` ou `atendente`.
- O usuário autenticado (`auth.uid()`) mapeia para **uma** `conta`, seja como dono, seja como membro ativo — `conta_do_usuario()` (atualizada em 0020) resolve os dois casos.
- Admin (Felippe) é um papel separado (plataforma inteira), com acesso cross-conta controlado (ver "Modo admin" abaixo) — não confundir com o `role = 'admin'` de `membros_conta`, que é interno a UMA conta.

### Papéis dentro da conta (dono / admin / atendente)

Isolamento entre contas não basta quando a conta tem mais de um usuário — falta isolar **papéis dentro da mesma conta**. Achado real (SEG-N4, auditoria 2026-09-19): `conta_do_usuario()` passou a valer para qualquer membro ativo, mas as policies de `configuracoes`, `membros_conta` e `meios_pagamento` só checavam isso — nenhuma olhava o `role`. Um atendente lia e alterava credenciais (Meta, EfiBank, LookDefense — Meta e LookDefense já removidos do produto —, a chave PIX enviada ao cliente) e conseguia se promover a admin, tudo pelo próprio login, direto na API — a separação existia só na interface.

Regra: qualquer tabela onde uma ação (ler credencial, mudar papel de outro membro, trocar o texto que vai pro cliente) só deveria valer para dono/admin usa o helper, não `conta_do_usuario()` sozinho:

```sql
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
```

`SELECT` que todo membro precisa para trabalhar (listar a equipe, ler qual é a chave PIX padrão para montar a cobrança) continua liberado pra todos com `conta_do_usuario()`; é só a escrita/leitura de credencial que exige `pode_administrar_conta()`. Ver a migration `0033_papeis_na_conta.sql` e os 21 testes em `tests/db-papeis.test.ts` (Postgres real via PGlite, não o projeto compartilhado — ver skill `testes-cobranx`).

Consequência do lado do app: quando um fluxo do atendente (enviar mensagem, listar templates aprovados) precisa da credencial que ele não pode mais ler pela RLS, o servidor lê com **service role** depois de confirmar a conta via `getConta()` — nunca solta a policy para o atendente só para não reescrever a leitura (ver `atendimento/_actions/mensagens.ts`).

## Camada 1 — Banco (a fonte da verdade, mecanismo concreto)

Toda tabela que guarda dado de cliente do SaaS **obrigatoriamente** tem:

```sql
-- 1. Coluna + RLS forçado (nasce na mesma migration que cria a tabela)
alter table public.clientes enable row level security;
alter table public.clientes force row level security;  -- impede o owner da tabela escapar da policy

-- 2. Função helper de tenant (criar uma vez, usar em toda policy)
create or replace function public.conta_do_usuario()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from public.contas where owner_user_id = auth.uid() limit 1;
$$;

-- 3. As 4 policies explícitas
create policy "tenant_select" on public.clientes
  for select using (conta_id = public.conta_do_usuario());
create policy "tenant_insert" on public.clientes
  for insert with check (conta_id = public.conta_do_usuario());
create policy "tenant_update" on public.clientes
  for update using (conta_id = public.conta_do_usuario())
              with check (conta_id = public.conta_do_usuario());
create policy "tenant_delete" on public.clientes
  for delete using (conta_id = public.conta_do_usuario());
```

**Tabela sem RLS = trabalho rejeitado.** Não existe "depois eu coloco".

- **Views e funções `SECURITY DEFINER` NÃO herdam RLS automaticamente** — filtro explícito por `conta_id` (do `auth.uid()` ou de parâmetro validado no servidor) em cada uma. Este é o furo mais comum em sistemas com RLS "completo".
- Índice composto começando por `conta_id` em toda tabela que cresce.
- Agregações e relatórios (dashboards, contagens) sempre partem de query já escopada — nunca agregado global filtrado depois.
- **Unicidade é POR CONTA**, nunca global:
  ```sql
  create unique index clientes_cpf_por_conta on public.clientes (conta_id, cpf) where deleted_at is null;
  ```
  `UNIQUE (telefone)` global faria uma conta descobrir que outra tem aquele cliente — vazamento por inferência. Mesmo raciocínio vale para `local_part` de e-mail.
- Dados **globais do sistema** (planos do SaaS, templates-modelo de fábrica) vivem em tabelas separadas, sem nenhum dado de cliente, somente leitura para contas.
- **Soft delete** para dados financeiros (`deleted_at`), preservando histórico. Policies/queries de listagem filtram `deleted_at is null`.

## Camada 2 — Aplicação

- **Um único ponto de origem do escopo:** helper (`getConta()`) que deriva `conta_id` da sessão autenticada. Toda query, action e rota parte dele.
- PROIBIDO aceitar `conta_id` de body, query param, header ou formulário. O servidor sabe quem é a conta; o client nunca informa.
- **Achado sistêmico já encontrado em auditoria (não repetir):** `getConta()` retorna `{ supabase, contaId }`, mas várias mutations desestruturam só `{ supabase }` e o UPDATE/DELETE seguinte filtra apenas pelo `id` do recurso vindo do body/FormData, sem `.eq('conta_id', contaId)`. O RLS bloqueia isso na prática hoje, mas é defesa única — qualquer lapso futuro de RLS (tabela nova sem policy, view `SECURITY DEFINER` sem filtro) exporia dados imediatamente. **Toda mutation nova, e toda existente tocada, inclui `conta_id` explícito na query, nunca só no RLS.**
- Páginas que fazem `select` sem `.eq('conta_id', ...)` explícito, dependendo só de RLS, são a mesma classe de risco — ao tocar uma tela assim, adicionar o filtro explícito.
- PROIBIDO singleton, variável de módulo ou estado global carregando dados de uma conta — em Next.js, módulos são compartilhados entre requisições de contas diferentes.
- Todo INSERT grava `conta_id` obtido no servidor. Formulários não têm campo de conta, nem oculto.
- Cache (Next tags, React cache): a chave SEMPRE inclui `conta_id`. Tag `cobrancas` é vazamento; `cobrancas-${contaId}` é correto.
- Busca "pegar o primeiro/último registro" sem `.eq('conta_id', ...)` é proibida mesmo quando "só existe uma conta em dev".
- Erros nunca confirmam a existência de recurso alheio: recurso de outra conta responde "não encontrado" (404), jamais "sem permissão" (403).

## Camada 3 — Serviços e infraestrutura

- **Cron de WhatsApp:** cada execução do cron (`app/api/cron/whatsapp-uazapi`) processa conta por conta; falha numa conta não pode travar o processamento das outras (ver skill `whatsapp-uazapi`).
- **Instâncias WhatsApp (uazapi):** cada instância pertence a UMA conta. Antes de qualquer envio, confirmar o vínculo instância→conta; divergência → abortar e alertar. **Achado aberto (ISO-M1):** hoje esse vínculo em `forcarEnvioAction` é validado por convenção de nome, não por consulta ao banco — fragilidade a corrigir ao tocar esse código.
- **Storage:** arquivos em caminho por conta (`contas/{conta_id}/...`) com policy de acesso correspondente.
- **E-mails e mensagens:** remetente, reply-to e conteúdo montados a partir da configuração DA conta do destinatário do job — nunca de config "da última conta carregada".
- **Rate limit e cota por conta** (envios, jobs, storage) — limite global sozinho deixa uma conta consumir 100% da capacidade e sufocar o resto. Query pesada de uma conta não pode travar o banco para as demais.
- Restore de backup nunca mistura conta: sempre escopado, nunca "restaura tudo e depois filtra".

## Camada 4 — Observabilidade sem vazamento

- Logs e auditoria carregam `conta_id` (debug/incidente), mas nenhuma tela de conta exibe métricas, contagens ou rankings que agreguem outras contas.
- IDs expostos na UI/URLs são UUID (não sequencial global). Numeração amigável ("Cobrança #42") é sequência POR CONTA.

## Conta nova = conta zerada (resumo; fluxo completo na referência)

Numa única transação: linha em `contas` + usuário dono · **configurações padrão PRÓPRIAS** (nunca leitura de config compartilhada mutável) · **templates iniciais COPIADOS** dos templates-modelo · zero linhas em todo o resto. Falhou um passo → rollback total. Ler `references/provisionamento-e-ciclo-de-vida.md` ao mexer em criação, suspensão, reativação ou exclusão de contas.

Ciclo de vida: suspensão bloqueia ações novas mas mantém leitura/exportação; exclusão é processo (confirmação → exportação oferecida → desativar integrações → soft delete com janela → expurgo/anonimização auditados).

## Modo admin da plataforma (única travessia permitida)

- Exclusivo do papel `admin_plataforma`; contas normais jamais têm rota, tela ou query cross-conta.
- Impersonação: banner fixo e visível ("Você está vendo a conta X como admin"), sessão de impersonação com expiração curta.
- CADA acesso admin a dados de uma conta gera registro em auditoria (`admin_acessou_conta`, com motivo).
- **Agregação cross-conta legítima** (métrica de produto, faturamento da plataforma): via SEMPRE uma view/pipeline separada e explícita que expõe só o número consolidado — nunca uma query "solta" com filtro de conta removido "só para essa consulta". Resultado que permite inferir dado individual de uma conta pequena é vazamento; agregar em granularidade maior.

## Testes que provam o isolamento

- **Isolamento:** com duas contas de teste, autenticado na A, provar contra CADA tabela: SELECT nos dados da B → 0 linhas; INSERT com conta da B → falha; UPDATE/DELETE em registro da B → 0 linhas. Tabela nova entra na lista no mesmo PR que a cria (ver skill `testes-cobranx`).
- **Provisionamento:** conta nova tem exatamente as linhas esperadas (configurações e templates próprios; zero no resto).
- **Recurso:** teste de carga simulando conta abusiva confirma que rate limit/cota entra em ação antes de afetar outra conta, quando essa camada existir implementada.

## Checklist antes de encerrar qualquer tarefa que toque dados ou contas

- [ ] Toda query nova parte de `getConta()`/`conta_do_usuario()` (nenhum `conta_id` vindo do client)?
- [ ] Mutation inclui `conta_id` explícito na query, não só confia no RLS?
- [ ] Views/RPCs criadas filtram `conta_id` explicitamente?
- [ ] Constraints UNIQUE novas são compostas com `conta_id`?
- [ ] Chaves de cache/tags incluem `conta_id`?
- [ ] Vínculo instância→conta confirmado por consulta ao banco antes de qualquer envio?
- [ ] Nenhum estado de conta em variável de módulo/singleton?
- [ ] Recurso alheio responde 404 (não 403)?
- [ ] Tabela nova incluída no teste de isolamento E no de provisionamento?
- [ ] Rate limit/cota de recurso pesado é por conta, não só global?
- [ ] Acesso admin cross-conta (se tocado) audita e sinaliza impersonação? Agregação cross-conta passou pela via separada?
- [ ] Tabela nova/tocada com dado sensível a papel (credencial, chave PIX, gestão de equipe) usa `pode_administrar_conta()`, não só `conta_do_usuario()`? Se um fluxo de atendente precisa da credencial mesmo assim, lê com service role depois de `getConta()` — nunca afrouxa a policy.
