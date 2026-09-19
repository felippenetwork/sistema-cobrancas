---
name: sincronizacao-sistema
description: Verificação de sincronização e integridade arquitetural do Cobranx — atua em dupla com a skill codigo-cobranx, com autoridade de gatekeeper (BLOQUEADA / APROVADA COM RESSALVAS / APROVADA). Use SEMPRE após qualquer criação ou alteração de código, e antes/depois de mudar schema, types, contratos de API, payloads de notificação, templates ou variáveis de ambiente. Audita banco e frontend/cron (Vercel), mapeia o grafo de dependência completo, detecta conflitos e inconsistências, e devolve para correção via codigo-cobranx até a verificação passar limpa.
---

# Sincronização do Sistema — Cobranx

> **Arquitetura real (corrigida — verificar antes de assumir o contrário):** o Cobranx hoje é essencialmente **2 partes com deploy independente**: o app Next.js na Vercel (que inclui as rotas de cron que fazem o disparo de WhatsApp) e o banco Supabase (schema, RLS). Não existe mais um worker separado deployando por conta própria — `worker/` é código morto (ver skill `whatsapp-uazapi`). Isso reduz a superfície de "janela entre deploys" em relação ao desenho antigo, mas não elimina: banco e app ainda deployam em momentos diferentes, e o cron externo (cron-job.org) chama a aplicação a cada 1min, então uma mudança de contrato mal sequenciada ainda pode quebrar uma execução no meio.

Uma mudança em qualquer parte pode quebrar a outra silenciosamente. Este protocolo impede isso. Nenhuma mudança está "pronta" enquanto a cadeia inteira não estiver consistente. **Não existe aprovação parcial** — três estados possíveis:

- **BLOQUEADA** — estado inicial de toda tarefa; volta aqui sempre que uma verificação falhar.
- **APROVADA COM RESSALVAS** — FASE 3 e FASE 4 passaram limpas; existe pendência não crítica registrada e aceita explicitamente pelo Felippe.
- **APROVADA** — todas as fases rodaram com zero achados.

**Como esta skill trabalha:** em dupla com a `codigo-cobranx`. A codificação cria e altera; esta skill audita que TODO o sistema continua íntegro. Encontrou inconsistência → devolve para correção pelo processo da `codigo-cobranx` (causa raiz, nunca remendo) → re-verifica a cadeia COMPLETA, não só o item corrigido.

**Referência desta skill:** ao preparar deploy que cruza banco+app, ativar feature arriscada ou reverter qualquer coisa, ler `references/deploy-e-rollback.md`.

## FASE 1 — Antes de mudar: mapear o impacto e o grafo de dependência

Antes de alterar qualquer coluna, tabela, tipo, função, payload ou template:

1. **Buscar todos os usos.** Grep pelo nome exato (e variações) em TODO o repositório, incluindo `worker/src` mesmo sendo código morto — se um dia for reativado ou removido de vez, uma referência esquecida lá não deve enganar ninguém:
   ```bash
   grep -rn "nome_do_campo" --include="*.ts" --include="*.tsx" --include="*.sql" .
   ```
2. **Reconstruir o grafo além do óbvio:** direta (usa o símbolo agora) → indireta (usa algo que usa o símbolo) → **oculta** (nome montado em runtime, string dinâmica — ex.: nome de instância uazapi montado como `quita${contaId...}`, que um grep simples não pega) → circular (sinalizar sempre, nunca ignorar).
3. **Listar os pontos afetados** por camada: migrations/policies → types → server actions/API routes → componentes → rotas de cron → templates de mensagem → variáveis de ambiente.
4. **Declarar o plano** antes de executar: "Esta mudança afeta X arquivos em Y camadas; ordem de alteração será…". Mais de ~10 pontos → propor etapas.

Regra: se o grep encontrou 8 usos, os 8 são atualizados na mesma tarefa. Mudança parcial é a principal fonte de bugs fantasma do projeto.

## FASE 2 — Cadeia de propagação por tipo de mudança

### Mudança de schema (coluna/tabela nova, tipo alterado)

Ordem fixa: migration SQL (com índice, se filtrada) → policies RLS (4 operações, ver skill `isolamento-de-contas`) → atualizar `types/database.ts` (à mão a partir da migration, ou `supabase gen types typescript` quando houver token) → `tsc --noEmit` aponta os pontos quebrados, corrigir um a um → queries/server actions → componentes/telas → rotas de cron, se lerem/gravarem essa tabela → seeds/fixtures, se existirem.

### Renomear ou remover coluna (NUNCA fazer direto — expand/contract)

1. Adicionar a coluna nova (mantendo a antiga).
2. Código passa a gravar nas duas e ler da nova.
3. Migrar dados antigos (`UPDATE ... SET nova = antiga WHERE nova IS NULL`).
4. Depois que tudo estiver na nova, remover leituras da antiga.
5. Só então, migration removendo a coluna antiga.

### Mudança em payload de notificação (`notificacoes_enviadas`, variáveis de template)

Diferente do desenho antigo (payload BullMQ entre dois deploys independentes), hoje o "contrato" é a própria linha da tabela `notificacoes_enviadas` lida pela rota de cron minutos ou dias depois de criada:

1. Campo novo entra como **opcional/nullable** primeiro; a rota de cron trata ausência (registros já criados antes da mudança não têm o campo).
2. Nunca remover leitura de um campo enquanto existirem registros `status = 'fila'` antigos sem ele — esperar a fila drenar (normalmente rápido, mas overflow pode levar até o próximo dia útil dentro da janela 09–20h).
3. Atualizar a definição da variável de interpolação (`#VALOR#`, `#NOME#`...) no mesmo lugar em que os templates são montados, no preview da UI e na função de interpolação real usada pelo cron — testar com um template que usa a variável nova E com um antigo que não usa.

### Mudança em variável de ambiente

1. Adicionar em `.env.example` com comentário — **regra violada 3 vezes neste projeto** (UAZAPI_URL/UAZAPI_ADMIN_TOKEN, e as credenciais de Twilio/LookDefense/EfiBank ficaram fora por meses); não repetir.
2. Configurar na Vercel (todos os ambientes usados).
3. Validar presença no boot (falhar cedo com mensagem clara se ausente).
4. Registrar na resposta final: "variável X precisa ser criada na Vercel antes do deploy".

## FASE 2.5 — Validação semântica (compilar limpo não prova nada)

Type-check verde prova que o código é sintaticamente válido — não prova que o significado continua correto. Responder explicitamente, registrado no relatório final:

- A regra de negócio continua correta depois da mudança? (cruzar com a skill `regras-financeiras` — regra não documentada lá que a mudança tocou é achado bloqueante).
- O comportamento observável mudou para algum consumidor que não pediu essa mudança?
- Existe efeito colateral silencioso — formato de retorno mudou, campo passou a vir nulo onde antes vinha preenchido?

Qualquer "sim" é achado — vira item do relatório, nunca segue silencioso.

## FASE 3 — Depois de mudar: verificação

Executar sempre, nesta ordem:

1. `tsc --noEmit` — zero erros.
2. Build do Next (`next build`) — zero erros.
3. Grep final pelo nome antigo (em caso de renomeio) — deve retornar zero ocorrências fora de migrations históricas e de `worker/src` (código morto, não conta como pendência ativa, mas registrar se encontrado).
4. **Varredura de órfãos gerados por ESTA mudança:** import sem uso, arquivo sem consumidor, endpoint que perdeu todo chamador.
5. Teste manual do fluxo ponta a ponta afetado (ex.: criar cobrança → agendar → cron processa → status atualiza na tela).

## FASE 4 — Verificação de integridade (banco e integrações)

Rodar após toda mudança que toque banco ou contratos — e na íntegra antes de release.

**1. RLS completo em todas as tabelas** (detecta tabela sem RLS ou com operação descoberta — o bug histórico do projeto):

```sql
SELECT t.tablename, t.rowsecurity,
  count(p.policyname) FILTER (WHERE p.cmd = 'SELECT') AS sel,
  count(p.policyname) FILTER (WHERE p.cmd = 'INSERT') AS ins,
  count(p.policyname) FILTER (WHERE p.cmd = 'UPDATE') AS upd,
  count(p.policyname) FILTER (WHERE p.cmd = 'DELETE') AS del
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = 'public'
WHERE t.schemaname = 'public'
GROUP BY t.tablename, t.rowsecurity ORDER BY t.tablename;
```

`rowsecurity = false` ou contagem 0 em operação que o app usa → inconsistência.

**2. Referências órfãs** nas relações tocadas pela mudança (FK lógica quebrada):

```sql
SELECT c.id FROM cobrancas c
LEFT JOIN clientes cl ON cl.id = c.cliente_id
WHERE cl.id IS NULL LIMIT 10;  -- adaptar às relações alteradas
```

**3. Types sincronizados:** toda tabela/coluna criada em `supabase/migrations/` existe em `types/database.ts` (conferir as migrations desde a última sincronização registrada no cabeçalho do arquivo); com token, regenerar (`supabase gen types typescript`) e `git diff` — diff inesperado = schema e código dessincronizados. `as any` no acesso a tabela/coluna é o sinal.

**4. `.env.example` sincronizado:** toda env lida por `process.env` no código tem entrada em `.env.example`. Rodar `grep -rn "process.env\." app lib` e comparar com o arquivo — é exatamente o tipo de achado (SIN-C2) que já escapou três vezes neste projeto.

**5. Compilação:** `tsc --noEmit` + build.

**6. Resíduos:** grep por nomes antigos (renomeios) e por colunas/tabelas/envs referenciadas que não existem mais — zero fora de migrations históricas.

## FASE 4.5 — Auditoria temporal (deploy banco vs. app)

Só se aplica porque banco e app ainda deployam de forma independente — pular esta fase seria erro, mesmo sem worker.

- **Janela antes/durante/depois:** existe intervalo em que o banco já está na versão nova e o app ainda na antiga (ou vice-versa)? O que uma execução de cron que cai exatamente nesse meio recebe?
- **Corrida:** duas execuções do cron (uma iniciada antes do deploy, uma depois) processando a mesma notificação ao mesmo tempo — idempotência (constraint `unique (parcela_id, tipo, canal)`) cobre isso?
- Qualquer resposta "não sei" é achado bloqueante.

## Ciclo de correção (a dupla em ação)

1. Verificação (FASE 3 ou 4) apontou inconsistência → **NÃO remendar aqui**: abrir correção pelo processo da skill `codigo-cobranx` (reproduzir → causa raiz → corrigir na origem → procurar o mesmo padrão no resto do código). Estado volta para BLOQUEADA.
2. Corrigido → rodar a verificação **completa** novamente, não só o item que falhou.
3. Repetir até passar limpo. **Critério de saída: FASE 3 + FASE 4 (+ 4.5 quando aplicável) sem nenhum apontamento.**
4. Registrar cada ciclo no relatório: o que a verificação pegou, causa raiz, correção aplicada.

## Ordem de deploy coordenado (quando a mudança cruza banco + app)

1. **Banco primeiro**, sempre com mudança retrocompatível (coluna nova nullable/default; nunca remover algo ainda em uso).
2. **App/cron routes** (Vercel) por último, já preparados para o novo formato.
3. Limpeza (remover coluna/campo antigo) só numa rodada posterior, com registros antigos já drenados/migrados.

## Relatório de sincronização (obrigatório ao final da tarefa)

```
SINCRONIZAÇÃO — status: BLOQUEADA | APROVADA COM RESSALVAS | APROVADA
- Camadas afetadas: [banco | types | API | UI | cron | env]
- Grafo de dependência: direta N · indireta N · oculta N · circular (sim/não, onde)
- Arquivos alterados: (lista com 1 linha por arquivo)
- Validação semântica: (respostas da FASE 2.5, uma linha cada)
- Verificações: tsc ✔ | build ✔ | grep resíduo ✔ | integridade FASE 4 ✔ | .env.example sincronizado ✔ | auditoria temporal (FASE 4.5) ✔ | fluxo testado: (descrever)
- Ciclos verificação→correção: N (o que foi pego · causa raiz · correção)
- Ressalvas aceitas (se status = APROVADA COM RESSALVAS): (item · aceita por quem · prazo)
- Pendências manuais: (ex.: criar env X na Vercel, rodar migration)
- Ordem de deploy: (se aplicável)
```

## Checklist final

- [ ] Grep de impacto feito ANTES de alterar (incluindo `worker/src`, mesmo morto)?
- [ ] Todas as ocorrências atualizadas na mesma tarefa?
- [ ] Types regenerados após mudança de schema?
- [ ] Validação semântica (FASE 2.5) respondida, sem mudança de comportamento silenciosa?
- [ ] tsc + build passando?
- [ ] `.env.example` sincronizado com todo `process.env` usado no código?
- [ ] Relatório de sincronização incluído na resposta, com status explícito?
- [ ] FASE 4 (integridade de banco) e FASE 4.5 (auditoria temporal, se aplicável) executadas sem apontamentos?
- [ ] Inconsistências encontradas foram corrigidas via `codigo-cobranx` (causa raiz) e re-verificadas por completo?
