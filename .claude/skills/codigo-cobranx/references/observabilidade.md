# Observabilidade — logs, erros e saúde

Ler ao: mexer em logging, investigar erro de produção, configurar monitoramento, criar health checks. Objetivo: qualquer bug em produção é diagnosticável em minutos pelos logs, sem "adicionar console.log e esperar acontecer de novo".

> Arquitetura real (ver skill `whatsapp-uazapi`): não existe worker separado. O envio de WhatsApp roda dentro das rotas de cron do Next (`app/api/cron/whatsapp-uazapi`, `app/api/cron/scheduler`), acionadas a cada 1min por um serviço externo (cron-job.org). Toda orientação abaixo que antes falava de "worker" e "Redis" foi corrigida para essa realidade.

## 1. Logging estruturado (JSON, sempre)

Logger único compartilhado. Todo log tem:

```json
{
  "nivel": "info|warn|error",
  "ts": "2026-07-01T12:00:00Z",
  "requestId": "req_abc123",
  "contaId": "uuid",
  "evento": "notificacao_enviada",
  "recurso": { "tipo": "notificacao", "id": "uuid" },
  "msg": "texto curto",
  "duracaoMs": 142
}
```

- `console.log` solto é proibido em código de produção — sempre o logger.
- Níveis: `info` = evento de negócio relevante; `warn` = anômalo mas recuperado (retry funcionou, janela cheia); `error` = falhou e alguém precisa saber. Não poluir `info` com debug.
- PROIBIDO em log: telefone/e-mail em claro (mascarar `+55***9876`), conteúdo completo de mensagem, senha/token/segredo, payload inteiro "por garantia".

## 2. Correlação ponta a ponta (requestId)

O caminho de uma cobrança cruza a rota que cria/agenda e a execução de cron que dispara — sem correlação, debug vira arqueologia.

1. Gerar `requestId` no início de cada requisição (middleware) e injetar no logger do request.
2. Ao criar um registro em `notificacoes_enviadas` (status `fila`), incluir o `requestId` de origem no log, mesmo que não vá no banco.
3. A execução do cron loga todos os eventos daquela notificação com contexto (`conta_id`, `notificacao_id`, canal).
4. Resultado: `grep notificacao_id=uuid` conta a história inteira — criada → fila → cron processou → uazapi/Meta enviou → status atualizado.

## 3. Error tracking (Sentry, quando configurado)

- Sentry no Next (client + server), com `environment` (dev/prod) e `release` (git SHA).
- Todo `catch` que engole erro recuperável ainda registra: `Sentry.captureException(err, { extra: { contaId, recursoId } })` — contexto sem dados pessoais.
- `beforeSend` remove campos sensíveis por segurança.
- Alertas: erro novo (primeira ocorrência) e pico (> 10/min) notificam o Felippe. Erro sem notificação = erro que o cliente reporta primeiro.

## 4. Health checks e heartbeat

Não há mais `/health` de worker. A saúde do sistema de envio se verifica de outra forma:

- **Cron externo (cron-job.org):** configurar alerta de falha no próprio painel dele — se o cron parar de rodar (falha de rede, erro 500 repetido), é o primeiro sinal de que lembretes pararam.
- **Status de conexão por conta:** a tabela `conexoes` reflete o estado real de cada instância uazapi; a badge de "WhatsApp desconectado" na Dashboard (skill `whatsapp-uazapi`) é o heartbeat visível para o dono de cada conta.
- **Orçamento de tempo do cron:** `app/api/cron/whatsapp-uazapi` tem `maxDuration` de 300s com orçamento interno de 270s — logar quando a execução se aproxima do teto, é sinal de que o volume cresceu e a lógica de corte gracioso precisa de atenção.
- Monitor externo (UptimeRobot ou similar) pode checar uma rota leve de "última execução do cron" (timestamp gravado a cada tick) para detectar cron parado, se isso ainda não existir.

## 5. Métricas mínimas de operação

Deriváveis dos logs/tabelas, exibíveis num painel interno simples:

- Notificações processadas/falhas por hora · tempo médio na fila até o envio · taxa de entrega WhatsApp por instância · mensagens por chip/dia (vs. limite anti-ban) · erros por rota (via Sentry).

Quando um cliente disser "a mensagem não chegou", a resposta vem da timeline de logs correlacionados — não de suposição.
