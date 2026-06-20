---
name: regras-financeiras
description: Regras de negócio financeiras do sistema de cobrança — geração de parcelas, recorrência, baixa de pagamento, status e definição exata de cada indicador/KPI. Use SEMPRE que mexer em cobranças, parcelas (mensalidades), baixa, dashboard, indicadores ou qualquer cálculo de valor/data. Estas regras são a fonte da verdade; não improvisar nem "otimizar" sobre elas. Consulte antes de escrever lógica financeira.
---

# Regras Financeiras — Cobrança (núcleo do sistema)

> Aqui nascem os bugs que custam dinheiro e quebram a confiança do cliente. **Nenhuma destas regras pode ser alterada por conveniência ou "otimização" sem decisão explícita do produto.** Em dúvida, parar e perguntar — nunca supor.

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

### 2.2 Recorrente (REGRA CRÍTICA)
- Checkbox "Recorrente" → `qtd_parcelas` é **ignorado** (recorrência é infinita até cancelar).
- **Parcela é gerada POR DATA, nunca por pagamento.** O sistema mantém **sempre 1 parcela em aberto à frente**, criada antecipadamente pelo scheduler.
- **Por que (não violar):** se a próxima parcela só nascesse no momento do pagamento, os lembretes "5/3/2/1 dia antes" do próximo ciclo NUNCA disparariam para quem paga atrasado, no dia, ou não paga. Gerar por data garante que o lembrete sempre tenha alvo.
- ❌ **PROIBIDO:** gerar a próxima parcela "ao dar baixa". Quem propuser isso está quebrando os lembretes.
- Cancelar a recorrente interrompe a geração futura; parcelas já abertas permanecem.

## 3. Baixa de pagamento ("Pago")
- **Regra única, dois pontos de entrada idênticos:** botão "pago" no card do menu Cobranças **e** botão calendário dentro do detalhe da cobrança fazem **exatamente a mesma coisa**.
- Efeitos atômicos da baixa (tudo ou nada):
  1. `parcela.status = paga`, `data_pagamento = hoje`.
  2. Cria `lancamento` tipo `entrada`, origem `parcela` (alimenta a Dashboard).
  3. **Cancela todas as notificações pendentes (status `fila`) daquela parcela, em ambos os canais** (não lembrar de algo já pago).
  4. Se recorrente: dispara verificação de geração da próxima parcela (mantém 1 à frente).
- Baixa é **manual** (clique do usuário). O sistema **não** faz conciliação bancária — "recebido" reflete o que foi marcado como pago, não pagamento real confirmado. Não prometer/implementar conciliação automática.

## 4. Valor da parcela
- Valor é **fixo** por parcela. Só muda pelo **lápis** (edição), que altera vencimento, valor e observação **daquela** parcela.
- Cada parcela guarda seu próprio valor (override) — editar uma não muda as outras.

## 5. Status visual da cobrança (card)
- Baseado na(s) parcela(s) **mais próxima(s)** em aberto.
- Estados: **Em dia** | **Vence hoje** | **Vencido**.
- Se houver **simultaneamente** 1 vencida e 1 perto de vencer → **mostrar as duas** (não esconder uma).

## 6. Indicadores / KPIs — DEFINIÇÃO EXATA (não inventar)
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

## 7. Caixa (Entradas e Saídas)
- **Entrada** automática a cada baixa de parcela (origem `parcela`).
- **Entradas/Saídas manuais** lançadas pelo usuário (origem `manual`).
- Dashboard soma os `lancamentos` do mês selecionado.

## 8. Precisão e datas
- Trabalhar valores em **decimal/inteiro de centavos** — nunca `float` para dinheiro.
- Datas de vencimento respeitam fuso do Brasil (America/Sao_Paulo). "Hoje", "vence hoje", "vencido Xd" calculados nesse fuso.
- Formatação monetária: `R$ 1.234,56` (pt-BR), `tabular-nums` na UI.

## 9. Antipadrões — NÃO fazer
- ❌ Gerar parcela recorrente no pagamento (quebra lembretes).
- ❌ `float` para dinheiro.
- ❌ Indicador "a receber" somando todas as parcelas em vez de só as do mês.
- ❌ Dois caminhos de baixa com comportamento diferente.
- ❌ Baixa que não cancela as notificações pendentes da parcela.
- ❌ Prometer/implementar conciliação bancária automática (baixa é manual).
- ❌ Mudar definição de indicador sem decisão de produto.
