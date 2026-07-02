# Auditoria Cobranx — PROMPT MESTRE v2
**Data:** 2026-07-02 | **Ramo:** `auditoria-skills` | **Esforço:** 6 agentes paralelos × 8 frentes

---

## Sumário executivo

A auditoria cobriu 8 frentes: Segurança, Isolamento multi-tenant, Qualidade de código, Design, Sincronização e integridade, Performance, Regras de negócio e Testes.

**Total de achados:** 60 únicos (8 CRÍTICOS · 27 ALTOS · 18 MÉDIOS · 7 BAIXOS)

### Os 3 problemas sistêmicos mais graves

1. **UPDATE em `notificacoes_enviadas` sem policy RLS** — o cancelamento de notificações ao dar baixa em parcelas está silenciosamente falhando em produção. Clientes com parcelas pagas continuam recebendo lembretes.

2. **Pattern de isolamento deficiente** — em ~10 mutations, `getConta()` retorna `{ supabase, contaId }` mas o código desestrutura apenas `{ supabase }`, descartando `contaId`. Os UPDATEs/DELETEs filtram só pelo ID do recurso vindo do body, sem confirmar que pertence à conta. O RLS protege hoje, mas é uma única linha de defesa.

3. **Ausência quase total de testes** — apenas 1 arquivo de teste existe (`rls-isolation.test.ts` cobrindo só `clientes` e `contas`). Nenhuma regra financeira tem prova automatizada.

### Decisões para validar com Felippe

| # | Questão | Contexto |
|---|---------|---------|
| D1 | **Float vs centavos inteiros:** o banco usa `numeric(12,2)` e o código usa `parseFloat`. A regra documenta "centavos inteiros no banco". Migrar agora (adicionar coluna inteira, migrar dados) ou aceitar o padrão float como decisão do projeto? | Impacta toda lógica financeira e testes |
| D2 | **Boas-vindas ignorando `ativo_whatsapp`/`ativo_email` do config:** hoje enfileira ambos os canais independente da configuração da conta. Comportamento intencional? | Pode enviar por canal que o usuário desabilitou |
| D3 | **Janela de envio e intervalo por conta:** a tabela `configuracoes` tem `horario_inicio`, `horario_fim`, `intervalo_min_seg`, `intervalo_max_seg`, mas o worker usa sempre 09–20h e 45–80s hardcoded. Implementar resposta à config ou fixar esses valores? | Feature incompleta ou design intencional |
| D4 | **Auditoria de ações do tenant:** a tabela `audit_log` existe e é usada para admin. Estender para ações do próprio usuário (cancelar cobrança, dar baixa, excluir cliente)? | Compliance, disputas futuras |
| D5 | **Parcelas recorrentes ao dar baixa:** o código gera a próxima parcela imediatamente no `baixarParcelaAction`, com comentário dizendo que o scheduler é "safety net". A skill e o próprio comentário no código marcam isso como PROIBIDO. Remover a geração imediata e depender só do scheduler? | Risco real: lembrete D-5 perdido se baixa ocorrer perto da data |

---

## Achados completos

### FRENTE 1 — SEGURANÇA

| ID | Gravidade | Achado | Arquivo | Linha |
|---|-----------|--------|---------|-------|
| SEG-C1 | **CRÍTICO** | Webhook Mercado Pago processa payload sem validar assinatura se `MP_WEBHOOK_SECRET` não estiver configurado | `app/api/mercadopago/webhook/route.ts` | 15 |
| SEG-C2 | **CRÍTICO** | Endpoint de descadastro sem autenticação e sem rate limit — qualquer UUID pode ser usado para opt-out em massa | `app/api/descadastrar/[clienteId]/route.ts` | — |
| SEG-A1 | **ALTO** | `next.config.ts` vazio — todos os headers HTTP de segurança ausentes (HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) | `next.config.ts` | — |
| SEG-A2 | **ALTO** | Rate limit ausente em todos os endpoints públicos: login, recuperação, webhooks, descadastro | middleware + routes | — |
| SEG-A3 | **ALTO** | Inputs sem Zod em todas as server actions — validação manual ad hoc com lacunas | todos `_actions/*.ts` | — |
| SEG-A4 | **ALTO** | Ações do tenant sem registro em `audit_log` (cancelar cobrança, dar baixa, excluir cliente) | `cobrancas/_actions/cobrancas.ts` | 181 |
| SEG-A5 | **ALTO** | `uazapi_instance_token` armazenado em texto claro no banco | `supabase/migrations/0009_uazapi.sql` | — |
| SEG-A6 | **ALTO** | Webhook uazapi sem verificação de assinatura — permite forjar desconexão ou QR falso | `app/api/webhook/uazapi/route.ts` | — |
| SEG-M2 | **MÉDIO** | Middleware não verifica `conta.status` nem `validade_plano` — conta suspensa/expirada acessa o app se tiver sessão ativa | `middleware.ts` | — |
| SEG-M3 | **MÉDIO** | Texto bruto da resposta do uazapi retornado ao cliente em `forcarEnvioAction` — pode vazar info interna | `app/(app)/log/_actions/log.ts` | 166 |
| SEG-M4 | **MÉDIO** | Mensagem de erro do Supabase (`cfgErr.message`) retornada ao cliente — vaza estrutura interna | `configuracoes/_actions/configuracoes.ts` | 38 |
| SEG-M5 | **MÉDIO** | Health check `/health` do worker sem autenticação — expõe `contas_conectadas` | `worker/src/index.ts` | 147 |
| SEG-B1 | **BAIXO** | Validação de senha mínima (8 chars) só no client-side | `app/(auth)/nova-senha/page.tsx` | 20 |
| SEG-B2 | **BAIXO** | `pg_cron` deleta `notificacoes_enviadas` após 10 dias sem registro em `audit_log` | `supabase/migrations/0002_correcoes.sql` | 110 |

---

### FRENTE 2 — ISOLAMENTO DE CONTAS

**Padrão sistêmico:** `getConta()` retorna `{ supabase, contaId }` mas vários pontos desestrutura apenas `{ supabase }`, descartando `contaId`. UPDATEs/DELETEs subsequentes filtram só pelo ID do recurso (vindo do FormData/body), sem confirmar que o recurso pertence à conta. O RLS bloqueia cross-tenant na prática, mas qualquer lapso futuro de RLS (tabela nova sem policy, view SECURITY DEFINER) exporia dados imediatamente.

| ID | Gravidade | Achado | Arquivo | Linha |
|---|-----------|--------|---------|-------|
| ISO-A1 | **ALTO** | 4 pages (dashboard, cobrancas, caixa, log) com queries sem `conta_id` explícito — dependência exclusiva de RLS | `dashboard/page.tsx` + 3 outras | 28–46 |
| ISO-A2 | **ALTO** | `cancelarCobrancaAction`: `contaId` descartado; UPDATE filtra só por `id` do body | `cobrancas/_actions/cobrancas.ts` | 183 |
| ISO-A3 | **ALTO** | `excluirMeioAction`: `contaId` descartado; DELETE filtra só por `id` | `tipo-pagamento/_actions/meios.ts` | 81 |
| ISO-A4 | **ALTO** | `definirPadraoAction`: primeiro UPDATE correto, segundo UPDATE sem `conta_id` | `tipo-pagamento/_actions/meios.ts` | 47 |
| ISO-A5 | **ALTO** | `cobrarManualAction`: `conta_id` copiado da parcela (banco), não derivado da sessão | `cobrancas/_actions/parcelas.ts` | 15 |
| ISO-A6 | **ALTO** | `baixarParcelaAction` e `editarParcelaAction`: `requireUser()` não resolve `contaId`; todos os UPDATEs sem conta_id | `cobrancas/_actions/parcelas.ts` | 60, 194 |
| ISO-A7 | **ALTO** | `excluirClienteAction`: `contaId` descartado; UPDATE sem `conta_id` | `clientes/_actions/clientes.ts` | 152 |
| ISO-A8 | **ALTO** | Soft-delete de cliente feito diretamente do browser via `createClient()` (client-side) em vez de Server Action | `clientes/page.tsx` | 173 |
| ISO-M1 | **MÉDIO** | Vínculo conta→instância em `forcarEnvioAction` validado por convenção de nome, não por consulta ao banco | `log/_actions/log.ts` | 137 |
| ISO-M2 | **MÉDIO** | Verificação de limite de clientes (plano) sem `conta_id` na query | `clientes/_actions/clientes.ts` | 77 |
| ISO-M3 | **MÉDIO** | Erro de `local_part` duplicado revela existência de outra conta — violação LGPD/informação | `configuracoes/_actions/configuracoes.ts` | 57 |
| ISO-B1 | **BAIXO** | Worker: busca de `meios_pagamento` e `parcelas` sem `conta_id` (service role, risco baixo mas sem defesa em profundidade) | `variaveis.ts`, `email-worker.ts` | — |

---

### FRENTE 3 — QUALIDADE DE CÓDIGO

| ID | Gravidade | Achado | Arquivo(s) | Linha(s) |
|---|-----------|--------|-----------|---------|
| COD-A1 | **ALTO** | Valores monetários com `parseFloat` — a regra "centavos inteiros" nunca foi implementada no banco (`numeric(12,2)`). `somarValores` tem risco de drift de ponto flutuante | `variaveis.ts`, `format.ts`, `parcelas.ts`, `cobrancas.ts`, `lancamentos.ts` | vários |
| COD-A2 | **ALTO** | `as any` pervasivo em worker e app (40+ ocorrências) — consequência da ausência de `database.types.ts` | worker inteiro + `log.ts`, `parcelas.ts` | vários |
| COD-M1 | **MÉDIO** | `error` do Supabase ignorado em todos os UPDATEs de estado do worker (`enviado`, `falhou`, `cancelado`) | `whatsapp-worker.ts`, `email-worker.ts` | vários |
| COD-M2 | **MÉDIO** | 10 ocorrências de `catch {}` vazio no `uazapi-manager` — falhas de reconexão e sync de banco silenciadas | `uazapi-manager.ts` | 163, 259, 275, 416, 428, 472, 486, 499, 543, 565 |
| COD-M3 | **MÉDIO** | `cancelarCobrancaAction` sem verificação de erro, sem retorno — falha silenciosa, redirect ocorre como sucesso | `cobrancas/_actions/cobrancas.ts` | 181 |
| COD-M4 | **MÉDIO** | `excluirClienteAction` sem verificação de erro | `clientes/_actions/clientes.ts` | 152 |
| COD-M5 | **MÉDIO** | Listagens de parcelas e lancamentos em `cobrancas/page.tsx` sem `.order()` explícito | `cobrancas/page.tsx` | 39–49 |
| COD-M6 | **MÉDIO** | `cancelarNotificacaoAction` e `reenviarNotificacaoAction` retornam `void` sem verificar `error` do Supabase | `log/_actions/log.ts` | 19–49 |
| COD-B1 | **BAIXO** | Queries de variaveis (clientes, saudações) sem verificação de `error` — template enviado com placeholders literais se banco falhar | `variaveis.ts` | 26–39 |
| COD-B2 | **BAIXO** | Lógica de resolução de variáveis de template duplicada entre `worker/src/variaveis.ts` e `app/(app)/log/_actions/log.ts` | ambos | — |

---

### FRENTE 4 — SINCRONIZAÇÃO E INTEGRIDADE

| ID | Gravidade | Achado | Arquivo | Linha |
|---|-----------|--------|---------|-------|
| SIN-C1 | **CRÍTICO** | `NOTIF_TIPOS` e `NOTIF_DEFAULTS` nunca atualizados: falta `'agendada'`; contas novas sem template de `pagamento_confirmado` | `lib/notificacao/tipos.ts` | 6–15 |
| SIN-C2 | **CRÍTICO** | `UAZAPI_URL` e `UAZAPI_ADMIN_TOKEN` ausentes do `.env.example` do frontend | `.env.example` (raiz) | — |
| SIN-A1 | **ALTO** | `uazapi_instance_token` nunca gravado pelo worker — webhook de status de conexão (`/api/webhook/uazapi`) está inoperante | `worker/src/uazapi-manager.ts` vs `app/api/webhook/uazapi/route.ts` | — |
| SIN-A2 | **ALTO** | Header admin inconsistente: `AdminToken` (Pascal) em `lib/uazapi.ts` vs `admintoken` (minúsculas) no worker e `log.ts` — um dos dois pode estar falhando | `lib/uazapi.ts:21` vs `uazapi-manager.ts:93` | — |
| SIN-A3 | **ALTO** | `notificacoes_enviadas` sem policy RLS de UPDATE — cancelamentos feitos pelo anon client em `cancelarCobrancaAction` e `baixarParcelaAction` falham silenciosamente | `cobrancas/_actions/cobrancas.ts:196,201`, `parcelas.ts:97` | — |
| SIN-M1 | **MÉDIO** | Fallback `NEXT_PUBLIC_SITE_URL` no worker nunca funciona no VPS — links de opt-out ficarão com `localhost:3000` se `SITE_URL` não for provisionado | `email-worker.ts` | 17 |
| SIN-M2 | **MÉDIO** | Nenhum `database.types.ts` gerado — divergências de schema entre banco e código são completamente silenciosas | todo o projeto | — |
| SIN-B1 | **BAIXO** | Campo `session_ref` em `worker/src/types.ts` é resquício do Baileys, nunca lido/gravado pelo uazapi | `worker/src/types.ts` | 9 |

---

### FRENTE 5 — PERFORMANCE

| ID | Gravidade | Achado | Arquivo | Linha |
|---|-----------|--------|---------|-------|
| PERF-A1 | **ALTO** | N+1+N em `manterParcelasRecorrentes`: 1 query para listar cobranças + 1 query por cobrança para checar parcela aberta + 1 para última parcela | `scheduler.ts` | 56–104 |
| PERF-M1 | **MÉDIO** | Índice `idx_notif_fila` não inclui `canal` — filtro `eq('canal', 'whatsapp'/'email')` é residual em tabela grande | `0001_schema_inicial.sql` | 262 |
| PERF-M2 | **MÉDIO** | Inserts de WhatsApp e email no scheduler são sequenciais por parcela — poderiam ser `Promise.all` | `scheduler.ts` | 135–166 |
| PERF-B1 | **BAIXO** | Loop serial de contas no scheduler — escalará mal com 50+ contas | `scheduler.ts` | 42–51 |
| PERF-B2 | **BAIXO** | Query extra para confirmar existência do cliente ao enfileirar boas-vindas (redundante — FK já garante) | `cobrancas/_actions/cobrancas.ts` | 84–86 |

---

### FRENTE 6 — REGRAS DE NEGÓCIO

| ID | Gravidade | Achado | Arquivo | Linha |
|---|-----------|--------|---------|-------|
| RN-C1 | **CRÍTICO** | `baixarParcelaAction` gera próxima parcela recorrente imediatamente — regra documenta PROIBIDO; `lib/utils/parcelas.ts` também avisa. Risco: lembretes D-5/D-3 perdidos se baixa ocorrer perto da data | `cobrancas/_actions/parcelas.ts` | 151–186 |
| RN-A1 | **ALTO** | Baixa de pagamento não atômica: 6 operações sequenciais sem transação — parcela pode ser marcada `paga` sem lançamento criado | `cobrancas/_actions/parcelas.ts` | 60–190 |
| RN-A2 | **ALTO** | Erros Supabase ignorados em 4 operações financeiras da baixa (insert lançamento, cancel notificações, insert novas notificações) | `cobrancas/_actions/parcelas.ts` | 84, 93, 129, 133 |
| RN-M1 | **MÉDIO** | Boas-vindas enfileira ambos os canais sem verificar `ativo_whatsapp`/`ativo_email` das configurações da conta | `cobrancas/_actions/cobrancas.ts` | 83–95, 161–169 |
| RN-M2 | **MÉDIO** | Janela de envio (09–20h) e intervalo (45–80s) hardcodados no worker — configuração da conta em `configuracoes` nunca é lida | `worker/src/format.ts` | 24–28 |
| RN-M3 | **MÉDIO** | Dois caminhos de cálculo de vencimento mensal (`lib/utils/parcelas.ts` e `worker/src/scheduler.ts`) — lógica duplicada, risco de divergência futura | ambos | — |
| RN-M4 | **MÉDIO** | `pagamento_confirmado` sem constraint de idempotência no banco — low risk pelo guard existente, mas sem proteção de banco | migrations | — |

---

### FRENTE 7 — DESIGN

| ID | Gravidade | Achado | Arquivo | Linha |
|---|-----------|--------|---------|-------|
| DES-A1 | **ALTO** | Cores hardcoded `bg-green-500`, `text-green-400`, `bg-yellow-500` em vez de tokens CSS em `conexao/page.tsx` | `conexao/page.tsx` | 87, 90, 108–112 |
| DES-A2 | **ALTO** | Server Components sem skeleton de loading e sem estado de erro — telas ficam em branco se fetch falhar | 7 telas | — |
| DES-M1 | **MÉDIO** | `shadow-2xl` em sheets/drawers (proibido — máximo `shadow-sm`) | `clientes/page.tsx`, `tipo-pagamento/page.tsx`, `notificacao/page.tsx` | — |
| DES-M2 | **MÉDIO** | `shadow-xl` no dropdown de variáveis de template | `notificacao/page.tsx` | 86 |
| DES-M3 | **MÉDIO** | Badge "Ativo" sempre verde na lista de clientes — usuário na aba "Todos" não diferencia clientes ativos de inativos | `clientes/page.tsx` | 318–321 |
| DES-M4 | **MÉDIO** | Status de log exibido como valor raw do banco (ex: `enviado`, `lido`) sem mapa de tradução/capitalização | `log/page.tsx` | 109 |
| DES-M5 | **MÉDIO** | Confirmações destrutivas sem descrever o impacto ("Isso cancelará X notificações") | `clientes/page.tsx`, `cobrancas-table.tsx` | — |
| DES-M6 | **MÉDIO** | Botões de ícone sem `aria-label` em `cobrancas-table.tsx` (baixa, cancelar) | `cobrancas-table.tsx` | 178–219 |
| DES-B1 | **BAIXO** | `rounded-full` sistemático em badges — design-system especifica `rounded-md` | 9 arquivos | — |
| DES-B2 | **BAIXO** | `select('*')` em 5 pontos de Server Components (meios_pagamento, configuracoes, notificacoes_config, conexoes) | vários | — |

---

### FRENTE 8 — TESTES

| ID | Gravidade | Achado | Arquivo | Detalhe |
|---|-----------|--------|---------|---------|
| TST-C1 | **CRÍTICO** | Ausência quase total de testes — 1 arquivo existe (`rls-isolation.test.ts`), nenhuma regra financeira coberta | `tests/` | — |
| TST-C2 | **CRÍTICO** | `calcularVencimento` sem teste (dia 31/fev, virada de ano, fronteira UTC vs. SP) | `lib/utils/parcelas.ts` | — |
| TST-C3 | **CRÍTICO** | Baixa atômica (parcela + lançamento + cancelar notificações) sem teste transacional | — | — |
| TST-C4 | **CRÍTICO** | Nenhum teste usa `vi.setSystemTime` — testes de data futuros seriam flaky por depender do clock real | — | — |
| TST-C5 | **CRÍTICO** | Worker sem testes de idempotência e Baileys/uazapi não mockado | `worker/src/` | — |
| TST-A1 | **ALTO** | RLS testado só em `clientes` e `contas` — demais tabelas (`parcelas`, `lancamentos`, `notificacoes_enviadas`, etc.) sem cobertura | `tests/rls-isolation.test.ts` | — |
| TST-A2 | **ALTO** | Playwright não instalado — zero testes E2E dos 5 fluxos vitais | `package.json` | — |

---

## Plano de 4 ondas

> Aguardar confirmação antes de cada onda. Digitar **"aprovado onda N"** para iniciar.

---

### ONDA 1 — Produção quebrando hoje (prioridade máxima)
*Estimativa: 1 sessão de trabalho*

**Por que onda 1:** estes itens têm impacto direto em produção agora — clientes recebendo notificações depois de pagar (SIN-A3), webhook de conexão inoperante (SIN-A1), risco de fraude de pagamento (SEG-C1), descadastro em massa possível (SEG-C2).

| # | Achado | Ação |
|---|--------|------|
| 1 | **SIN-A3** — Policy RLS de UPDATE ausente em `notificacoes_enviadas` | Adicionar migration com policy `tenant_update` (ou mudar para service role nesses updates) |
| 2 | **SEG-C1** — Webhook MP sem assinatura obrigatória | Tornar a validação HMAC obrigatória (retornar 401 se secret ausente) |
| 3 | **SEG-C2** — Endpoint descadastro sem autenticação | Adicionar token no link de e-mail + validação no endpoint |
| 4 | **SIN-A1** — `uazapi_instance_token` nunca gravado | Worker gravar token no banco ao conectar; webhook passou a funcionar |
| 5 | **SIN-A2** — Header admin inconsistente | Unificar para `admintoken` (minúsculas) em todos os pontos |
| 6 | **SIN-C1** — `NOTIF_TIPOS` desatualizado | Adicionar `'agendada'` e template de `pagamento_confirmado` ao `NOTIF_DEFAULTS` |
| 7 | **SEG-A1** — Headers HTTP ausentes | Adicionar headers no `next.config.ts` (HSTS, CSP, X-Frame, nosniff, etc.) |
| 8 | **SIN-C2** — Vars ausentes do `.env.example` | Documentar `UAZAPI_URL` e `UAZAPI_ADMIN_TOKEN` |

---

### ONDA 2 — Segurança e isolamento (risco elevado)
*Estimativa: 1–2 sessões*

**Por que onda 2:** padrão sistêmico de isolamento deficiente e segurança da aplicação. O RLS protege hoje, mas a defesa em profundidade está faltando.

| # | Achado | Ação |
|---|--------|------|
| 1 | **ISO-A2 a A8** — Pattern sistêmico de `contaId` descartado | Corrigir todas as mutations para incluir `.eq('conta_id', contaId)` como segunda condição; mover soft-delete de `clientes/page.tsx` para Server Action |
| 2 | **RN-A1 + RN-A2** — Baixa não atômica + erros ignorados | Criar RPC Postgres para a baixa (transação real); verificar todos os `error` |
| 3 | **SEG-A6** — Webhook uazapi sem assinatura | Implementar validação de assinatura ou segredo compartilhado |
| 4 | **SEG-M2** — Middleware não verifica `conta.status` | Adicionar verificação de conta ativa/válida no middleware |
| 5 | **COD-M3, M4, M6** — Actions sem verificação de erro | Adicionar `if (error)` e retorno `{ ok, erro }` |
| 6 | **ISO-M3** — Erro de `local_part` vaza existência de outra conta | Mensagem genérica: "Este nome de remetente não está disponível" |

---

### ONDA 3 — Qualidade de código e regras de negócio
*Estimativa: 1–2 sessões*

**Por que onda 3:** dívida técnica acumulada que aumenta risco de bug a cada feature nova.

| # | Achado | Ação |
|---|--------|------|
| 1 | **SIN-M2 + COD-A2** — Sem types gerados | Executar `supabase gen types typescript`, commit do `database.types.ts`, remover `as any` decorrentes |
| 2 | **RN-C1** — Parcelas recorrentes ao dar baixa | Remover geração imediata de `baixarParcelaAction`; depender exclusivamente do scheduler (decisão D5 — confirmar primeiro) |
| 3 | **RN-M2** — Janela/intervalo hardcoded | Ler `configuracoes` por conta no worker (decisão D3 — confirmar primeiro) |
| 4 | **COD-M1 + COD-M2** — Erros ignorados no worker | Verificar `error` em todos os UPDATEs; trocar `catch {}` por `logger.warn` |
| 5 | **COD-B2** — Lógica duplicada de variáveis | Extrair para módulo compartilhado ou aceitar duplicação com teste que garante equivalência |
| 6 | **SEG-A3** — Sem Zod nas actions | Adicionar schemas Zod progressivamente (começar pelas actions mais críticas: baixa, cancelamento) |
| 7 | **PERF-A1** — N+1 no scheduler | Reescrever `manterParcelasRecorrentes` com LEFT JOIN para buscar tudo em 1–2 queries |
| 8 | **RN-M1** — Boas-vindas sem verificar config | Checar `ativo_whatsapp`/`ativo_email` do tipo `boasvindas` nas configs da conta antes de enfileirar |

---

### ONDA 4 — Design, testes e polimento
*Estimativa: 2–3 sessões*

**Por que onda 4:** melhoria de qualidade e confiabilidade de longo prazo.

| # | Achado | Ação |
|---|--------|------|
| 1 | **TST-C1 a C5** — Ausência de testes financeiros | Criar testes: `calcularVencimento` (dia 31/fev, virada de ano), baixa atômica, idempotência do job; com `vi.setSystemTime` |
| 2 | **TST-A1** — RLS testado só em 2 tabelas | Expandir `rls-isolation.test.ts` para todas as tabelas de negócio |
| 3 | **TST-A2** — Sem Playwright | Instalar e criar os 5 fluxos E2E vitais (login, criar cobrança, dar baixa, cancelar notificação) |
| 4 | **DES-A2** — Server Components sem skeleton/erro | Adicionar `loading.tsx` com skeleton e `error.tsx` nas rotas principais |
| 5 | **DES-A1** — Cores hardcoded em `conexao/page.tsx` | Migrar para tokens CSS (`text-success`, `text-warning`) |
| 6 | **DES-M1, M2** — Shadows excessivos | Substituir `shadow-2xl`/`shadow-xl` por `shadow-sm` ou `shadow` |
| 7 | **DES-M4** — Status de log em raw | Criar mapa de rótulos PT-BR para status de notificação |
| 8 | **DES-M6** — Botões sem aria-label | Adicionar `aria-label` em todos os botões ícone de `cobrancas-table.tsx` |
| 9 | **SEG-A4** — Ações tenant sem audit_log | Registrar cancelamento, baixa e exclusão em `logs_auditoria` (decisão D4 — confirmar primeiro) |
| 10 | **PERF-M1** — Índice sem `canal` | Migration: índice composto `(status, canal, agendado_para) WHERE status = 'fila'` |
