---
name: regras-financeiras
description: Fonte única da verdade das regras de negócio do Cobranx — geração de parcelas, recorrência, baixa de pagamento (manual e via PIX/EfiBank), LookDefense, planos e assinatura do SaaS, KPIs. Use SEMPRE que mexer em cobranças, parcelas, baixa, dashboard, indicadores, planos/limites ou qualquer cálculo de valor/data. Autoridade para recusar implementar regra ambígua ou inventada — regra não documentada aqui exige perguntar ao Felippe antes de implementar, nunca assumir o "padrão de mercado".
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

### 2.2 Recorrente (REGRA CRÍTICA — atualmente violada em produção, ver §3.2)
- Checkbox "Recorrente" → `qtd_parcelas` é **ignorado** (recorrência é infinita até cancelar).
- **Parcela é gerada POR DATA, nunca por pagamento.** O sistema mantém **sempre 1 parcela em aberto à frente**, criada antecipadamente pelo scheduler (`app/api/cron/scheduler/route.ts`).
- **Por que (não violar):** se a próxima parcela só nascesse no momento do pagamento, os lembretes "5/3/2/1 dia antes" do próximo ciclo NUNCA disparariam para quem paga atrasado, no dia, ou não paga. Gerar por data garante que o lembrete sempre tenha alvo.
- ❌ **PROIBIDO:** gerar a próxima parcela "ao dar baixa". Quem propuser isso está quebrando os lembretes.
- Cancelar a recorrente interrompe a geração futura; parcelas já abertas permanecem.

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
- `app/api/webhooks/efibank/route.ts` recebe notificação de PIX pago da EfiBank e chama a mesma RPC `baixar_parcela` automaticamente pelo `txid` em `cobrancas_pix`, com idempotência (marca `concluida` antes de processar).
- Ao confirmar, dispara notificação `pagamento_confirmado` (se o canal estiver ativo na conta) e, se o cliente tiver `login_externo`/`tipo_integracao`, aciona a renovação LookDefense (ver §5).
- **⚠️ Achado ainda não corrigido e maior do que se pensava (RN-C1 — ver `docs/auditoria-2026-09-19.md`):** a geração imediata da próxima parcela recorrente ao dar baixa (`abertas === 0`) existe em **3 lugares**, não só neste webhook: `baixarParcelaAction` e `baixarParcelaComConfirmacaoAction` (`app/(app)/cobrancas/_actions/parcelas.ts`) fazem exatamente a mesma coisa — inclusive com um comentário no topo do arquivo dizendo "NÃO gerar próxima parcela recorrente aqui" que o próprio código abaixo contradiz. Isso viola diretamente a regra §2.2 e pode fazer o lembrete D-5/D-3 do próximo ciclo nunca disparar. **Não copiar esse padrão em código novo.** Corrigir (remover os 3 blocos e depender só de `gerarParcelasRecorrentes` em `app/api/cron/scheduler/route.ts`, que já implementa a regra corretamente) é uma mudança em lógica de pagamento em três pontos — passa pelos freios de emergência da skill `codigo-cobranx`, alinhar com o Felippe antes de mexer.
- EfiBank é usada para cobrança PIX do **cliente final** (quem deve). Não confundir com Mercado Pago, que cobra a **assinatura do SaaS** do dono da conta (ver §6).

## 4. Valor da parcela
- Valor é **fixo** por parcela. Só muda pelo **lápis** (edição), que altera vencimento, valor e observação **daquela** parcela.
- Cada parcela guarda seu próprio valor (override) — editar uma não muda as outras.

## 5. LookDefense — renovação automática de acesso externo (IPTV)

Integração real e ativa (`lib/lookdefense/`, `app/api/cron/lookdefense/route.ts`, configurável em Configurações), presente em Clientes/Cobranças/Atendimento. Não documentada em nenhuma skill até esta revisão.

- Cliente pode ter `login_externo` + `tipo_integracao` preenchidos — username dele no painel revendedor LookDefense (produto de IPTV).
- **Ao dar baixa numa parcela de cliente vinculado** (manual §3.1 ou via PIX §3.2), o sistema registra uma `baixas_externas` e aciona `renovarLookDefenseImediato`, que renova o plano IPTV do cliente no painel LookDefense usando as credenciais de revendedor da conta.
- Isso significa que a baixa de uma parcela tem efeito colateral em um sistema de terceiro fora do Cobranx — tratar com o mesmo cuidado de dinheiro: falha na renovação não pode falhar silenciosamente nem travar a baixa da parcela em si (são operações desacopladas: a parcela é dada como paga independente do resultado da renovação).
- `[CONFIRMAR]` O que acontece se a renovação LookDefense falhar (credencial inválida, painel fora do ar)? Hoje não há retry nem alerta visível — perguntar ao Felippe se isso é aceitável ou se precisa de fila com retry e aviso ao dono da conta.

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
- ❌ Gerar parcela recorrente no pagamento (quebra lembretes) — inclusive nas duas actions de baixa manual E no webhook EfiBank, que já fazem isso hoje em 3 lugares (§3.2, corrigir com alinhamento prévio).
- ❌ `float` para dinheiro.
- ❌ Indicador "a receber" somando todas as parcelas em vez de só as do mês.
- ❌ Dois caminhos de baixa com comportamento diferente (manual e PIX chamam a mesma RPC — manter assim).
- ❌ Baixa que não cancela as notificações pendentes da parcela.
- ❌ Prometer/implementar conciliação bancária automática fora do fluxo PIX/EfiBank já existente.
- ❌ Mudar definição de indicador ou de plano/limite sem decisão de produto.
- ❌ Renovação LookDefense falhar e travar ou reverter a baixa da parcela (são operações desacopladas).

## Registro de decisões (append-only)

```
- 2026-07-02 — Parcelas geradas por data (não por pagamento). [decisão de projeto original]
- 2026-07-02 — Janela de envio 09:00–20:00 BRT com intervalos aleatórios. [decisão de projeto original]
- 2026-09-18 — Documentadas EfiBank (baixa PIX automática) e LookDefense (renovação IPTV) como integrações reais desta skill, antes não documentadas. RN-C1 (geração de parcela no webhook EfiBank) permanece violação conhecida, não corrigida nesta revisão — aguarda decisão explícita.
- 2026-09-18 — Twilio removido do código (app, webhook, configurações) por decisão do Felippe; não é mais um canal do produto.
- 2026-09-19 — Auditoria completa (`docs/auditoria-2026-09-19.md`) confirmou RN-C1 em 3 pontos (não 1) e achou limite de plano real já em produção (`limite_clientes`) que não estava documentado. Confirmado também que não existe cadastro self-service — toda conta é provisionada manualmente pelo admin.
```
