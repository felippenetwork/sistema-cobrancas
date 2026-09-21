# Auditoria Cobranx — 2026-09-19 (atualiza `auditoria-skills.md` de 2026-07-02)
**Ramo:** `main` | **Esforço:** 6 agentes paralelos × 6 frentes, contra as skills já consolidadas (`.claude/skills/`, ver `project-skills-consolidadas` na memória)

---

## Sumário executivo

Desde julho, boa parte do trabalho pesado foi feito de verdade: a baixa de parcela virou atômica (RPC `baixar_parcela`), os dois achados **CRÍTICOS** de segurança de julho (webhook Mercado Pago sem assinatura, descadastro sem autenticação) foram corrigidos corretamente, os headers de segurança (`next.config.ts`) existem, o padrão sistêmico de `conta_id` descartado foi corrigido em 7 das 8 ocorrências originais, e a suíte de testes saiu de 1 arquivo/0 teste financeiro para 64 testes passando.

Mas a migração de arquitetura (worker/Baileys → uazapi direto) abriu buracos novos, o hábito de "ignorar `error`"/"colar `as any`" continua sendo reintroduzido em código novo, e a maior descoberta desta rodada não é um bug — é uma ausência estrutural: **o Cobranx não tem porta de entrada.** Não existe landing page, não existe cadastro self-service, não existe página de preços. Hoje só se vira cliente do Cobranx sendo cadastrado manualmente pelo Felippe.

**Os 3 problemas mais graves — situação ao fim de 2026-09-19:**

1. ~~`POST /api/webhooks/whatsapp` sem validação de assinatura~~ — **resolvido** (Meta: `X-Hub-Signature-256` com o App Secret da conta; uazapi: segredo compartilhado; 10 testes).
2. ~~**Qualquer atendente lia e alterava as credenciais da conta (SEG-N4)**~~ — **resolvido** (migration `0033_papeis_na_conta.sql`; 21 testes provam em Postgres real que só dono/admin conseguem).
3. **Não existe landing page, preço público nem cadastro self-service** — o domínio manda direto pro login. É a lacuna que mais impede vender.

Outros pontos que pedem decisão sua: **SEG-N5** (webhook EfiBank confia no corpo da notificação; confirmar via API exige o escopo `cob.read`).

---

## FRENTE 1 — Segurança

| ID | Status | Gravidade | Achado | Arquivo:linha |
|---|---|---|---|---|
| SEG-C1 | ✅ RESOLVIDO | — | Webhook Mercado Pago exige `MP_WEBHOOK_SECRET` e valida HMAC obrigatoriamente | `app/api/mercadopago/webhook/route.ts:11-40` |
| SEG-C2 | ✅ RESOLVIDO | — | Descadastro exige token HMAC validado com `timingSafeEqual` | `app/api/descadastrar/[clienteId]/route.ts:16-31` |
| SEG-A1 | ✅ RESOLVIDO | — | Headers de segurança completos (HSTS, CSP, X-Frame, nosniff, Referrer-Policy, Permissions-Policy) | `next.config.ts:1-39` |
| SEG-A2 | ❌ ABERTO | ALTO | Nenhum rate limit em login/cadastro/recuperação/webhooks | — |
| SEG-A3 | ❌ ABERTO (parcial) | ALTO | Zod só em 3 de ~18 `_actions`; resto valida na mão | `configuracoes/_actions/configuracoes.ts` e outros |
| SEG-A4 | ❌ ABERTO | ALTO | Ações do tenant (cancelar, dar baixa, excluir) não geram auditoria — só ações de admin geram | `cobrancas.ts`, `parcelas.ts`, `clientes.ts` |
| SEG-A5 | ❌ ABERTO, escopo maior | ALTO | Token uazapi **+ agora também** secret/certificado EfiBank e senha LookDefense em texto claro no banco | `configuracoes.ts:98-114`; `lib/lookdefense/renovar-imediato.ts:66-80` |
| SEG-A6 | ✅ RESOLVIDO (2026-09-19) | — | Webhook uazapi agora recusa (500) se `UAZAPI_WEBHOOK_SECRET` não estiver configurado, em vez de aceitar sem validar | `app/api/webhook/uazapi/route.ts:7-20` |
| SEG-M2 | ✅ RESOLVIDO | — | Middleware + layout bloqueiam conta suspensa/expirada | `middleware.ts:70-82` |
| SEG-M3 | ❌ ABERTO | MÉDIO | Resposta bruta da uazapi devolvida ao client em falha de envio | `log/_actions/log.ts:298-301` |
| SEG-M4 | ❌ ABERTO, piorou | MÉDIO | Erro do Supabase devolvido cru em quase toda action de configurações | `configuracoes.ts:27,54,81,116,143` |
| SEG-M5 | 💤 dormente | BAIXO | `/health` do worker sem auth, mas worker não roda | `worker/src/index.ts:147` |
| SEG-B1 | ❌ ABERTO | BAIXO | Senha mínima validada só no client | `app/(auth)/nova-senha/page.tsx:20-23` |
| SEG-B2 | ❌ ABERTO | BAIXO | `pg_cron` apaga notificações após 10 dias sem auditoria | `0002_correcoes.sql:108-111` |
| **SEG-N1** | ✅ **RESOLVIDO (2026-09-19)** | — | Webhook agora valida `X-Hub-Signature-256` da Meta com o `meta_app_secret` da conta (migration 0032) e o segredo compartilhado da uazapi; 10 testes de regressão em `tests/webhook-whatsapp-auth.test.ts` (7 falham contra a versão antiga, provado com git stash) | `app/api/webhooks/whatsapp/route.ts` |

## FRENTE 2 — Isolamento multi-tenant

| ID | Status | Gravidade | Achado | Arquivo:linha |
|---|---|---|---|---|
| ISO-A1 | ❌ ABERTO, escopo maior | ALTO | Dashboard/cobranças/caixa/log/clientes seguem sem `conta_id` explícito, só RLS | várias páginas |
| ISO-A2, A3, A4, A6, A7, A8 | ✅ RESOLVIDOS | — | Todas as mutations corrigidas: `conta_id` explícito, RPC atômica, soft-delete via Server Action | `cobrancas.ts`, `meios.ts`, `parcelas.ts`, `clientes.ts` |
| ISO-A5 | ❌ ABERTO | ALTO | `cobrarManualAction` não deriva `conta_id` da sessão, usa o da parcela | `parcelas.ts:21-51` |
| ISO-M1 | ❌ ABERTO | MÉDIO | Vínculo instância→conta por convenção de nome, não consulta real | `log/_actions/log.ts:273-283` |
| ISO-M2 | ✅ RESOLVIDO (2026-09-19) | — | Contagem de limite de clientes agora filtra `conta_id` | `clientes/_actions/clientes.ts:84-90` |
| ISO-M3 | ✅ RESOLVIDO | — | Erro de `local_part` duplicado agora é genérico | `configuracoes.ts:162-164` |
| ISO-B1 | 💤 dormente | BAIXO | Worker sem `conta_id`, mas morto | `worker/src/*` |
| **ISO-N3** | ✅ **RESOLVIDO (2026-09-19)** | — | `atualizarClienteAction` e as verificações de CPF/celular duplicado (também em `criarClienteAction`) agora filtram `conta_id` explicitamente | `clientes/_actions/clientes.ts` |
| ISO-N4 | 🆕 | MÉDIO | `renovarLookDefenseImediato` usa service role e 4 UPDATEs em `baixas_externas` sem `conta_id` | `lib/lookdefense/renovar-imediato.ts:71-111` |

## FRENTE 3 — Regras de negócio e financeiro

| ID | Status | Gravidade | Achado | Arquivo:linha |
|---|---|---|---|---|
| **RN-C1** | ✅ **DECIDIDO (2026-09-21)** | — | Decisão do Felippe: manter a geração na baixa + scheduler de segurança (opção 1 de `regras-financeiras` §2.2), mais uma correção adicional — a criação da cobrança recorrente também estava gerando um lote de 3 parcelas "de cobertura inicial" em vez de só a próxima, achado real num card de cliente (Thomaz Martins, #2/#3 abertas simultaneamente). Uma recorrente agora nunca tem mais de 1 parcela aberta: `gerarParcelasRecorrentes` (`lib/utils/parcelas.ts`) cria sempre 1; os 4 caminhos de geração-na-baixa e o scheduler não mudaram (já geravam 1 por vez, correto). Teste vermelho/verde em `tests/utils.test.ts`. Não retroativo — cobranças já existentes com mais de 1 parcela aberta não foram limpas | `lib/utils/parcelas.ts`, `tests/utils.test.ts` |
| RN-A1 | ✅ RESOLVIDO | — | Baixa agora é RPC transacional (`baixar_parcela`, migration 0013) — parcela+lançamento+cancelamento em uma transação | `0013_baixar_parcela_rpc.sql` |
| RN-A2 | 🔁 melhorou | BAIXO | Passos secundários (notificação, próxima parcela) ainda fora da transação mas agora logam erro | `parcelas.ts` |
| RN-M1, M2 | ✅ RESOLVIDOS | — | Boas-vindas respeita config de canal; janela/intervalo lidos de `configuracoes` no caminho ativo | `cobrancas.ts:119-137`; `cron/whatsapp-uazapi/route.ts:229-247` |
| RN-M3 | 🔁 **piorou** | MÉDIO | Cálculo de vencimento duplicado agora em **3 lugares** (`lib/utils/parcelas.ts`, `worker/src/scheduler.ts` morto, e uma terceira cópia própria em `app/api/cron/scheduler/route.ts`, que é o ativo) | `cron/scheduler/route.ts:42-50` |
| RN-M4 | ✅ resolvido (era falso positivo) | — | Índice único já cobre `pagamento_confirmado` | `0003_fix_idempotencia_manual.sql` |
| COD-A1 | ❌ ABERTO | ALTO | `numeric(12,2)` + `parseFloat` continuam, dívida consciente não migrada | `lib/utils/format.ts` |
| **RN-N1** | 🆕 (gap de documentação) | MÉDIO | Já existe limite de plano real em produção (`contas.limite_clientes`, default 100) — a skill dizia `[A DEFINIR]` como se nada existisse | `0001_schema_inicial.sql:64`; `clientes/_actions/clientes.ts:18-30` |

## FRENTE 4 — Qualidade de código e sincronização

| ID | Status | Gravidade | Achado |
|---|---|---|---|
| COD-A2 | 🔁 REDUZIDO (2026-09-19), não zerado | MÉDIO | `\bany\b` em `app/`+`lib/`: **152 → 112** (`as any`: 115 → 74). Saíram os que só existiam por tipo faltando (webhook/lib EfiBank, mensagens rápidas, configurações, templates Meta, envio imediato). Restam 112 — top: `atendimento/renovar.ts`, `atendimento/mensagens.ts`, `cron/whatsapp/route.ts` |
| COD-M1 | ✅ RESOLVIDO (2026-09-19) | — | Toda mudança de status de notificação passa por `atualizarStatusNotificacao` (checa `error`, loga com contexto, repete 3x depois de o envio já ter saído); erro no claim não vira laço quente | `lib/whatsapp/status-notificacao.ts` e os 3 caminhos de envio |
| **COD-N1** | ✅ **RESOLVIDO (2026-09-19)** — achado NOVO, não estava na auditoria | **CRÍTICO (funcional)** | **`enviarWhatsAppImediato` reivindicava a notificação (`processando`) e só depois descobria que a conta não usa Meta — em conta uazapi a confirmação de pagamento e o "Cobrar agora" ficavam presos em `processando` para sempre (o cron da uazapi só lê `fila`). Chamado por 5 fluxos (baixa manual x2, webhook EfiBank, renovar, cobrança manual)** | `lib/whatsapp/enviar-imediato.ts` |
| **COD-N2** | ✅ **RESOLVIDO (2026-09-19)** | ALTO | Depois de a Meta aceitar a mensagem, qualquer exceção (ex.: `encontrarOuCriarAtendimento`) caía no `catch` que devolvia a notificação para `fila` — o cron reenviava e o cliente recebia 2x. Mesmo padrão no cron Meta e no "Forçar envio" | `enviar-imediato.ts`, `cron/whatsapp/route.ts`, `log/_actions/log.ts` |
| **RN-N2** | ✅ **RESOLVIDO (2026-09-19)** | ALTO | Corrida com a baixa: a RPC `baixar_parcela` cancela só notificações em `fila`; uma já reivindicada (`processando`) esperando os 15–20s de digitação seguia e **cobrava quem acabou de pagar**. Agora há checagem final (`vereditoLembrete`) imediatamente antes do envio nos dois crons; erro de leitura não libera o envio | `lib/whatsapp/status-notificacao.ts` |
| **SEG-N3** | ✅ **RESOLVIDO (2026-09-19)** | ALTO | Crons `whatsapp` (Meta) e `scheduler` aceitavam `Authorization: Bearer undefined` sem `CRON_SECRET` configurado; o cron `lookdefense` ficava **sem autenticação nenhuma**. Agora `cronAutorizado()` recusa quando o segredo falta | `lib/cron-auth.ts` |
| **COD-N3** | ✅ **RESOLVIDO (2026-09-19)** | ALTO | "Forçar envio" do Log marcava a notificação como `cancelado` ao reivindicar e não restaurava em nenhuma falha: um lembrete da fila era perdido em silêncio (e um cancelado de propósito virava `fila`). Agora restaura o status original; também não devolve mais o texto cru da uazapi à tela (resolve SEG-M3 nesse caminho) | `log/_actions/log.ts` |
| COD-M3, M4, M6 | ✅ RESOLVIDOS | — | Erros verificados e logados com contexto |
| **OPS-N1** | ✅ **RESOLVIDO (2026-09-19)** | **CRÍTICO** | **Incidente real em produção, achado pelo Felippe:** o cron-job.org (gatilho externo do cron `whatsapp-uazapi`) tem timeout FIXO de 30s no plano usado; o ritmo anti-ban real leva 15-80s por mensagem. Toda execução com pelo menos 1 lembrete pendente estourava o timeout, o cron-job.org marcava falha e estava a um passo de desativar o job sozinho — lembretes automáticos pararam de sair e "Forçar envio" reportava "WhatsApp desconectado" (falso: a conexão estava ok, era a sincronização de status que dependia do mesmo cron travado). Corrigido devolvendo a resposta HTTP assim que as contas elegíveis são calculadas (rápido) e processando o envio de verdade em segundo plano via `after()` (`next/server`), que a Vercel mantém rodando até `maxDuration=300`. 2 testes novos provam o caminho de produção (resposta rápida + envio completa depois) sem quebrar a cobertura existente | `app/api/cron/whatsapp-uazapi/route.ts`, `tests/cron-whatsapp-uazapi.test.ts` |
| **OPS-N2** | ✅ **RESOLVIDO (2026-09-19)** | ALTO | Achado ao investigar o OPS-N1: `forcarEnvioAction` (Log → "Forçar") reimplementava sua própria checagem de instância uazapi em vez de usar `lib/uazapi.ts`, e tratava QUALQUER falha em `/instance/all` (rede, HTTP 429 de rate limit) como "instância não encontrada" — reportando "WhatsApp desconectado" ao usuário mesmo com a conexão ok, só por causa de um rate limit transitório da própria checagem. Também não normalizava o número antes de enviar (`sendText` de `lib/uazapi.ts` faz isso, o fetch cru não fazia). Primeira correção reutilizou `getAllInstances`/`sendText`/`UazapiRateLimitError` — mas isso não bastou (ver OPS-N3 abaixo); a correção final removeu por completo a dependência da API de administração da uazapi nesse caminho | `log/_actions/log.ts`, `tests/forcar-envio.test.ts` |
| **OPS-N3** | ✅ **RESOLVIDO (2026-09-19)** | **CRÍTICO** | `getAllInstances()` (API de ADMINISTRAÇÃO da uazapi, `/instance/all` — só lista/gerencia instâncias) foi identificada como suspeita: com `UAZAPI_ADMIN_TOKEN` aparentemente vazio via `vercel env pull`, "Forçar" continuava reportando "WhatsApp desconectado" mesmo com o WhatsApp genuinamente conectado. **Ressalva importante (corrigida depois):** a Vercel esconde (redige) o valor de variáveis marcadas "Sensitive" no `env pull` mesmo quando preenchidas — então não dá pra afirmar com certeza que o token estava mesmo vazio em produção, só que a checagem via API de administração estava falhando na prática. O ponto que segue válido independente da causa exata: quem autentica o ENVIO em si é o token da própria instância, já salvo em `conexoes.uazapi_instance_token` — a API de administração nunca deveria estar no caminho crítico de envio. **Correção:** `forcarEnvioAction` e `enviarRespostaAction` (resposta manual em /atendimento) passaram a ler `conexoes.status`/`uazapi_instance_token` direto do banco — a MESMA fonte que o cron usa para decidir quem está elegível — em vez de checar ao vivo contra a API de administração. Isso elimina a dependência do admin token do caminho crítico de envio inteiro, qualquer que fosse a causa original. Se `sincronizarConexoes` (o que mantém `conexoes.status`/banner da Dashboard atualizados sozinhos) parar de funcionar de novo, `UAZAPI_ADMIN_TOKEN` é o primeiro suspeito — conferir direto no painel da uazapi/supercloudstore, não confiar em `vercel env pull` pra isso | `log/_actions/log.ts`, `atendimento/_actions/mensagens.ts` |
| COD-M5 | ✅ RESOLVIDO | — | `order()` explícito na listagem principal |
| COD-B1 | ✅ RESOLVIDO (2026-09-19), e era pior que BAIXO | — | Falha na consulta da parcela virava **`R$ 0,00` enviado ao cliente** (valor errado), não só campo em branco. `resolverVariaveis` agora lança `VariaveisIndisponiveisError` (`erro_banco` → tenta no próximo tick; `nao_encontrado` → cancela); cron Meta e envio imediato também não enviam com valor/vencimento em branco | `lib/whatsapp/resolver-variaveis.ts` |
| COD-B2 | 🔁 parcial | BAIXO | Duplicação app-side eliminada; resta só cópia no worker morto |
| SIN-C1, C2, A1, A2, A3, M1 | ✅ RESOLVIDOS | — | Tipos de notificação atualizados, `.env.example` sincronizado, token gravado pela arquitetura direta, headers consistentes, policy de UPDATE criada |
| **SIN-M2** | ✅ **RESOLVIDO na prática (2026-09-19)** — mas ainda à mão | — | `types/database.ts` atualizado com o schema real até a migration 0032: tabelas `cobrancas_pix` e `mensagens_rapidas`, colunas `efi_*`, `meta_app_secret`, `meta_template_*`, `midia_url`. O `supabase as any` do webhook EfiBank saiu. **Continua mantido à mão** (o cabeçalho do arquivo agora diz isso e manda atualizar na mesma tarefa de toda migration). Para regenerar do banco real falta um `SUPABASE_ACCESS_TOKEN` — `npx supabase gen types typescript --project-id jbtqrxnpxisnboiqwyrb` | `types/database.ts` |
| **COD-N4** | ✅ **RESOLVIDO (2026-09-19)** | ALTO | `criarCobrancaPix` ignorava o erro ao gravar em `cobrancas_pix` e entregava o código PIX mesmo assim; quando o cliente pagasse, o webhook não acharia o `txid` e o pagamento ficaria sem baixa. Agora devolve erro e não entrega o código. Teste falha contra a versão antiga | `lib/efibank/pix.ts` |
| **SEG-N4** | ✅ **RESOLVIDO (2026-09-19)** | — | **Qualquer membro da equipe (inclusive `atendente`) lia e alterava as credenciais da conta**, e um atendente conseguia se promover a admin. A migration 0020 fez `conta_do_usuario()` incluir `membros_conta`, e as policies de `configuracoes`/`membros_conta`/`meios_pagamento` usavam só essa função — sem checar o `role`. Migration `0033_papeis_na_conta.sql` cria `pode_administrar_conta(conta_id)` (dono OU membro admin ativo) e restringe: `configuracoes` (select/insert/update) e `membros_conta` (insert/update/delete) a dono/admin; `meios_pagamento` (a chave PIX que vai pro cliente) libera select a todo membro mas insert/update/delete só a dono/admin. `membros_select` (listar a equipe) continua liberado a todos — o atendimento precisa disso. 21 testes em Postgres real (PGlite) provam o exploit fechado e que o atendente continua conseguindo trabalhar (`tests/db-papeis.test.ts`). App: `atendimento/_actions/mensagens.ts`, `api/meta/templates/route.ts`, `wa-templates/page.tsx` e `wa-templates/_actions/index.ts` agora leem `configuracoes` com service role depois de confirmar a conta via `getConta()`/RLS — sem isso o atendente ficaria sem enviar mensagem. `/configuracoes` some do menu para quem não é dono (já não funcionava para membros — bug preexistente não causado por isto, só ficou visível ao esconder o link) | `supabase/migrations/0033_papeis_na_conta.sql`, `tests/db-papeis.test.ts` |
| **PAG-N1** | ✅ **RESOLVIDO (2026-09-19)** | — | Webhook EfiBank agora dá a baixa ANTES de marcar `concluida`; falha transitória responde 5xx (a EfiBank reenvia); parcela já paga encerra a cobrança sem repetir efeitos; PIX pago sem parcela vira erro para revisão manual. 26 testes (7 falham contra a versão anterior) | `webhooks/efibank/route.ts`, `tests/webhook-efibank.test.ts` |
| **SEG-N2** | ✅ **RESOLVIDO (opt-in) (2026-09-19)** | MÉDIO | Webhook aceita segredo próprio `EFIBANK_WEBHOOK_SECRET` (comparação em tempo constante); quando configurado o `CRON_SECRET` deixa de valer nele. Sem a variável continua aceitando `CRON_SECRET` (legado) — **para fechar de vez: criar a variável na Vercel e trocar o `?token=` na URL cadastrada na EfiBank** | `webhooks/efibank/route.ts`, `.env.example` |
| **SEG-N5** | ❌ **ABERTO — validar escopo antes** | MÉDIO | O webhook EfiBank ainda confia no corpo da notificação (quem souber um `txid` e o token forja uma baixa). A regra de segurança pede confirmar via API (`GET /v2/cob/{txid}`), o que exige o escopo `cob.read` na aplicação EfiBank — sem ele todo pagamento ficaria em reenvio. Conferir o escopo no painel da EfiBank e só então ativar | `webhooks/efibank/route.ts` |
| **ISO-N5** | ❌ **ABERTO** | MÉDIO | `renovarParcelaAction(parcelaId, cobrancaId)` usa o `cobrancaId` **vindo do cliente** para gravar a notificação e gerar a próxima parcela (deveria usar `result.cobranca_id` da RPC), e não checa o erro do `insert` da próxima parcela | `atendimento/_actions/renovar.ts:187-316` |
| PERF-A1 | ✅ resolvido (majoritário) | — | N+1+N do scheduler resolvido com queries batched |
| PERF-M1, M2, B1 | ❌ ABERTOS, migraram | MÉDIO/BAIXO | Índice sem `canal`, inserts sequenciais, loop serial de contas — mesmos gargalos, agora dentro do cron de 1min |
| PERF-B2 | ✅ RESOLVIDO | — | Query redundante removida |

**Segredo commitado:** nenhum encontrado (`.gitignore` corretos, busca por padrões de chave não achou nada). **TODO/FIXME em produção:** zero.

## FRENTE 5 — Testes

| ID | Status | Gravidade | Achado |
|---|---|---|---|
| TST-C1 | ❌ ABERTO | ALTO | 64 testes hoje (era 0 relevante), mas só cobrem funções puras + RLS de 2 tabelas — zero teste de action/cron/webhook |
| TST-C2 | ✅ RESOLVIDO | — | `calcularVencimento` com 7 casos, incluindo dia 31→fev bissexto/não-bissexto |
| **TST-C3** | ❌ **ABERTO** | **ALTO** | RPC `baixar_parcela` existe mas **nenhum teste** força falha no meio ou confirma atomicidade |
| TST-C4 | ✅ RESOLVIDO | — | Relógio controlado com `vi.useFakeTimers()` |
| **TST-C5** | ✅ **RESOLVIDO (2026-09-19)** | — | 124 testes novos cobrem os crons `whatsapp-uazapi` e `whatsapp` (claim atômico com 2 execuções sobrepostas, janela 09–20h nas fronteiras 08:59/09:00/19:59/20:00/20:01, rate limit, corrida com pagamento, falhas de status, autenticação), o envio imediato, o "Forçar envio" e o resolvedor de variáveis. Contra a versão anterior do código **43 desses testes falham**. Ainda sem teste: `scheduler` (geração de parcelas/lembretes) — só a autenticação está coberta | `tests/*.test.ts`, `tests/helpers/fake-supabase.ts` |
| TST-A1 | ❌ ABERTO | ALTO | Só `clientes` e `contas` têm teste de isolamento — **faltam 20 tabelas** (parcelas, notificacoes_enviadas, lancamentos, conexoes, cobrancas_pix...) |
| TST-A2 | ❌ ABERTO | ALTO | Playwright não instalado, zero E2E |

`vitest run`: **64/64 passando.**

## FRENTE 6 — Design ("cara de IA")

| ID | Status | Gravidade | Achado |
|---|---|---|---|
| DES-A1 | ❌ ABERTO | ALTO | Cores hardcoded em `conexao/page.tsx` sobreviveram à reescrita pra uazapi |
| **DES-A2** | ❌ **ABERTO, piorou** | ALTO | **Zero `loading.tsx`/`error.tsx` em todas as 22 rotas** (era 7 en julho) |
| DES-M1 | ❌ ABERTO, piorou | MÉDIO | `shadow-2xl` agora em 11 pontos (era 3) |
| DES-M2 a M6 | ❌ ABERTOS | MÉDIO/BAIXO | Dropdown com shadow-xl, badge sempre verde, status cru, confirmação sem descrever impacto, poucos `aria-label` (25 no app todo) |
| DES-B1, B2 | ✅ RESOLVIDOS | — | Badge `rounded-full` (regra da skill mudou pra refletir isso), zero `select('*')` |
| **DES-N1** | 🆕 | ALTO | **`mensagens-rapidas/page.tsx` inteira em tema claro** dentro do produto dark, sem nenhuma variante — provavelmente ilegível |
| **DES-N2** | 🆕 | ALTO | `app/privacidade/page.tsx` confirmado 100% `style={}` inline, tema claro — única página institucional fora do padrão |
| DES-N3 | 🆕 | MÉDIO | Cores Tailwind cruas em mais 6 arquivos (`wa-templates`, `configuracoes`, `atendimento`, `disparos`) |
| DES-N4 | 🆕 | BAIXO | Roxo/violeta usado como cor de categoria, proibido |
| **DES-N5** | 🆕 | **ALTO** | **Mensagens reais de WhatsApp** (`app/api/cron/whatsapp/route.ts`) usam emoji repetido em excesso (`🎉...🎉`, `🤩...🤩`, `🥳...🥳`) — comunicação de marca real ao cliente final, não só UI interna. Nota: os templates padrão em `lib/notificacao/tipos.ts` (editáveis pelo operador) estão bem melhores, só com 1 emoji a mais do recomendado — são dois codepaths diferentes com disciplina diferente |
| DES-N9 | 🆕 (estratégico) | **ALTO** | **Não existe `app/page.tsx` na raiz** — middleware redireciona todo visitante deslogado direto pra `/login`. Não há hero, prova social, preços, nem footer institucional porque a página não existe |
| DES-N8 | 🆕 | — | Confirma: Termos de Uso não existe em nenhum lugar |

---

## O que mais falta pra "SaaS profissional pronto pra vender" (síntese das 3 frentes comerciais)

Isso é mais estrutural do que qualquer bug encontrado:

1. **Não existe landing page, preço público nem cadastro self-service.** Hoje o Cobranx só ganha cliente novo se o Felippe cadastrar manualmente pelo `/admin`. Não dá pra "vender" um produto que ninguém consegue assinar sozinho.
2. **Cancelamento/reativação de assinatura também é 100% manual** — a tela de plano expirado literalmente manda "entrar em contato com o suporte".
3. **Termos de Uso não existe.** Política de Privacidade existe mas está com tema claro quebrado e cita só "WhatsApp Business API (Meta)", desatualizada frente à arquitetura real (uazapi).
4. **Nenhum CNPJ/razão social visível em lugar nenhum do produto.**
5. Favicon é o padrão do Next.js; não há `error.tsx`/`global-error.tsx` de marca; sem `sitemap.xml`/`robots.txt`/Open Graph.
6. Copy da UI é tecnicamente correta em português (nenhum erro de concordância/crase achado), mas genérica em pontos (empty state de clientes sem CTA, e-mail de boas-vindas "Bem-vindo! Cadastro realizado"). As mensagens de cobrança ao cliente final, essas sim, estão com tom bom — é o ponto mais maduro do produto hoje.

---

## Plano de ondas (revisado)

### ONDA 0 — Segurança ativa agora (fazer antes de qualquer coisa)
1. ~~**SEG-N1**~~ ✅ feito em 2026-09-19
2. ~~**SEG-A6**~~ ✅ feito em 2026-09-19
3. ~~**ISO-N3**~~ ✅ feito em 2026-09-19 (+ ISO-M2 de brinde)
4. ~~**SEG-N4**~~ ✅ feito em 2026-09-19 (migration 0033 + service role nos fluxos do atendente)
5. ~~**RN-C1**~~ ✅ decidido em 2026-09-21 (ver skill `regras-financeiras` §2.2) — recorrente nunca tem mais de 1 parcela aberta; criação da cobrança corrigida para gerar só 1

**Passos manuais pendentes para a Onda 0 funcionar em produção** — a correção de código sozinha faz o webhook de mensagens recusar tudo até isso ser feito:
- Aplicar a migration `supabase/migrations/0032_meta_app_secret.sql` no Supabase (adiciona `configuracoes.meta_app_secret`)
- Garantir `UAZAPI_WEBHOOK_SECRET` configurado na Vercel (já documentado no `.env.example`)
- Cada conta que usa Meta Cloud API precisa colar o **App Secret** (Meta Developers → Configurações básicas) em Configurações → WhatsApp Business API — sem isso, o webhook dela passa a devolver 401
- Contas já conectadas na uazapi têm o webhook registrado SEM `&secret=` na URL — precisam reiniciar a conexão uma vez (ou ter o webhook re-registrado) para voltar a receber mensagens no atendimento. Lembretes e cobranças enviados não são afetados (saem pelo cron, não por este webhook)

### ONDA 1 — Risco de dinheiro e mensagem duplicada
1. ~~**TST-C5**~~ ✅ feito em 2026-09-19 (cron, envio imediato, "Forçar envio", resolvedor). **TST-C3** (atomicidade da RPC `baixar_parcela`) resolvido em parte: `@electric-sql/pglite` roda as migrations reais num Postgres em memória (`tests/helpers/pg-supabase.ts`), sem tocar o projeto compartilhado — usado para os 21 testes de papéis (SEG-N4) e para os 9 de isolamento entre contas. Falta ainda o teste específico da RPC `baixar_parcela` (idempotência/atomicidade)
   - **Achado no caminho:** `tests/rls-isolation.test.ts` (já existia, Sprint 1) rodava contra o projeto Supabase **real** (`SUPABASE_URL`/`SERVICE_KEY` do `.env.local`), criando e apagando usuários/contas de verdade a cada `npx vitest run` — exatamente o que a skill `testes-cobranx` proíbe, e um risco de deixar lixo em produção se o processo for interrompido entre o `beforeAll` e o `afterAll`. Reescrito para PGlite, mesma prova, sem tocar o projeto real
2. ~~**SIN-M2**~~ ✅ tipos atualizados à mão até a migration 0033 e `supabase as any` removido do webhook EfiBank (regenerar com `supabase gen types` continua desejável, precisa de token)
3. ~~**COD-M1**~~ ✅ feito em 2026-09-19 (+ COD-N1/N2/N3, RN-N2, SEG-N3, COD-B1 descobertos no caminho)
4. **SEG-A5** — criptografar em repouso: token uazapi, `meta_app_secret`, secret/certificado EfiBank, senha LookDefense (precisa de decisão de chave — ver skill `seguranca-cobranx`)

**Limpeza de dados em produção (fazer você, com revisão — eu não tenho acesso ao banco):** o bug COD-N1 deixou linhas presas em `processando` desde a última limpeza (migration 0030). Só os tipos `pagamento_confirmado` e `manual` passam pelo envio imediato, então dá para identificá-las com segurança pela `created_at` (criadas e reivindicadas no mesmo instante):
```sql
-- 1. revisar
select id, conta_id, tipo, created_at from notificacoes_enviadas
 where status = 'processando' and tipo in ('pagamento_confirmado','manual')
   and created_at < now() - interval '10 minutes' order by created_at;
-- 2. marcar como falhou (fica visível no Log; o usuário reenvia se ainda fizer sentido — não recolocar em 'fila',
--    senão clientes recebem "pagamento confirmado" com dias de atraso)
update notificacoes_enviadas set status = 'falhou'
 where status = 'processando' and tipo in ('pagamento_confirmado','manual')
   and created_at < now() - interval '10 minutes';
```
Lembretes (`5d`…`vencido1d`) em `processando` **não** dá para julgar pela `created_at` (são criados dias antes de serem reivindicados) — não há coluna de "reivindicado em". Um "reaper" automático de `processando` antigo exige essa coluna (migration em tabela core) e a decisão do risco de reenvio; ficou como pendência de decisão.

### ONDA 2 — A porta de entrada (maior alavanca comercial)
1. Landing page (`app/page.tsx`) seguindo `design-system` §6 + `copywriting-conversao`
2. Página de preços com os limites reais de plano (hoje só existe `limite_clientes = 100` hardcoded — decisão de produto: virar tabela de planos de verdade primeiro)
3. Cadastro self-service (hoje é só admin-provisionado)
4. Termos de Uso (não existe) + reestilizar Política de Privacidade pro tema dark + atualizar conteúdo (uazapi, EfiBank, Mercado Pago)
5. Cancelamento de assinatura self-service
6. Favicon, `error.tsx`/`global-error.tsx` de marca, meta tags/OG, `sitemap.xml`

### ONDA 3 — Cara de IA e polimento visual
1. `loading.tsx`/`error.tsx` em todas as 22 rotas (hoje zero)
2. `mensagens-rapidas/page.tsx` — reescrever pro tema dark (está inteira fora do padrão)
3. Cores hardcoded (`conexao`, `wa-templates`, `configuracoes`, `atendimento`, `disparos`) → tokens
4. Emoji em excesso nas mensagens reais de `app/api/cron/whatsapp/route.ts` (unificar com o padrão mais comedido de `lib/notificacao/tipos.ts`)
5. `shadow-2xl`/`shadow-xl` → `shadow-sm`; roxo/violeta → remover; `aria-label` em botões-ícone

### ONDA 4 — Dívida técnica de fundo
1. Rate limiting (SEG-A2), Zod em todas as actions (SEG-A3), auditoria de ações do tenant (SEG-A4)
2. Reduzir os 152 `any`/`as any` (COD-A2), unificar o cálculo de vencimento nas 3 cópias (RN-M3)
3. Testes de isolamento nas 20 tabelas restantes (TST-A1), instalar Playwright e cobrir os 5 fluxos vitais (TST-A2)
4. Migrar dinheiro para centavos inteiros (COD-A1) — mudança de schema, alinhar antes

---

*Este documento substitui `auditoria-skills.md` (2026-07-02) como referência corrente. O arquivo antigo fica preservado como histórico.*
