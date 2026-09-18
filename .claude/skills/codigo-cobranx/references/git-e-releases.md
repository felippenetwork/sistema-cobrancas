# Git, Migrations e Releases

Ler ao: commitar, criar branch, escrever migration, preparar release ou reverter algo. Mesmo desenvolvendo solo com Claude Code, estas regras são o que permite entender o histórico daqui a 6 meses e reverter com segurança.

## 1. Commits (Conventional Commits)

Formato: `tipo(escopo): descrição no imperativo`

- Tipos: `feat` · `fix` · `refactor` · `chore` · `docs` · `test` · `perf` · `sec` (mudança de segurança).
- Escopos do projeto: `cobrancas`, `clientes`, `notificacoes`, `agendamentos`, `auth`, `worker`, `fila`, `db`, `ui`, `config`.
- Exemplos: `fix(notificacoes): corrigir policy de UPDATE ausente em notificacoes_enviadas` · `feat(agendamentos): adicionar reagendamento em lote`.
- Um commit = uma mudança lógica. Proibido `wip`, `ajustes`, `fix2`. Mensagem responde "o que muda e por quê" — o corpo explica o porquê quando não é óbvio.
- Claude Code: ao concluir tarefa, propor a mensagem de commit no formato acima.

## 2. Branches

- `main` = sempre deployável (Vercel de produção aponta pra ela).
- Trabalho em `feat/...`, `fix/...` — merge só com CI verde (tsc, build, testes de segurança, gitleaks).
- Mudança multi-camada (schema + worker + UI) vive numa branch única até a cadeia inteira estar consistente — nunca mergear metade.

## 3. Migrations (regras rígidas)

- Nome timestampado descritivo: `20260701_adiciona_indice_cobrancas_conta_status.sql`.
- **Migration aplicada é imutável.** Errou? Nova migration corrigindo (forward-fix). Editar migration antiga dessincroniza ambientes.
- Toda migration testada no projeto Supabase de dev antes de produção.
- Migration de dados (backfill) separada da de schema, idempotente (`WHERE nova IS NULL`) e em lotes se a tabela for grande (evitar lock longo).
- Destrutivas (DROP de coluna/tabela) só na fase de limpeza do expand/contract (ver skill sincronizacao-sistema), nunca no mesmo release da mudança.
- Migration nova de tabela inclui: RLS + 4 policies + índices + entrada na lista do teste de isolamento.

## 4. Releases e versionamento

- Tag em release relevante: `v0.4.0` (minor = feature, patch = fixes). O SHA da tag entra no Sentry como `release`.
- `CHANGELOG.md` curto por release, escrito para humano: "Adicionado reagendamento em lote · Corrigido cancelamento de notificações".
- Release cruzando camadas segue a ordem de deploy da skill sincronizacao-sistema (banco → worker → frontend).

## 5. Rollback de código

- **Frontend/cron routes:** Vercel instant rollback para o deploy anterior — primeiro recurso, leva segundos. Como o disparo de WhatsApp roda dentro dessas mesmas rotas (`app/api/cron/*`, ver skill `whatsapp-uazapi`), reverter o deploy da Vercel já reverte o comportamento de envio.
- **Banco:** NUNCA "down migration" em produção. Reverter é forward-fix (nova migration desfazendo o efeito) ou, em catástrofe, restore de backup — decisão consciente, não reflexo.
- Após qualquer rollback: registrar o motivo no CHANGELOG e abrir a correção imediatamente — rollback é anestesia, não cura.
- `worker/` não participa de deploy nenhum (código morto, ver skill `whatsapp-uazapi`) — nunca incluir "restart do worker" num plano de rollback.

## 6. Higiene do repositório

- `.gitignore` cobre: `.env*`, `node_modules`, builds, dumps de banco. `worker/.gitignore` também ignora `dist/` e `*.zip` — build compilado e pacotes de deploy do worker morto não voltam a ser commitados.
- gitleaks no pre-commit (ver skill seguranca-cobranx).
- Arquivo morto se apaga, não se comenta. O histórico do git é o lugar de código antigo.
