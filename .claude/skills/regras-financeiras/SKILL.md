---
name: regras-financeiras
description: Fonte única da verdade das regras de negócio do Cobranx — geração de parcelas, recorrência, baixa de pagamento (manual e via PIX/EfiBank/Mercado Pago), planos e assinatura do SaaS, KPIs. Use SEMPRE que mexer em cobranças, parcelas, baixa, dashboard, indicadores, planos/limites ou qualquer cálculo de valor/data. Autoridade para recusar implementar regra ambígua ou inventada — regra não documentada aqui exige perguntar ao Felippe antes de implementar, nunca assumir o "padrão de mercado".
---

# Regras Financeiras — Cobrança (núcleo do sistema)

> Aqui nascem os bugs que custam dinheiro e quebram a confiança do cliente. **Nenhuma destas regras pode ser alterada por conveniência ou "otimização" sem decisão explícita do produto.** Em conflito entre código existente e este documento, o documento vence — corrigir o código, ou atualizar o documento conscientemente com aprovação do Felippe (ver "Mudança de regra existente"). Em dúvida, parar e perguntar — nunca supor o que "parece razoável" ou o que um projeto parecido costuma fazer.

## Protocolo ao encontrar `[A DEFINIR]` / `[CONFIRMAR]` (obrigatório, sem exceção)

1. **PARAR.** Não implementar com o valor "mais comum do mercado" — isso é regra inventada disfarçada de senso comum.
2. **Apresentar o impacto, não só a pergunta:** o que esta tarefa não pode fazer sem a regra, e o que quebra se a resposta errada for assumida. Oferecer 2–3 opções com trade-off quando possível.
3. **Aguardar resposta explícita.** Silêncio ou "pode seguir" genérico não conta.
4. **Registrar a decisão** em "Registro de decisões" com data, remover a marcação, só então implementar.
5. Felippe indisponível e a tarefa não pode esperar: implementar só a parte que NÃO depende da regra pendente; a parte dependente fica de fora, declarada como pendência explícita — nunca um valor "temporário" que vira regra de produção por inércia.

## 1. Modelo: cobrança (pai) → parcelas (filhas)
- **Cobrança** = contrato. Tem cliente, valor da mensalidade, e é de parcelas fixas OU recorrente.
- **Parcela (mensalidade)** = cada vencimento. Guarda o próprio `valor` (override editável), `data_vencimento`, `status`, `data_pagamento`.
- Um cliente pode ter **várias cobranças ativas** ao mesmo tempo.

## 2. Geração de parcelas

### 2.1 Parcelas fixas
- Cobrança de N parcelas → gera **exatamente N** parcelas, nos meses à frente.
- Vencimento de cada parcela = **dia fixo** (`dia_pagamento`) do respectivo mês.
- **Dia inexistente no mês** (ex.: 31 em fevereiro) → vencimento vai para o **último dia daquele mês**.
- Quando todas as parcelas estão pagas → `cobranca.status = concluida`.

### 2.2 Recorrente — geração na baixa (RN-C1, decidido em 2026-09-21)
- Checkbox "Recorrente" → `qtd_parcelas` é **ignorado** (recorrência é infinita até cancelar).
- **Uma cobrança recorrente nunca tem mais de 1 parcela aberta ao mesmo tempo.** Não é "parcelas fixas com recorrência" — é 1 parcela viva por vez. O histórico da cobrança mostra as que já foram pagas + a única em aberto (a próxima).
- **Criação da cobrança:** `gerarParcelasRecorrentes` (`lib/utils/parcelas.ts`) cria **exatamente 1** parcela (a do próximo vencimento) — nunca um lote pré-gerado. Antes desta decisão criava 3 "para cobertura inicial", o que deixava parcelas futuras sem terem vencido junto de parcelas já pagas, achado real no card de uma conta (Thomaz Martins, #2 e #3 abertas ao mesmo tempo).
- **Renovação (baixa):** dar baixa na parcela aberta gera a próxima na hora, via **4 caminhos equivalentes**: `baixarParcelaAction`, `baixarParcelaComConfirmacaoAction` (aceita um "próximo vencimento" escolhido no modal), `renovarParcelaAction` (Atendimento) e o webhook EfiBank — todos só quando não sobrou nenhuma parcela aberta na cobrança.
- **Valor e vencimento persistem para as próximas:** `cobranca.valor_mensalidade`/`dia_pagamento` são a fonte usada para calcular a parcela seguinte (na baixa e no scheduler). Editar o valor ou escolher outro "próximo vencimento" na renovação atualiza a cobrança — as gerações seguintes usam o valor/dia novo até serem editados de novo.
- **Rede de segurança:** o scheduler (`app/api/cron/scheduler`) roda por cima e cria a parcela seguinte para qualquer cobrança recorrente que fique sem NENHUMA aberta (ex.: a geração na baixa falhou por algum motivo) — mesma regra de "só 1 por vez", usando a última parcela + `cobranca.dia_pagamento`.
- **Trade-off aceito conscientemente:** quem não paga nunca ganha a parcela seguinte (não acumula cobrança futura enquanto a atual está vencida); quem paga atrasado ganha a seguinte na hora da baixa, então perde os lembretes 5d/3d/2d/1d do ciclo que já passou (só recebe os do ciclo novo). Isso já era o comportamento de fato antes desta decisão — o que mudou é a criação inicial (1 em vez de 3) e a regra parar de estar em contradição com a documentação.
- Cancelar a recorrente interrompe a geração futura; parcelas já abertas permanecem.
- Os 4 pontos de geração-na-baixa duplicam a mesma lógica — extrair para uma função única continua sendo uma melhoria pendente, não bloqueante.

## 3. Baixa de pagamento ("Pago")

### 3.1 Baixa manual (fluxo principal)
- **Regra única, dois pontos de entrada idênticos:** botão "pago" no card do menu Cobranças **e** botão calendário dentro do detalhe da cobrança fazem **exatamente a mesma coisa** — ambos chamam a mesma RPC (`baixar_parcela`).
- Efeitos atômicos da baixa (tudo ou nada):
  1. `parcela.status = paga`, `data_pagamento = hoje`.
  2. Cria `lancamento` tipo `entrada`, origem `parcela` (alimenta a Dashboard).
  3. **Cancela todas as notificações pendentes (status `fila`) daquela parcela, em ambos os canais** (não lembrar de algo já pago).
  4. Se recorrente: dispara verificação de geração da próxima parcela (mantém 1 à frente).
- Baixa manual não confirma pagamento real — "recebido" reflete o que o usuário marcou.
- **`#VENCIMENTO#` na mensagem de `pagamento_confirmado` é o vencimento da PRÓXIMA parcela em aberto da cobrança, não o da parcela que acabou de ser paga** (bug relatado pelo Felippe em 2026-10-08, corrigido: a data escolhida em "Próximo pagamento" no modal `ConfirmarBaixaModal` não chegava ao cliente). Resolvido em `resolverVariaveis` (`lib/whatsapp/resolver-variaveis.ts`), que busca a próxima parcela `aberta` da cobrança quando `tipo === 'pagamento_confirmado'` — cai no vencimento da própria parcela paga só quando não sobra nenhuma aberta (última parcela de uma cobrança fixa). **Por isso, nos 4 caminhos de baixa (§2.2), a próxima parcela recorrente é gerada ANTES de enfileirar/enviar a confirmação de pagamento** — se a ordem for invertida, a próxima parcela ainda não existe no banco quando a mensagem é montada e o bug volta. Teste de regressão: `tests/resolver-variaveis.test.ts` (resolução) e `tests/baixar-parcela-confirmacao.test.ts` (ordem).

### 3.2 Baixa automática via PIX (EfiBank e Mercado Pago)
- `app/api/webhooks/efibank/route.ts` recebe notificação de PIX pago da EfiBank e chama a mesma RPC `baixar_parcela` automaticamente pelo `txid` em `cobrancas_pix`. A baixa vem primeiro e só depois a cobrança PIX é marcada `concluida` (ver abaixo).
- **A regra de baixa por PIX vive num lugar só: `lib/pagamentos/baixa-pix.ts` (`baixarPixPago`)**, usada pelos webhooks da EfiBank e do Mercado Pago (§3.3) — RPC, ordem, idempotência, confirmação por WhatsApp e próxima parcela recorrente. Provedor novo localiza a cobrança PIX do seu jeito e chama essa função; nunca duplicar a regra.
- Ao confirmar, dispara notificação `pagamento_confirmado` (se o canal estiver ativo na conta).
- **Geração da próxima parcela recorrente aqui segue a regra decidida em §2.2** (RN-C1): só quando não sobrou nenhuma parcela aberta na cobrança, gera exatamente 1.
- **Ordem e idempotência (PAG-N1, corrigido em 2026-09-19):** a baixa (RPC `baixar_parcela`, idempotente) roda ANTES de marcar a cobrança PIX como `concluida`. Falha transitória (RPC, leitura do banco) responde **5xx para a EfiBank reenviar** e não encerra a cobrança; parcela já paga encerra a cobrança sem repetir efeitos; PIX pago sem parcela vira erro para revisão manual (200, sem reenvio infinito). O efeito (confirmação por WhatsApp) é durável por conta própria — fica em `fila` para o cron — e um erro nele não pede reenvio.
- O webhook autentica por `?token=`: `EFIBANK_WEBHOOK_SECRET` (próprio; quando existe, o `CRON_SECRET` deixa de valer aqui) ou, sem ele, `CRON_SECRET` (legado). **Ainda confia no corpo da notificação** — a regra de segurança pede confirmar a baixa consultando a EfiBank (`GET /v2/cob/{txid}`, exige o escopo `cob.read` na aplicação); não implementado porque, sem esse escopo, todo pagamento ficaria em reenvio. Validar o escopo antes.
- EfiBank e o Mercado Pago PIX (§3.3) cobram o **cliente final** (quem deve) e o dinheiro cai na conta do dono. O Mercado Pago também cobra a **assinatura do SaaS** do dono da conta, com o token da plataforma (ver §10) — integrações separadas: webhooks, credenciais e tabelas diferentes.

### 3.3 Baixa automática via PIX (Mercado Pago do cliente final)
- Cada conta cola o **Access Token da própria conta Mercado Pago** em Configurações (`configuracoes.mp_access_token`, guardado **cifrado** — `lib/crypto/segredos.ts`, chave `CREDENCIAIS_KEY`). O dinheiro cai na conta MP da conta, nunca na da plataforma. Não confundir com `MP_ACCESS_TOKEN`, o token da plataforma que cobra a assinatura (§10).
- **Provedor ativo por conta** (`configuracoes.pix_provedor`, default `efibank`): o botão de PIX do Atendimento passa por `criarCobrancaPixDaConta` (`lib/pagamentos/pix.ts`), que usa o provedor ativo; só dá para ativar um provedor já configurado. Trocar de provedor não cancela PIX ainda ativos do outro — continuam pagáveis até expirar.
- **O valor do PIX é o da parcela lida no banco (escopada pela conta), nunca o vindo do navegador.** Parcela já paga ou de outra conta é recusada.
- **Criação usa a Orders API** (`lib/mercadopago/pix.ts`, `POST /v1/orders` — **não** a API clássica de Pagamentos), confirmada contra o sandbox/produção reais numa integração irmã (ERP-Rifas Clube do Churrasco), não adivinhada. Corpo: `type: 'online'`, `total_amount`, `external_reference` = id da parcela, `processing_mode: 'automatic'`, `transactions.payments[0] = { amount, payment_method: { id:'pix', type:'bank_transfer' } }`, `payer.email`. O código PIX vem em `transactions.payments[0].payment_method.qr_code`. Só é entregue o código que foi gravado em `cobrancas_pix` (`provedor='mercadopago'`, `txid` = **id da ordem**, não do pagamento). Reuso de PIX ativo só se for do mesmo provedor e do mesmo valor (parcela editada gera outro PIX — vale também para a EfiBank).
- **A Orders API NÃO aceita `notification_url` por requisição** (diferente da Preferences API usada para cartão em outros projetos) — o Mercado Pago só chama a URL fixa configurada no painel do PRÓPRIO app da conta ("Suas integrações" → Webhooks). Por isso o webhook do Cobranx é uma **URL única e sem `conta_id`** (`/api/webhooks/mercadopago-pix`): o tenant é achado pelo **id da ordem** (globalmente único, atribuído pelo Mercado Pago) em `cobrancas_pix.txid` — nunca confiar em nada do payload antes de achar esse registro.
- **Cada conta cola DUAS credenciais** em Configurações: o Access Token E a **Secret Key** gerada no painel Mercado Pago ao configurar o webhook (`configuracoes.mp_webhook_secret`, cifrada como o token) — sem as duas, o Mercado Pago não vira o provedor ativo (`salvarProvedorPixAction` exige ambas).
- **Webhook**: valida a assinatura oficial do Mercado Pago (`x-signature`: HMAC-SHA256 hex do manifest `id:{id da ordem em minúsculo};request-id:{x-request-id};ts:{ts};`, comparado com `timingSafeEqual`) usando a Secret Key **daquela conta** (achada depois do lookup pelo id da ordem). A notificação **nunca é confiada** mesmo com assinatura válida: reconsulta `GET /v1/orders/{id}` com o token da conta e só dá baixa se `status === 'processed'` e `status_detail === 'accredited'` (vocabulário próprio da Orders API — não é `approved`). Falha transitória (5xx/429/rede/RPC) responde 5xx para o MP reenviar; assinatura inválida responde 401; 401/404 do MP ao reconsultar responde 200 (reenviar não resolve).
- **Pré-requisito de ambiente:** só `CREDENCIAIS_KEY` na Vercel (cifra as credenciais); não há segredo de app/webhook da plataforma — cada conta configura o próprio webhook no próprio painel Mercado Pago.
- Cliente sem e-mail válido: o MP exige `payer.email`; usa `pagador+<8 primeiros caracteres do id do cliente>@cobranx.site`.
- **Caso conhecido, não tratado:** se a conta trocar de provedor e o cliente pagar PIX dos dois para a mesma parcela, o segundo cai em "parcela já paga" e o valor em duplicidade precisa de estorno manual.

## 4. Valor da parcela
- Valor é **fixo** por parcela. Só muda pelo **lápis** (edição), que altera vencimento, valor e observação **daquela** parcela.
- Cada parcela guarda seu próprio valor (override) — editar uma não muda as outras.

## 5. (removido em 2026-09-21) LookDefense — renovação automática de acesso IPTV

A integração LookDefense foi removida do produto inteiro por decisão do Felippe (migration `0035_remove_lookdefense.sql`: dropa `baixas_externas`, `clientes.login_externo`/`tipo_integracao` e `configuracoes.ld_username`/`ld_password`). A baixa de parcela — manual ou via PIX — não tem mais efeito colateral em sistema de terceiro. Numeração mantida para não quebrar referências a §6 em diante.

## 6. Status visual da cobrança (card)
- Baseado na(s) parcela(s) **mais próxima(s)** em aberto.
- Estados: **Em dia** | **Vence hoje** | **Vencido**.
- Se houver **simultaneamente** 1 vencida e 1 perto de vencer → **mostrar as duas** (não esconder uma).

## 7. Indicadores / KPIs — DEFINIÇÃO EXATA (não inventar)
Todos os indicadores de período são do **mês selecionado**. A tela abre no **mês corrente**, com seletor de mês no topo. Indicador ambíguo = número errado na cara do cliente.

| Indicador | Definição exata |
|---|---|
| **Valores Recebidos** | Soma das parcelas com baixa **no mês selecionado**. |
| **Valores a Receber** | Soma das parcelas **em aberto com vencimento no mês selecionado**. |
| **Clientes Cadastrados** | Total de clientes ativos da conta (não-deletados). |
| **Cobranças Ativas** | Contratos (cobranças) com **≥1 parcela em aberto**. |
| **Mensalidades em Aberto** | Parcelas não pagas **com vencimento no mês selecionado**. |
| **Mensalidades Pagas** | Parcelas pagas **no mês selecionado**. |

**Dashboard (mês corrente, com seletor):**
- **Recebidos no Mês** = entradas (parcelas pagas no mês + entradas manuais).
- **Saídas no Mês** = lançamentos manuais tipo saída.
- **Saldo do Mês** = Recebidos − Saídas.
- Indicadores de contagem: Clientes (total), Cobranças Ativas, Em Aberto (parcelas não pagas do mês), Pagas (parcelas pagas no mês).

## 8. Caixa (Entradas e Saídas)
- **Entrada** automática a cada baixa de parcela (origem `parcela`), seja manual ou via PIX.
- **Entradas/Saídas manuais** lançadas pelo usuário (origem `manual`).
- Dashboard soma os `lancamentos` do mês selecionado.

## 9. Precisão e datas
- Trabalhar valores em **decimal/inteiro de centavos** — nunca `float` para dinheiro. **Achado ainda aberto:** o banco usa `numeric(12,2)` e parte do código usa `parseFloat` (achado COD-A1 do relatório de julho) — migrar para inteiro é mudança de schema que precisa alinhamento explícito antes de mexer, não fazer "de passagem" numa tarefa não relacionada.
- Datas de vencimento respeitam fuso do Brasil (America/Sao_Paulo). "Hoje", "vence hoje", "vencido Xd" calculados nesse fuso.
- Formatação monetária: `R$ 1.234,56` (pt-BR), `tabular-nums` na UI.

## 10. Planos e assinatura do SaaS (Mercado Pago Preapproval)

Cobra o **dono da conta** (quem usa o Cobranx), não o cliente final — não confundir com EfiBank/Mercado Pago PIX (§3.2/§3.3), que cobram o cliente final.

- `[CONFIRMAR]` Entrada de contas: **hoje é só provisionamento manual pelo admin** (`app/admin/contas/nova`) — não existe cadastro self-service em lugar nenhum do produto (confirmado em auditoria de 2026-09-19). Se a meta é vender sem depender do Felippe cadastrar cada cliente, isso é a lacuna nº 1, maior que qualquer ajuste de UI.
- Já existe um limite real em produção, não documentado até agora: `contas.limite_clientes` (default 100), verificado em `criarClienteAction` antes de cadastrar cliente novo. Isso é "1 plano só" hardcoded — não uma tabela de planos.
- `[A DEFINIR]` Tabela de planos × limites de verdade (preencher com o Felippe antes de qualquer tela de upgrade/pricing):

| Plano | Preço | Cobranças ativas | Clientes | Instâncias WhatsApp | Mensagens/mês |
|---|---|---|---|---|---|
| ... | R$ ... | ... | ... | ... | ... |

- Limite atingido → bloquear a AÇÃO nova com mensagem clara + oferta de upgrade; nunca degradar silenciosamente o que já existe.
- `[A DEFINIR]` Trial: existe? Dias? O que libera?
- Falha de pagamento da assinatura: `[A DEFINIR]` quantas tentativas/dias de carência → depois, conta `suspensa` (envios param, acesso e exportação continuam).
- Upgrade: imediato. Downgrade: `[A DEFINIR]` imediato com pro-rata ou na virada do ciclo (recomendação: na virada, mais simples e sem estorno).

## Mudança de regra existente (diferente de preencher um `[A DEFINIR]` novo)

Regra já documentada aqui que MUDA (não uma lacuna nova) exige responder, antes de implementar:
1. **Efeito temporal:** vale só para casos novos a partir de agora, ou é retroativo aos existentes?
2. **Quem é afetado:** entidades já criadas sob a regra antiga continuam com o valor calculado então (congelado) ou recalculam? Decisão explícita, nunca acidental.
3. **Aviso:** mudança que afeta cliente final avisa quando a lei ou o contrato exigir.
4. Se toca dado já persistido: acionar `sincronizacao-sistema` antes de considerar concluída.

## Como usar esta skill
1. Toda implementação de lógica de negócio cita no plano (FASE 0 da skill `codigo-cobranx`) a seção daqui que está implementando.
2. Toda regra desta skill que virar código ganha teste na mesma tarefa (skill `testes-cobranx`) — regra de dinheiro sem teste não existe.
3. Encontrou `[A DEFINIR]`/`[CONFIRMAR]` no caminho → seguir o protocolo do topo deste documento.

## Antipadrões — NÃO fazer
- ❌ Recorrente com mais de 1 parcela aberta ao mesmo tempo — viola a regra decidida em RN-C1 (§2.2). Criação da cobrança gera 1, a baixa/scheduler geram a próxima só quando não sobrou nenhuma aberta.
- ❌ `float` para dinheiro.
- ❌ Indicador "a receber" somando todas as parcelas em vez de só as do mês.
- ❌ Dois caminhos de baixa com comportamento diferente (manual e PIX chamam a mesma RPC — manter assim).
- ❌ Baixa que não cancela as notificações pendentes da parcela.
- ❌ Enviar/enfileirar a confirmação de pagamento ANTES de gerar a próxima parcela recorrente — `#VENCIMENTO#` resolve errado (mostra a parcela já paga em vez da próxima).
- ❌ Prometer/implementar conciliação bancária automática fora dos fluxos PIX já existentes (EfiBank e Mercado Pago).
- ❌ Gerar PIX com o valor vindo do navegador (o valor é o da parcela no banco) ou entregar um código PIX que não foi gravado em `cobrancas_pix`.
- ❌ Dar baixa por PIX do Mercado Pago confiando só no corpo da notificação ou só na assinatura — sempre reconsultar a ordem na API com o token da conta e conferir `status`/`status_detail`.
- ❌ Usar a API clássica de Pagamentos (`/v1/payments`) para criar PIX do Mercado Pago em vez da Orders API, ou esperar que `notification_url` por requisição funcione nela.
- ❌ Copiar a regra de baixa por PIX para um provedor novo em vez de chamar `baixarPixPago`.
- ❌ Mudar definição de indicador ou de plano/limite sem decisão de produto.

## Registro de decisões (append-only)

```
- 2026-07-02 — Parcelas geradas por data (não por pagamento). [decisão de projeto original]
- 2026-07-02 — Janela de envio 09:00–20:00 BRT com intervalos aleatórios. [decisão de projeto original]
- 2026-09-18 — Documentadas EfiBank (baixa PIX automática) e LookDefense (renovação IPTV) como integrações reais desta skill, antes não documentadas. RN-C1 (geração de parcela no webhook EfiBank) permanece violação conhecida, não corrigida nesta revisão — aguarda decisão explícita.
- 2026-09-18 — Twilio removido do código (app, webhook, configurações) por decisão do Felippe; não é mais um canal do produto.
- 2026-09-19 — Auditoria completa (`docs/auditoria-2026-09-19.md`) achou limite de plano real já em produção (`limite_clientes`) que não estava documentado. Confirmado também que não existe cadastro self-service — toda conta é provisionada manualmente pelo admin.
- 2026-09-19 — RN-C1 reanalisado: não é uma "violação simples". São 4 caminhos que geram a parcela na baixa (decisão de UX deliberada, com modal de "próximo vencimento") e o scheduler não gera por data. Vira `[A DEFINIR]` em §2.2 com 3 opções; nada foi removido. PAG-N1 (ordem do webhook EfiBank) corrigido.
- 2026-09-21 — RN-C1 decidido pelo Felippe: opção 1 (manter geração na baixa + scheduler de segurança, reescrever a regra para descrever o comportamento real), MAIS uma correção adicional não coberta pelas 3 opções originais — a criação da cobrança recorrente também não pode pré-gerar um lote (estava criando 3 "de cobertura inicial"), só a próxima parcela. Uma recorrente nunca tem mais de 1 parcela aberta ao mesmo tempo. Efeito: `lib/utils/parcelas.ts` (`gerarParcelasRecorrentes` passa a criar sempre 1, parâmetro `qtdIniciais` removido); os 4 caminhos de geração-na-baixa e o scheduler não mudaram (já geravam 1 por vez). Retroativo: não — cobranças recorrentes já existentes com mais de 1 parcela aberta (geradas sob a regra antiga) não foram limpas automaticamente, é decisão separada do Felippe se quer higienizar os dados existentes.
- 2026-09-21 — Integração LookDefense (renovação IPTV/P2P na baixa) removida do produto inteiro por decisão do Felippe, junto com a coluna/tabela de suporte (migration 0035). A baixa de parcela deixa de ter efeito colateral em sistema de terceiro; §5 virou tombstone. A Meta Cloud API já havia sido removida no mesmo dia (migration 0034) — uazapi é o único canal de WhatsApp.
- 2026-09-21 — Mercado Pago adicionado como segundo provedor de PIX do cliente final, por pedido do Felippe (decisões dele: um provedor ativo por conta; a conta cola o Access Token da própria conta MP; token cifrado na aplicação com `CREDENCIAIS_KEY`). Migration 0036 (`configuracoes.mp_access_token`/`pix_provedor`, `cobrancas_pix.provedor`). Decisões de implementação minhas, registradas aqui: escopo só PIX (sem cartão/boleto/checkout); webhook próprio com token HMAC por conta e reconsulta do pagamento na API do MP (a notificação não é confiada); a regra de baixa por PIX foi extraída do webhook da EfiBank para `lib/pagamentos/baixa-pix.ts` (comportamento preservado, 24 testes da EfiBank); o PIX passa a usar o valor da parcela lido no banco (antes o valor vinha do navegador) e a EfiBank só reutiliza PIX ativo do mesmo valor.
- 2026-09-21 — Correção da integração Mercado Pago acima, no mesmo dia, ANTES de qualquer deploy: a implementação inicial usava a API clássica de Pagamentos (`/v1/payments`) e um webhook com token HMAC inventado embutido na `notification_url`, baseados só em documentação (não testados). O Felippe indicou uma integração irmã (ERP-Rifas Clube do Churrasco) com Mercado Pago PIX funcionando de verdade em produção — a análise dela mostrou que a Orders API (`/v1/orders`) é o formato certo e que ela **não aceita `notification_url` por requisição**, então o webhook por token-na-URL nunca seria chamado (PIX criado, cliente paga, notificação nunca chega). Reescrito para: Orders API, webhook com URL única (sem `conta_id`, tenant achado pelo id da ordem) e assinatura oficial do Mercado Pago (`x-signature`) validada com uma Secret Key própria de cada conta (`configuracoes.mp_webhook_secret`, novo campo da migration 0036, cifrado como o token — cada conta agora cola duas credenciais, não uma). `lib/pagamentos/baixa-pix.ts` não mudou.
- 2026-10-08 — Bug relatado pelo Felippe com print do modal "Confirmar Pagamento": a data escolhida em "Próximo pagamento" não chegava na mensagem de confirmação ao cliente. Causa dupla, já existia antes desta sessão nos 4 caminhos de baixa (§2.2): `#VENCIMENTO#` sempre vinha da parcela recém-paga (nunca da próxima), e mesmo corrigindo isso a notificação era enviada ANTES de a próxima parcela ser criada. Corrigido: `resolverVariaveis` busca a próxima parcela aberta da cobrança para `pagamento_confirmado`; os 4 caminhos (`baixarParcelaAction`, `baixarParcelaComConfirmacaoAction`, `renovarParcelaAction`, `baixarPixPago`) agora geram a próxima parcela ANTES de notificar. Nenhuma regra de negócio nova — correção de bug com 2 causas raiz, registrada aqui por envolver dinheiro/comunicação ao cliente.
```
