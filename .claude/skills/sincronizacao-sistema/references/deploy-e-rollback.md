# Deploy, Verificação e Rollback

Ler ao: preparar deploy que cruza camadas, lançar feature arriscada, ou reverter. O objetivo: deploy é rotina chata e previsível — nunca evento de adrenalina.

> Arquitetura real (ver skill `whatsapp-uazapi`): não existe mais deploy de worker/VPS. O disparo de WhatsApp roda dentro das rotas de cron do próprio app Next.js, acionadas por um cron externo (cron-job.org) a cada 1min. "Deployar o app" e "deployar o que envia WhatsApp" são a MESMA coisa agora — não duas coisas coordenadas.

## 1. Pipeline padrão de deploy

1. CI verde na branch (tsc, build, testes, gitleaks, npm audit).
2. **Banco:** aplicar migrations em produção primeiro (retrocompatíveis por construção — ver núcleo da skill).
3. **App (Vercel):** merge na `main` → deploy automático. Como as rotas de cron de WhatsApp vivem aqui, o deploy do app É o deploy do disparo — não faz sentido tentar "drenar graciosamente" antes, o próprio cron externo vai chamar a rota nova na próxima execução (até 1min depois).
4. Verificação pós-deploy (abaixo). Só então a tarefa está concluída.

## 2. Janela de deploy

- Deploy do app pode a qualquer hora (Vercel é atômico) — mas se a mudança toca a lógica de envio (`app/api/cron/whatsapp-uazapi`, `app/api/cron/whatsapp`), preferir deployar fora da janela 09–20h de disparo quando a mudança for arriscada, para reduzir o número de execuções de cron que pegam o código no meio de uma verificação manual.
- Mudança que depende de migration espera a migration confirmada antes do deploy do app.
- Sexta à noite só com motivo forte — problema descoberto no sábado é problema resolvido sozinho no sábado.

## 3. Verificação pós-deploy (checklist de 10 minutos)

- [ ] Tela de Conexão mostra instâncias com status correto (não travada em "conectando")
- [ ] Criar cobrança de teste na **conta interna** com notificação imediata → mensagem chega no WhatsApp de teste → status atualiza na UI
- [ ] Sentry (se configurado) sem erro novo nos primeiros 15 min
- [ ] Logs da rota de cron (Vercel → Logs, filtrar por `/api/cron/whatsapp-uazapi`) sem `error` anômalo nas últimas execuções
- [ ] Fila (`notificacoes_enviadas` com `status = 'fila'`) sem acúmulo crescente
- [ ] Fluxo alterado no release testado manualmente em produção

Falhou qualquer item → decidir na hora: forward-fix rápido ou rollback. Não "observar mais um pouco" com erro ativo.

## 4. Rollback por camada

| Camada | Como | Tempo |
|---|---|---|
| App (inclui cron de WhatsApp) | Vercel → Deployments → Promote no deploy anterior | ~30 s |
| Banco | **Forward-fix** (nova migration desfazendo efeito). Restore de backup só em catástrofe | varia |

- Manter SEMPRE anotada a tag/commit em produção (release no GitHub ou `DEPLOYED.md`).
- Rollback do app com migration nova já aplicada: seguro por construção — migrations são retrocompatíveis (coluna nova nullable, nada removido). É exatamente por isso que a regra existe.
- Pós-rollback: registrar motivo, abrir correção imediatamente, redeployar corrigido. Rollback não encerra a tarefa.

## 5. Feature flags (mudança arriscada liga por conta)

Para features que alteram comportamento de envio/cobrança (risco real ao cliente):

```sql
CREATE TABLE feature_flags (
  chave text NOT NULL, conta_id uuid,          -- conta_id null = default global
  ativo boolean NOT NULL DEFAULT false,
  PRIMARY KEY (chave, conta_id)
);
```

- Helper `flagAtiva(chave, contaId)` com precedência: flag da conta > default global.
- Rollout: conta interna (dog food) → 2–3 clientes próximos → geral → remover a flag e o código antigo (flag permanente é dívida).
- Desligar a flag é o rollback instantâneo da feature — sem deploy.

## 6. Comunicação de release

- Mudança visível ao cliente → nota curta de novidades (changelog público ou aviso no app). Cliente que descobre mudança sozinho perde confiança.
- Manutenção com indisponibilidade de envio → avisar clientes antes, com janela e duração.
