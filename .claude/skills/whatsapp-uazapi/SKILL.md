---
name: whatsapp-uazapi
description: Arquitetura real de conexão e disparo WhatsApp deste projeto — uazapi direto (Vercel ↔ uazapi via cron externo), SEM worker/VPS. Use SEMPRE que mexer em conexão WhatsApp, pareamento/QR, envio de mensagem, ritmo/fila de disparo, ou campanhas em `/disparos`. Define o que roda onde hoje, o ritmo anti-ban e por que o diretório `worker/` é código morto. Consulte antes de escrever qualquer código que conecte ou envie pelo WhatsApp — o erro mais caro aqui é reintroduzir a arquitetura antiga (Baileys + worker na Vortexus), que foi abandonada.
---

# WhatsApp — uazapi direto (sem worker)

> **Mudança de arquitetura (2026-09-18):** o worker Node na VPS Vortexus parou de rodar por completo — não só a conexão WhatsApp, o scheduler inteiro. Decisão do dono do projeto: **não voltar a depender da Vortexus.** A conexão, os lembretes agendados e o disparo de campanhas rodam hoje 100% em Next.js (Vercel) + uazapi, acionados por cron externo. Se você (ou uma sessão futura) encontrar menção a "o worker" ou "a Vortexus" em código, comentário ou outra skill, **trate como legado até confirmar o contrário** — não assuma que ainda roda.

## O que roda onde (arquitetura atual)

- **Conexão:** `app/(app)/conexao/_actions/conexao.ts` fala direto com a uazapi via `lib/uazapi.ts`. Não existe comando gravado no banco pra um worker consumir. A tela de conexão faz **polling próprio (6s)** enquanto o status é "conectando".
- **Lembretes e campanhas:** `app/api/cron/whatsapp-uazapi/route.ts` é o único lugar que dispara mensagem. Uma execução desse endpoint faz, nesta ordem: (1) sincroniza o status de conexão de todas as contas via `getAllInstances()`; (2) drena os lembretes agendados de cada conta respeitando o ritmo real (`sleep()` de verdade — não é "1 mensagem por tick de cron"); (3) drena a campanha de disparo ativa (`/disparos`) da conta, se houver.
- **Gatilho real:** um serviço **externo** (cron-job.org, mesma conta usada no projeto irmão ERP-Rifas) chama esse endpoint **a cada 1 minuto** com `Authorization: Bearer $CRON_SECRET`. O `vercel.json` só tem os crons nativos da Vercel como **fallback diário** (`5 8 * * *`) — olhar só o `vercel.json` engana sobre a cadência real. Qualquer mudança na frequência de disparo é configurada no painel do cron-job.org, não no repositório.
- **O timeout do cron-job.org é FIXO em 30s** (plano usado neste projeto, não dá pra aumentar) — bem menor que o ritmo anti-ban real (15-80s por mensagem). Achado real (2026-09-19): toda execução com pelo menos 1 lembrete pendente estourava esse tempo, o cron-job.org marcava a chamada como falha e, acumulando falhas, ficava a um passo de **desativar o job sozinho** — o que teria parado os lembretes automáticos de vez. Corrigido em `app/api/cron/whatsapp-uazapi/route.ts`: depois de calcular as contas elegíveis (rápido, sem sleep), a rota devolve a resposta HTTP na hora e só então processa de verdade, em segundo plano, via `after()` do `next/server` (suportado nativamente pela Vercel até `maxDuration`). **Qualquer novo cron/rota que precise de `sleep()` real de mais de alguns segundos por causa de ritmo anti-ban (ou qualquer chamada externa lenta) precisa do mesmo padrão** — nunca assumir que o chamador externo vai esperar o tempo todo. `after()` lança fora de uma requisição real do Next (é assim que os testes, que chamam o handler direto, continuam cobrindo o processamento síncrono de fallback — ver `tests/cron-whatsapp-uazapi.test.ts`).
- **Campanhas (`/disparos`):** `enviarCampanhaAction` não envia mais síncrono num loop. Ele só marca `status = 'enviando'`; quem drena `campanha_destinatarios` de fato é o cron acima, no mesmo ritmo dos lembretes.
- **Meta Cloud API** (WhatsApp oficial, canal paralelo para quem tem número corporativo verificado) continua intocada, com seu próprio cron (`app/api/cron/whatsapp/route.ts`, também chamado a cada 1min pelo cron-job.org). Os dois canais não se misturam: uma conta usa uazapi OU Meta Cloud API.
- **Código morto:** `worker/src/*` (incluindo `uazapi-manager.ts` e `whatsapp-worker.ts`) continua no repositório mas **não roda em lugar nenhum**. Não editar ali esperando efeito em produção; qualquer mudança de comportamento de envio/lembrete/campanha se faz em `app/api/cron/whatsapp-uazapi/route.ts`. Se um dia o worker for oficialmente reativado ou removido, é decisão explícita do dono do projeto — perguntar antes de assumir qualquer um dos dois caminhos.

## Invariantes do envio (valem para o cron uazapi, o cron Meta, o envio imediato e o "Forçar envio")

Todos vieram de bugs reais encontrados na auditoria de 2026-09-19 — cada um tem teste em `tests/` que falha se voltar.

1. **Nunca reivindicar (`processando`) antes de saber que dá para enviar por aquele caminho.** `enviarWhatsAppImediato` é **só Meta**: conta uazapi deixa a notificação em `fila` para o cron da uazapi. Reivindicar e desistir deixava confirmação de pagamento e "Cobrar agora" presos para sempre (o cron só lê `fila`).
2. **Depois de reivindicar, toda saída sem enviar devolve o status** (`fila`, ou o original no "Forçar"). Nada fica em `processando` por descuido.
3. **Depois que a mensagem saiu, nada devolve a notificação para `fila` nem marca falha** — nem exceção no histórico de atendimento, nem erro ao gravar o status. O cron reenviaria e o cliente receberia 2x. Gravar `enviado` com repetição (3 tentativas) e, se o banco nunca aceitar, logar `MENSAGEM ENVIADA MAS STATUS NÃO GRAVADO` — mas não reenviar.
4. **Toda mudança de status passa por `atualizarStatusNotificacao`** (`lib/whatsapp/status-notificacao.ts`): checa o `error`, escopa por `conta_id`, loga com contexto. Ignorar o retorno do `.update()` é o defeito que deixou jobs presos.
5. **Última checagem antes de enviar lembrete (`vereditoLembrete`):** a baixa da parcela só cancela notificações em `fila`; uma já `processando` (esperando os 15–20s de digitação) seguia e cobrava quem acabou de pagar. Lembretes `5d/3d/2d/1d/dia/vencido1d` são conferidos contra a parcela imediatamente antes do envio; `paga` → cancela; erro de leitura → volta para `fila` (perder um lembrete é melhor que cobrar quem pagou). `pagamento_confirmado`, `manual`, `boasvindas` e `agendada` não passam por essa checagem.
6. **Texto da mensagem nunca sai com dado errado:** `resolverVariaveis` lança `VariaveisIndisponiveisError` em vez de cair em `R$ 0,00`/campo vazio. `erro_banco` → volta para `fila` e tenta no próximo tick; `nao_encontrado` → cancela.
7. **Erro no claim não vira laço quente:** se o UPDATE do claim falha, `break` (o próximo tick tenta de novo) — nunca `continue`.
8. **Pendência de decisão:** não existe "reaper" de `processando` antigo. Precisa de uma coluna com o horário do claim (migration em tabela core) e de decidir o risco de reenvio; sem ela, um processo morto no meio do envio deixa a notificação presa. Ver `docs/auditoria-2026-09-19.md`.

## Modelo de conexão

- **1 conta (tenant) = 1 instância uazapi = 1 número.** Nunca compartilhar instância entre contas.
- Sessão/token da instância vive no banco (`uazapi_instance_token`), associada por `conta_id` — nunca exposta ao navegador. **Achado de auditoria em aberto:** esse token está gravado em texto claro na tabela hoje; se for tocar essa coluna, criptografar em repouso é o correto, não uma melhoria opcional (ver skill `seguranca-cobranx`).
- Tela de Conexão expõe: QR Code para parear · status (conectado/desconectado/conectando) · número e nome do dispositivo · botão desconectar · botão reiniciar conexão (gera novo QR sem envolver servidor nenhum além da uazapi).

## Anti-ban (ritmo de envio — obrigatório, não é sugestão)

- **Intervalo entre disparos: 45–80 segundos**, aleatório dentro da faixa. Configurável por conta na tabela `configuracoes`, mas os valores lá **ainda não são lidos** pelo cron — hoje é hardcoded (pendência conhecida; não implementar leitura de config "de brinde" numa tarefa não relacionada sem alinhar, mas citar quando aparecer).
- **Simulação de digitação antes de qualquer envio automático:** `POST /message/presence` seguido de `sleep` de 15–20s (`simularDigitacao()`). Pular esse passo aumenta risco de detecção — nunca remover pra "acelerar" uma campanha.
- **Janela de envio: 09:00–20:00** (America/Sao_Paulo). Fora disso não dispara.
- **Fila um-a-um por conta.** Nunca paralelizar envio no mesmo número.
- **Overflow:** o que não couber até as 20h continua no dia seguinte às 09h — nunca descarta, nunca acelera pra compensar.
- **Rate limit da uazapi (HTTP 429):** nunca tratar 429 como "instância desconectada" nem apagar/recriar a instância por causa disso — é throttling temporário, não perda de sessão. Essa distinção já causou bug antes; tratar 429 com backoff e retry, não com reconexão.
- Mensagem é texto no MVP.
- **Sem trava de conversa prévia no sistema** (decisão do operador): o sistema NÃO bloqueia envio para número sem conversa anterior. A boa prática de só cadastrar quem já tem conversa é responsabilidade do dono da conta — não implementar esse bloqueio.

## Alerta de queda

- Conexão caída → badge fixo na Dashboard ("WhatsApp desconectado") + e-mail ao dono da conta. Objetivo: o cliente não descobrir tarde demais que os lembretes pararam — foi exatamente isso que aconteceu quando o worker antigo morreu em silêncio.

## Status de entrega (ack) → Log

- Capturar o status retornado pela uazapi e registrar em `notificacoes_enviadas`: enviado / entregue / lido / falhou.

## Robustez

- Falha de conexão ou de envio de uma conta nunca deve travar a execução do cron pras outras contas — cada conta é isolada dentro do loop do endpoint (mesma régua de isolamento multi-tenant da skill `isolamento-de-contas`).
- Logar erros de conexão/envio para diagnóstico, sem vazar token/credencial da instância.
- `maxDuration` do endpoint de cron é limitado (hoje 300s, orçamento interno de 270s) — processamento que se aproxima desse teto deve encerrar graciosamente e deixar o resto pro próximo tick (1 min depois), nunca estourar o timeout no meio de um envio.

## Antipadrões — NÃO fazer

- ❌ Reintroduzir socket Baileys ou reativar `worker/src/*` sem decisão explícita do dono do projeto.
- ❌ Assumir que o `vercel.json` mostra a cadência real dos crons (a cadência de 1min é externa, no cron-job.org).
- ❌ Tratar HTTP 429 da uazapi como desconexão.
- ❌ Intervalo de disparo menor que 45s ou fixo (sem aleatoriedade).
- ❌ Enviar fora da janela 09–20h, ou pular a simulação de digitação.
- ❌ Disparo em lote/paralelo no mesmo número.
- ❌ Sessão/token uazapi exposto ao client ou compartilhado entre contas.
- ❌ Uma conta com problema derrubar o processamento das outras dentro do mesmo cron.
