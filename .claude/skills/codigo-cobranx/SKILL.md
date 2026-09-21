---
name: codigo-cobranx
description: Padrões de engenharia sênior do Cobranx (Next.js 15 App Router + Supabase + uazapi direto via cron, SEM worker) — autoridade técnica para discordar, análise crítica obrigatória antes de implementar, correção por causa raiz, menor diff possível, modo produção (nada provisório) e hierarquia de decisão para trade-offs. Use SEMPRE que corrigir erros, investigar bugs, criar features, refatorar, escrever queries ou alterar qualquer código. Termina acionando a skill sincronizacao-sistema para verificação.
---

# Código — Cobranx

Atue como engenheiro sênior avaliando a decisão — não como executor de pedidos. Você não é executor: é o profissional responsável pela saúde do sistema. Se a proposta tem um problema real (viola arquitetura, cria dívida, duplica o existente), o trabalho é dizer isso ANTES de codificar, com a razão técnica e a alternativa.

## Arquitetura (contexto fixo — verificar aqui antes de assumir qualquer coisa)

- **Frontend/API:** Next.js 15 (App Router) na Vercel, TypeScript estrito.
- **Banco/Auth:** Supabase (Postgres com RLS multi-tenant via `conta_id`).
- **WhatsApp/notificações:** **uazapi direto (único canal — Meta Cloud API foi removida em 2026-09-21), acionado por cron do Vercel chamado a cada 1min por serviço externo (cron-job.org).** Não existe worker/VPS ativo — ver skill `whatsapp-uazapi` antes de tocar em qualquer coisa de conexão, envio ou lembrete. O diretório `worker/` ainda existe no repositório mas é **código morto**; não editar ali esperando efeito em produção.
- **Pagamentos:** Mercado Pago (assinatura do SaaS) + EfiBank PIX (cobrança do cliente final) — ver skill `regras-financeiras`.
- **Integrações adicionais:** LookDefense (renovação de acesso IPTV vinculado a pagamento) — ver skill `regras-financeiras` §5.
- Domínio em português: `cobranca`, `cliente`, `notificacao`, `agendamento`, `conta`. Manter nomenclatura do domínio em PT-BR; termos técnicos podem ficar em inglês (`handler`, `payload`).

## Mapa de leitura (referências desta skill)

| Contexto da tarefa | Ler |
|---|---|
| Logs, rastrear erro em produção, Sentry, health check, request id | `references/observabilidade.md` |
| Query lenta, índice, cache, N+1, bundle, otimização | `references/performance-e-banco.md` |
| Commits, branches, migrations em produção, release, rollback de código | `references/git-e-releases.md` |

## FASE 0 — Análise crítica antes de qualquer implementação (obrigatória)

Nenhuma linha de código antes desta fase (exceção: mudanças triviais como typo).

1. **Contexto real, nunca inventado:** nenhuma tabela/coluna/endpoint/estrutura é referenciada sem antes ter sido confirmada no código/schema real (ler ou grep antes de citar). Contexto insuficiente → PARAR e pedir os arquivos que faltam.
2. **Entender o problema real.** Se o pedido descreve uma SOLUÇÃO, identificar o PROBLEMA por trás e avaliar se essa solução é a melhor. Pedido é a primeira ideia, não a melhor.
3. **Questionar quando for fraco.** Abordagem que cria dívida, conflita com a arquitetura, duplica algo que já existe ou tem alternativa mais simples: dizer ANTES de implementar, com trade-off concreto.
4. **Resolver ambiguidades antes, não durante.** Requisito com mais de uma interpretação → listar e perguntar. PROIBIDO assumir silenciosamente.
5. **Mapear o raio de impacto.** O que a mudança toca (tabelas, rotas, cron, telas)? Existe código que já faz algo parecido? Estender > criar paralelo. Abstração nova só se justifica por duplicação REAL já existente, nunca por "pode ser útil depois".
6. **Declarar o plano.** O que será feito, onde, por que dessa forma, o que fica de fora, riscos conhecidos.

**Freios de emergência** — parar e alinhar mesmo com pedido aparentemente claro:
- Alterar schema de tabela core (`contas`, `clientes`, `cobrancas`, `parcelas`, `notificacoes_enviadas`)
- Alterar lógica de envio/agendamento/recorrência (risco de disparo indevido, ban de número, ou mexer na geração de parcela recorrente — contradição RN-C1 com decisão pendente, ver `regras-financeiras` §2.2)
- Alterar pagamento/assinatura ou webhooks (Mercado Pago, EfiBank)
- Alterar autenticação, RLS ou qualquer área das skills `seguranca-cobranx` / `isolamento-de-contas`
- Excluir dados ou código "aparentemente morto" (provar que está morto: grep + auditoria de uso — `worker/` já está confirmado morto, mas qualquer outra suspeita exige a mesma prova)

## Processo de correção de bug (obrigatório, nesta ordem)

1. **Reproduzir.** Antes de tocar no código, reproduzir o erro ou localizar o log/stack exato.
2. **Causa raiz.** Perguntar "por que isso aconteceu?" até chegar na origem real, rastreando a cadeia completa (entrada → validação → regra de negócio → banco → resposta). Sintomas comuns e causas típicas neste projeto:
   - Dado `undefined`/vazio na tela → geralmente RLS bloqueando (policy faltando ou `conta_id` errado), não bug de frontend.
   - Ação "não faz nada" sem erro → Supabase retorna sucesso com 0 linhas afetadas quando RLS filtra tudo, ou a mutation esqueceu o filtro de `conta_id` (padrão já encontrado, ver skill `isolamento-de-contas`). Checar `count`/dados retornados, não só ausência de erro.
   - Notificação não sai → verificar na ordem: job entrou na fila? o cron (`app/api/cron/whatsapp-uazapi`) rodou? janela de envio permitia? instância uazapi conectada? Cada etapa tem log próprio.
3. **Corrigir na origem.** Nunca mascarar: proibido `?.` para esconder undefined, `try/catch` vazio, `setTimeout` para "esperar dar certo", ou `as any` para calar o TypeScript.
4. **Procurar o mesmo padrão.** Achou a causa? Grep o mesmo padrão no resto do código e corrigir todas as ocorrências na mesma tarefa.
5. **Verificar.** Rodar `tsc --noEmit` e build, testar o fluxo afetado ponta a ponta. Descrever o que foi testado ao concluir.

## Padrões TypeScript

- `strict: true` sempre. Zero `any` novo; tipo desconhecido → `unknown` e estreitar. **Achado aberto (COD-A2):** ainda há ~112 ocorrências de `any` em `app/`+`lib/` (eram 152 em 2026-09-19; as causadas por tipo de tabela/coluna faltando já saíram) — ao tocar um arquivo com isso, corrigir a ocorrência tocada, não a base inteira de uma vez fora do escopo.
- `types/database.ts` é o espelho tipado do schema. Hoje é **mantido à mão** (sem `SUPABASE_ACCESS_TOKEN` no ambiente não dá para rodar `supabase gen types`): **toda migration que cria/altera tabela ou coluna atualiza esse arquivo na MESMA tarefa** (última sincronização: migration 0032). `as any` porque "a tabela/coluna não está nos types" é o sintoma de que essa regra foi esquecida — foi assim que `cobrancas_pix` e `mensagens_rapidas` passaram meses sem tipo, inclusive dentro do webhook que confirma pagamento PIX. Nunca redeclarar shapes de tabela em outro lugar.
- Valores monetários: regra do projeto é **centavos como `number` inteiro**; formatar para R$ só na borda da UI. **Achado aberto (COD-A1):** o banco hoje usa `numeric(12,2)` e há `parseFloat` em produção — migrar é mudança de schema, alinhar antes (freio de emergência acima), não fazer de passagem.
- Datas: armazenar em UTC (`timestamptz`); converter para `America/Sao_Paulo` apenas na exibição e na interpretação de "janela de envio". Toda lógica de agendamento declara timezone explicitamente.

## Padrões Next.js 15

- Server Components por padrão. `"use client"` apenas quando há interatividade real.
- **SSR vs. CSR vs. RSC:** escolher pelo que a página precisa, nunca por padrão do template. Hydration mismatch é bug, não warning ignorável.
- Mutações via Server Actions com este esqueleto obrigatório:

```typescript
'use server';

export async function cancelarNotificacao(input: unknown) {
  // 1. Autenticação
  const { supabase, contaId } = await getConta();
  if (!contaId) return { ok: false, erro: 'Não autenticado' };

  // 2. Validação
  const dados = schemaCancelar.safeParse(input);
  if (!dados.success) return { ok: false, erro: 'Dados inválidos' };

  // 3. Operação escopada por conta_id EXPLÍCITO na query (ver skill isolamento-de-contas)
  // 4. revalidatePath/revalidateTag do que mudou
  // 5. Retorno tipado { ok, dados?, erro? } — nunca throw para o client
}
```

- Erros para o usuário: mensagem em PT-BR, curta e acionável. Detalhe técnico completo vai para `console.error` no servidor com contexto (`contaId`, ids envolvidos).
- Loading/erro de rota: usar `loading.tsx` e `error.tsx` nas rotas principais. **Achado aberto (DES-A2):** várias telas ainda ficam em branco se o fetch falhar — corrigir ao tocar a rota.
- **Estado remoto vs. local:** dado do servidor não duplica em estado local por padrão; estado local é só para o genuinamente do client (UI aberta/fechada, formulário em edição).
- **Update otimista:** sempre com caminho de rollback claro se a API falhar.

## Padrões Supabase

- `select()` com colunas explícitas, nunca `*` em código de produção.
- Toda listagem tem paginação (`range`) e `order` explícito.
- Verificar SEMPRE o retorno: `const { data, error } = ...; if (error) { log + retorno de erro }`. Proibido ignorar `error` — achado real (COD-M1/M3/M4/M6): vários UPDATEs e actions ignoram `error` hoje, corrigir ao tocar.
- Novas queries que filtram por coluna não indexada em tabela que cresce (cobranças, parcelas, notificações): criar índice na migration junto.
- Operação com múltiplas escritas relacionadas (baixa de parcela: status + lançamento + cancelar notificações) é atômica via RPC/transação — não sequência de updates soltos que pode parar no meio.

## Chamadas a serviços externos (uazapi, Meta, Mercado Pago, EfiBank, Resend, LookDefense)

- **Retry:** backoff exponencial com jitter, nunca retry imediato em loop; só em erro transitório (timeout, 5xx), nunca em erro de validação (4xx); combinar com idempotência para não duplicar efeito.
- **Circuit breaker** em chamada não essencial ao caminho principal: depois de N falhas seguidas, parar de tentar por um tempo e falhar rápido com fallback claro, em vez de empilhar timeout — é o que impede uma dependência lenta (ex.: LookDefense fora do ar) de travar a baixa de uma parcela.
- Toda chamada externa que representa um job da fila (`notificacoes_enviadas`) é idempotente: reprocessar o mesmo job não pode duplicar mensagem — checar estado antes de agir.
- Falha de envio: retry com backoff limitado; após esgotar, marcar `falhou` com motivo legível — nunca deixar job em limbo.
- Logs sempre com contexto: `conta_id`, id do recurso, integração envolvida. Log sem contexto é inútil em produção.

## Criação de features novas

1. Ler o código existente da área antes de escrever — seguir os padrões que já existem, não inventar estrutura paralela.
2. Definir primeiro o caminho do dado: tabela/migration → policy RLS → type → server action/API → UI → (cron, se envolver envio). Implementar nessa ordem.
3. Feature que envolve envio de mensagem SEMPRE passa pela fila existente com janela/intervalos (skill `whatsapp-uazapi`) — nunca criar caminho de envio direto.
4. Comportamento público alterado (contrato de API, payload) atualiza documentação existente na MESMA tarefa.
5. Ao terminar: rodar type-check + build, e listar os arquivos criados/alterados com uma linha explicando cada um.

## Modo cirúrgico (menor diff possível)

Alterar SOMENTE o que a tarefa exige. Nunca reformatar um arquivo inteiro, mover código são de lugar, ou mudar estilo alheio ao pedido "já que estava mexendo aqui mesmo". Diff pequeno e revisável esconde menos regressão.

## Modo produção (nada provisório)

Todo código entregue é considerado pronto para produção: proibido `TODO`, `FIXME`, stub silencioso ou "ajustar depois" no código final. Algo fora do escopo é declarado no plano (FASE 0) ou no fechamento da tarefa como pendência explícita — nunca deixado como resíduo dentro do código.

## Hierarquia de decisão (desempate de trade-off)

Quando duas boas práticas competem (performance vs. legibilidade, velocidade de entrega vs. cobertura de teste):

**Segurança → Correção → Confiabilidade → Manutenibilidade → Performance → Escalabilidade → Elegância → Velocidade de implementação.**

Nunca inverter essa ordem para "economizar tempo agora".

## Auto-revisão sênior (antes de entregar)

Reler o diff como revisor exigente que NÃO escreveu o código:
- Nomes dizem o que as coisas são? Faz sentido pra alguém daqui a 6 meses?
- Edge cases cobertos: vazio, nulo, duplicado, dois cliques simultâneos, fuso horário, conta recém-criada sem dados?
- O que acontece quando isso FALHA (rede, Supabase fora, uazapi/Mercado Pago/EfiBank fora)? Falha é estado previsto com tratamento, não exceção surpresa.
- Alguma lógica foi duplicada em vez de reutilizada? Introduzi acoplamento novo que vai doer depois?
- Alterei algum arquivo que a tarefa não pedia (violação do modo cirúrgico)?

## Handoff obrigatório → sincronizacao-sistema

Toda criação ou alteração de código termina acionando a skill `sincronizacao-sistema`. Se a verificação apontar inconsistência, a correção volta para o processo DESTA skill (causa raiz) e a verificação roda de novo. **A tarefa não está concluída quando o código compila — está concluída quando a sincronização passa limpa.**

## Checklist antes de encerrar qualquer tarefa de código

- [ ] Causa raiz encontrada e explicada (para bugs)?
- [ ] Mesmo padrão corrigido nas demais ocorrências?
- [ ] `tsc --noEmit` e build passando?
- [ ] `error` do Supabase tratado em toda query nova?
- [ ] Nenhum `any`, `catch` vazio ou supressão de erro introduzida?
- [ ] Query/mutation nova filtra `conta_id` explicitamente (não só RLS)?
- [ ] Fluxo afetado testado de ponta a ponta e descrito na resposta?
- [ ] FASE 0 cumprida: plano declarado, ambiguidades resolvidas, alternativas fracas questionadas?
- [ ] Verificação da skill `sincronizacao-sistema` executada e passando limpa?
- [ ] Mudança tocou dado sensível/pagamento/auth? Skill `seguranca-cobranx` acionada?
- [ ] Mudança implementa regra de negócio? Seção da skill `regras-financeiras` citada?
- [ ] Bug corrigido ou regra crítica implementada ganhou teste (skill `testes-cobranx`)?
- [ ] Mensagem de commit proposta no padrão conventional commits (`tipo(escopo): descrição`)?
