---
name: regras-financeiras
description: Fonte única da verdade das regras de negócio do Cobranx — geração de parcelas, recorrência, baixa de pagamento (manual e via PIX/EfiBank), planos e assinatura do SaaS, KPIs. Use SEMPRE que mexer em cobranças, parcelas, baixa, dashboard, indicadores, planos/limites ou qualquer cálculo de valor/data. Autoridade para recusar implementar regra ambígua ou inventada — regra não documentada aqui exige perguntar ao Felippe antes de implementar, nunca assumir o "padrão de mercado".
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

### 3.2 Baixa automática via PIX (EfiBank) — integração real, não documentada até esta revisão
- `app/api/webhooks/efibank/route.ts` recebe notificação de PIX pago da EfiBank e chama a mesma RPC `baixar_parcela` automaticamente pelo `txid` em `cobrancas_pix`. A baixa vem primeiro e só depois a cobrança PIX é marcada `concluida` (ver abaixo).
- Ao confirmar, dispara notificação `pagamento_confirmado` (se o canal estiver ativo na conta).
- **Geração da próxima parcela recorrente aqui segue a regra decidida em §2.2** (RN-C1): só quando não sobrou nenhuma parcela aberta na cobrança, gera exatamente 1.
- **Ordem e idempotência (PAG-N1, corrigido em 2026-09-19):** a baixa (RPC `baixar_parcela`, idempotente) roda ANTES de marcar a cobrança PIX como `concluida`. Falha transitória (RPC, leitura do banco) responde **5xx para a EfiBank reenviar** e não encerra a cobrança; parcela já paga encerra a cobrança sem repetir efeitos; PIX pago sem parcela vira erro para revisão manual (200, sem reenvio infinito). O efeito (confirmação por WhatsApp) é durável por conta própria — fica em `fila` para o cron — e um erro nele não pede reenvio.
- O webhook autentica por `?token=`: `EFIBANK_WEBHOOK_SECRET` (próprio; quando existe, o `CRON_SECRET` deixa de valer aqui) ou, sem ele, `CRON_SECRET` (legado). **Ainda confia no corpo da notificação** — a regra de segurança pede confirmar a baixa consultando a EfiBank (`GET /v2/cob/{txid}`, exige o escopo `cob.read` na aplicação); não implementado porque, sem esse escopo, todo pagamento ficaria em reenvio. Validar o escopo antes.
- EfiBank é usada para cobrança PIX do **cliente final** (quem deve). Não confundir com Mercado Pago, que cobra a **assinatura do SaaS** do dono da conta (ver §6).

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

Cobra o **dono da conta** (quem usa o Cobranx), não o cliente final — não confundir com EfiBank (§3.2).

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
- ❌ Prometer/implementar conciliação bancária automática fora do fluxo PIX/EfiBank já existente.
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
```
