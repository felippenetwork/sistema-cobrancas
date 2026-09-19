---
name: seguranca-cobranx
description: Programa de segurança completo do Cobranx (SaaS multi-tenant de cobrança via WhatsApp/e-mail/PIX), nível produto financeiro maduro — cobre aplicação, banco, hospedagem (Vercel) e integrações (uazapi, Meta, Mercado Pago, EfiBank, LookDefense). Use SEMPRE que criar ou alterar tabelas, RLS, login, cadastro, recuperação de senha, sessões, API routes, server actions, webhooks, pagamentos, filas, exportações, variáveis de ambiente, ou qualquer código que leia/grave dados. Use também ao revisar código, criar testes, configurar deploy ou responder a incidentes. Nenhuma vulnerabilidade é aceitável em nenhuma camada.
---

# Segurança — Cobranx

Programa de segurança de produto financeiro. As ameaças, em ordem de gravidade:

1. **Vazamento entre contas** (cliente A vê dados do cliente B)
2. **Sequestro de instância WhatsApp** (token uazapi = controle do número do cliente)
3. **Invasão de conta de usuário** (brute force, sessão roubada, recuperação de senha frágil)
4. **Fraude de pagamento** (webhook forjado do Mercado Pago ou da EfiBank liberando acesso/baixa indevida)
5. **Vazamento de dados pessoais** (LGPD: multa + reputação)
6. **Indisponibilidade** (DoS/DDoS, dependência externa lenta travando o sistema)

**Postura inegociável:** toda entrada é hostil até validada; todo acesso é negado até autorizado; todo segredo vaza um dia se o processo permitir. Na dúvida sobre uma decisão que troque segurança por conveniência, perguntar ao Felippe — nunca assumir a opção mais frouxa.

## Mapa de leitura (referências desta skill)

| Contexto da tarefa | Ler |
|---|---|
| Login, cadastro, recuperação de senha, 2FA, sessões, e-mail de alerta | `references/autenticacao-e-sessoes.md` |
| Logs de auditoria, alertas de segurança, suspeita/resposta a invasão | `references/auditoria-e-incidentes.md` |
| Testes de segurança, revisão pré-deploy, CI, rotinas periódicas | `references/testes-de-seguranca.md` |
| Referência histórica de hardening de VPS | `references/hardening-vortexus.md` — **legado.** O worker na Vortexus está morto (ver skill `whatsapp-uazapi`); nada roda mais lá. Só relevante se o Felippe confirmar que a VPS ainda hospeda algo. Não tratar como trabalho ativo sem essa confirmação. |

As seções abaixo são as regras permanentes, aplicadas em TODO código.

## 1. Multi-tenancy e RLS (regra número 1)

Toda tabela de negócio TEM `conta_id` e RLS habilitado, com `FORCE ROW LEVEL SECURITY` (impede que o owner da tabela escape da policy). Sem exceção, e nasce **na mesma migration** que cria a tabela — nunca "depois eu coloco".

```sql
alter table nova_tabela enable row level security;
alter table nova_tabela force row level security;
```

Criar as **4 policies explícitas** (SELECT, INSERT, UPDATE, DELETE) filtrando por `conta_id` via a função helper `conta_do_usuario()`. Bug histórico do projeto: `notificacoes_enviadas` sem policy de UPDATE — cancelamento falhava em silêncio. Após criar/alterar, confirmar:

```sql
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'nova_tabela';
```

Views e funções `SECURITY DEFINER` **não herdam RLS automaticamente** — filtro explícito de `conta_id` em cada uma (o furo nº 1 de sistemas "com RLS completo"). Toda tabela nova ganha teste de isolamento de tenant (ver `references/testes-de-seguranca.md` e skill `isolamento-de-contas`).

**Padrão sistêmico já encontrado em auditoria (ISO-A2 a A8):** `getConta()` retorna `{ supabase, contaId }`, mas várias mutations desestruturam só `{ supabase }` e filtram UPDATE/DELETE apenas pelo `id` do recurso vindo do body — sem confirmar posse por `conta_id`. O RLS ainda protege hoje, mas é defesa única. Toda mutation nova (e toda existente que for tocada) inclui `.eq('conta_id', contaId)` como segunda condição, sempre — nunca confiar só no RLS como camada única quando o código já tem o dado da sessão em mãos.

## 2. Service role — restrito e escopado

`SUPABASE_SERVICE_ROLE_KEY` ignora RLS:

- NUNCA em componente client ou código de browser.
- Apenas em API routes, server actions e webhooks (não há mais Edge Functions/worker separado — ver skill `whatsapp-uazapi`).
- Toda query com service role tem `.eq('conta_id', contaId)` com `contaId` da **sessão verificada** — nunca do body.

## 3. Autenticação (regras duras; fluxos completos na referência)

- Rate limit no login: 5 tentativas por IP+email / 15 min → bloqueio temporário; resposta sempre genérica.
- Resposta idêntica para "email não existe" e "senha errada" em login, cadastro e recuperação (anti-enumeração). Recurso alheio responde **404, nunca 403** (403 confirma existência).
- **Verificação de e-mail obrigatória** antes de liberar disparo de mensagens (impede uso da plataforma para spam com cadastro fake).
- Senha: mínimo 8 caracteres, rejeitar senhas comuns; nunca logada; hash forte (bcrypt/argon2, o que o Supabase Auth já usa — nunca inventar cripto própria).
- Troca/reset de senha revoga as demais sessões.
- Cookies: `httpOnly`, `secure`, `sameSite=lax` (padrão Supabase — não afrouxar).
- 2FA (TOTP) disponível; obrigatório para exportação em massa e exclusão de conta.
- Login de IP/dispositivo novo → e-mail de alerta ao usuário ("Foi você?").

## 4. Autorização, IDOR e mass assignment

- **Papel dentro da conta (`admin` × `atendente`) é imposto no BANCO, não só na interface.** Achado SEG-N4 (auditoria 2026-09-19, resolvido): `conta_do_usuario()` (migration 0020) inclui `membros_conta`, e as policies de `configuracoes`/`membros_conta`/`meios_pagamento` usavam só essa função — um atendente lia pelo client anon as credenciais da conta (Meta, EfiBank incl. certificado, LookDefense) e a chave PIX, podia trocá-las e se promover a admin. Corrigido na migration `0033_papeis_na_conta.sql` com o helper `pode_administrar_conta(conta_id)` (dono OU membro admin ativo) — regra e exemplo completos na skill `isolamento-de-contas` (seção "Papéis dentro da conta"). Ação que o atendente precisa (ex.: responder cliente, que usa o token Meta) roda no servidor com service role depois de verificar a associação via `getConta()` — nunca afrouxando a policy para o atendente ler o segredo direto.
- ID vindo do client nunca é confiável: confirmar que o recurso pertence à `conta_id` da sessão antes de agir. Ações destrutivas (excluir cliente, desconectar WhatsApp, cancelar assinatura, exportar base) exigem papel de dono.
- **Mass assignment:** PROIBIDO gravar o body/objeto inteiro do request direto no banco — whitelist explícita dos campos graváveis por action/rota. Campo sensível (`role`, `conta_id`, `status` de pagamento, `plano`) NUNCA aceito do client, mesmo que o schema Zod "passe" — é derivado no servidor.
- **Concorrência em operação crítica** (baixa de parcela, ativação de plano): atômica e idempotente via RPC/transação com lock — "ler, decidir, gravar" sem lock é corrida clássica (duplo clique, retry, dois eventos de webhook) que duplica lançamento ou dá baixa duas vezes.

## 5. Input, injeções e SSRF

- Validar TODO input externo com zod: body, server actions, webhooks, mensagens da fila.
- **SQL:** só query builder/parametrizado. PROIBIDO interpolar input em SQL ou `.rpc()` com string montada.
- **XSS:** proibido `dangerouslySetInnerHTML` com conteúdo que passou por input de usuário; se HTML for inevitável, sanitizar com DOMPurify.
- **CSRF:** Server Actions têm proteção nativa do Next — preferi-las. API route REST que **muda estado** valida o header `Origin` contra o domínio da app; webhooks são a exceção, protegidos por assinatura.
- **SSRF:** qualquer funcionalidade que busca uma URL fornecida pelo usuário valida contra IPs internos/loopback/metadata da nuvem antes de requisitar.
- **CORS e redirecionamento:** `Access-Control-Allow-Origin` nunca `*` em endpoint autenticado/com cookie. Todo destino de redirect vindo de parâmetro (login `?next=`, callback) valida contra whitelist de paths internos — nunca redirecionar para URL arbitrária (vira phishing usando o domínio confiável do próprio sistema).
- Templates de mensagem: interpolar somente variáveis da whitelist (`#VALOR#`, `#NOME#`...); nunca avaliar template como código.
- Telefone → E.164 (+55...). Dinheiro → centavos inteiros positivos.

## 6. Segredos, chaves e ambientes

Já houve incidente de credencial exposta em projeto anterior. Regras permanentes:

- `.env*` no `.gitignore`; gitleaks no pre-commit/CI (ver referência de testes).
- Nenhuma chave hardcoded — nem em scripts, testes ou seeds.
- `NEXT_PUBLIC_` só para valores realmente públicos.
- **Toda variável de ambiente nova é documentada em `.env.example` na mesma tarefa que a introduz.** Achado real deste projeto: `UAZAPI_URL`/`UAZAPI_ADMIN_TOKEN` (SIN-C2) e as credenciais de Twilio/LookDefense/EfiBank ficaram de fora do `.env.example` por meses — regra violada, não repetir.
- Vazou → rotacionar IMEDIATAMENTE (Supabase, Mercado Pago, EfiBank, uazapi) e atualizar na Vercel.
- **Credenciais de integração por conta hoje ficam em texto claro no banco (SEG-A5, aberto):** `conexoes.uazapi_instance_token`, e em `configuracoes`: `meta_access_token`, `meta_app_secret` (novo, migration 0032), `efi_client_secret`, `efi_cert_base64`, `ld_password`. Ao tocar qualquer uma dessas colunas, avaliar criptografia em repouso (ex.: `pgsodium`/Vault do Supabase ou cifra na aplicação com chave fora do banco) em vez de acrescentar mais um segredo em claro.
- **Rotação programada:** a cada 6 meses ou quando alguém com acesso sair, rotacionar service role e tokens de integração.
- **Ambientes separados:** projeto Supabase de dev ≠ produção; chaves distintas; NUNCA dados reais (telefones/dívidas de verdade) em dev ou teste. Segredo de produção nunca marcado para Preview na Vercel quando previews são publicamente acessíveis.

## 7. Pagamentos (Mercado Pago + EfiBank PIX)

- O Cobranx NUNCA armazena, trafega ou loga dados de cartão. Checkout/tokenização do Mercado Pago (assinatura do SaaS) são 100% do provedor; guardar apenas IDs de referência.
- **EfiBank (PIX do cliente final, ver skill `regras-financeiras` §3.2):** certificado `.p12` e credenciais ficam em `efi_cert_base64`/`efi_client_secret` no banco — mesma régua de segredo em repouso de qualquer credencial sensível (avaliar criptografia em repouso dessas colunas, não só do token uazapi).
- Nenhum formulário próprio de cartão.
- Valor e status de pagamento exibidos vêm de consulta à API ou de webhook validado — nunca calculados no client.

## 8. Webhooks (Mercado Pago, EfiBank, uazapi)

- Validar assinatura/segredo compartilhado antes de processar; inválido → 401 sem side effects. **Segredo não configurado no servidor também é recusa** (fail closed) — nunca `if (secret) { validar }` que aceita tudo quando a env some.
- Estado atual (auditoria 2026-09-19): Mercado Pago (HMAC obrigatório), webhook de conexão uazapi (`UAZAPI_WEBHOOK_SECRET` obrigatório) e webhook de mensagens `/api/webhooks/whatsapp` (Meta: `X-Hub-Signature-256` validado com o `configuracoes.meta_app_secret` da conta — cada conta tem seu próprio app Meta; uazapi: `UAZAPI_WEBHOOK_SECRET` via `?secret=`) estão todos corretos. Testes de regressão: `tests/webhook-whatsapp-auth.test.ts`. **Webhook novo nasce assim desde o primeiro commit, nunca "depois eu valido".**
- `[ainda aberto]` Webhook EfiBank autentica com o mesmo `CRON_SECRET` dos crons internos (SEG-N2) — vazar um compromete o outro; separar em segredo próprio.
- **Rotas `/api/cron/*` autenticam com `cronAutorizado(req)` (`lib/cron-auth.ts`), sempre.** Sem `CRON_SECRET` no servidor a resposta é 401 — `=== \`Bearer ${process.env.CRON_SECRET}\`` aceita "Bearer undefined" e `if (secret && ...)` deixa a rota aberta (foi assim que o cron `lookdefense` ficou sem autenticação). Cron novo usa o helper e ganha os 4 testes de `tests/cron-meta-e-autenticacao.test.ts`.
- Idempotência por ID de evento — EfiBank já implementa isso corretamente (marca `concluida` antes de processar, ver `regras-financeiras`).
- Ação crítica (liberar acesso, marcar pago) → confirmar via API do provedor, não confiar só no payload.

## 9. Instância WhatsApp (uazapi) — o ativo mais crítico

> Arquitetura real: ver skill `whatsapp-uazapi`. Não existe mais worker/Baileys — é uazapi direto via cron do Vercel.

- Token da instância (`uazapi_instance_token`) por conta, nunca exposto ao navegador. **Achado aberto (SEG-A5): esse token está gravado em texto claro na tabela `conexoes`** — criptografar em repouso é o correto ao tocar essa coluna, não uma melhoria opcional.
- Cliente desconectou/churn → desconectar a instância na uazapi.
- Webhook de conexão (`app/api/webhook/uazapi`) e de mensagens (`app/api/webhooks/whatsapp`) exigem o segredo compartilhado (`UAZAPI_WEBHOOK_SECRET`, injetado como `&secret=` na URL registrada pela action de conexão) — sem isso, qualquer um forjaria desconexão, QR falso ou mensagem de cliente. Conta já conectada antes dessa exigência precisa reiniciar a conexão uma vez para re-registrar o webhook com o segredo.

## 10. Endurecimento do app e da hospedagem (Vercel)

Headers no `next.config` (todos — **achado aberto: `next.config.ts` está vazio hoje, SEG-A1**):

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Content-Security-Policy` — começar restritiva (`default-src 'self'` + os domínios do Supabase/Mercado Pago/uazapi realmente usados).
- `X-Frame-Options: DENY` · `X-Content-Type-Options: nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` · `Permissions-Policy: camera=(), microphone=(), geolocation=()`

Além disso:

- **Rate limiting em todo endpoint público** (login, cadastro, recuperação, webhook, `/api/descadastrar`) — hoje ausente (SEG-A2); `/api/descadastrar/[clienteId]` está sem autenticação nenhuma e permite opt-out em massa por qualquer UUID (SEG-C2), corrigir com prioridade.
- Erros para o usuário genéricos; stack/SQL/estrutura interna só em log de servidor (achado aberto: mensagem de erro do Supabase retornada crua ao cliente em `configuracoes.ts` — SEG-M4).
- Uploads: validar tipo pelo conteúdo real (magic bytes), tamanho no servidor.
- Preview deployments da Vercel são públicos por padrão — ativar proteção por senha/SSO se algum dia usarem dado real fora de produção.
- Source maps de produção não publicados publicamente.

## 11. Disponibilidade e resiliência

- Operação cara (relatório, exportação, geração de PDF) nunca síncrona numa rota web pública — vai para fila/cron assíncrono.
- Dependência externa lenta ou fora do ar (uazapi, Resend, EfiBank, Mercado Pago) não pode travar o sistema inteiro: timeout curto + fallback/erro claro em vez de empilhar timeout — já é regra da skill `whatsapp-uazapi` para o cron de WhatsApp (orçamento interno de 270s).
- Timeout e limite de payload em toda rota.

## 12. Supply chain e CI/CD

- `npm audit` ao adicionar dependência; high/critical em pacote direto → resolver antes de seguir.
- Lockfile commitado; produção instala com `npm ci`.
- Dependabot/Renovate ativo no repositório para alertas de vulnerabilidade.
- Pacote novo só entra se: mantido, popular e realmente necessário.
- Action de terceiro em workflow de CI fixada por hash de commit, nunca por tag mutável; workflow disparado por PR de fork externo nunca roda com acesso a segredo de produção sem aprovação manual.

## 13. Auditoria (resumo; detalhes na referência)

Tabela `logs_auditoria`/`audit_log` append-only (sem UPDATE/DELETE para usuários): `conta_id`, `usuario_id`, `acao`, `recurso_tipo`, `recurso_id`, `ip`, `user_agent`, `detalhes jsonb`, `criado_em`.

Registrar sempre: login (sucesso/falha), troca/reset de senha, 2FA on/off, criação/edição/exclusão de cliente, cancelamento de cobrança, alteração de template, conexão/desconexão de WhatsApp, mudança de plano, **exportações**. **Achado aberto (SEG-A4):** ações do próprio tenant (cancelar cobrança, dar baixa, excluir cliente) ainda não são auditadas — hoje só ações de admin são. Sem auditoria não existe resposta a incidente.

## 14. Monitoramento e detecção ativa (em tempo real, não depois)

Auditoria é forense; isto é o que pega o ataque acontecendo:

- Alerta automático (não só log passivo) para: pico de falhas de login, pico de 401/403/404 do mesmo IP/conta, spike de 5xx, exportação em massa fora do padrão.
- Alerta vai para canal ativo (e-mail, Slack) — dashboard que ninguém olha não é detecção.

## 15. LGPD, retenção e soft delete

- Coletar o mínimo; nada de campo "por precaução".
- **Soft delete para dados financeiros:** cobranças e notificações são canceladas/arquivadas (status), nunca apagadas fisicamente por ação comum de UI.
- Exclusão física existe apenas como processo LGPD explícito, com anonimização do histórico contábil e registro na auditoria.
- Logs sem dados pessoais em claro além do necessário; mascarar (`+55***9876`).
- Exportação em massa: exige 2FA, é auditada e limitada em frequência.

## 16. Operação WhatsApp (anti-ban)

Ver skill `whatsapp-uazapi` para a regra completa (ritmo, janela, simulação de digitação). Resumo: todo disparo passa pelo cron com janela de envio e intervalos aleatórios; nenhum caminho de envio direto, nem para teste; opt-out do devedor é permanente.

## 17. Backup e recuperação de desastre

- Supabase: backups automáticos confirmados no plano; Point-in-Time Recovery habilitado em produção; **restore testado** ao menos uma vez (backup não testado não é backup).
- Plano de recuperação documentado em poucas linhas: "se o Supabase tiver um incidente, os passos são…".

## O que esta skill NÃO garante sozinha

Nenhum documento elimina risco de segurança permanentemente. Zero-day na própria plataforma (Supabase, Vercel, uazapi) está fora do controle do projeto. Teste independente (pentest, scanner tipo OWASP ZAP) é recomendado antes de mudança grande. Ao terminar qualquer tarefa desta skill, comunicar o que foi coberto e o que ficou como pendência — nunca declarar "sem nenhuma vulnerabilidade" como garantia absoluta.

## Checklist antes de finalizar qualquer tarefa que toque dados

- [ ] RLS + FORCE ROW LEVEL SECURITY + 4 policies por `conta_id` em tabela nova/alterada + teste de isolamento?
- [ ] Mutation nova filtra por `conta_id` explicitamente, não só confia no RLS (padrão ISO-A2/A8 corrigido, não repetido)?
- [ ] Service role sempre escopado pela sessão?
- [ ] Sessão verificada no início de rota/action nova?
- [ ] Inputs (incluindo fila e webhook) validados com zod? Sem mass assignment (whitelist de campos graváveis)? SSRF considerado se houver fetch de URL externa?
- [ ] Sem SQL interpolado, sem `dangerouslySetInnerHTML` cru, CSRF coberto, CORS/redirect restritivo?
- [ ] Nenhum segredo hardcoded/logado; env nova documentada em `.env.example`?
- [ ] Ação sensível gravada em auditoria?
- [ ] Endpoint público com rate limit?
- [ ] Nada de dado de cartão tocando o sistema?
- [ ] Exclusão é soft delete (salvo processo LGPD)?
- [ ] Token uazapi fora de git/logs/rotas?
- [ ] Disparo só pelo cron com intervalos (skill `whatsapp-uazapi`)?
