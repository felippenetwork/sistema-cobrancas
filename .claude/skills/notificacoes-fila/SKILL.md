---
name: notificacoes-fila
description: Regras do motor de notificação e fila de disparo (WhatsApp + e-mail) deste projeto. Use SEMPRE que mexer em notificações, lembretes de cobrança, scheduler, workers de envio, templates, variáveis (#VALOR#, #NOMECOMPLETO# etc.), idempotência ou agendamento. Define os 8 tipos, os dois canais, idempotência e o ciclo de vida do disparo. Consulte antes de escrever qualquer lógica de notificação.
---

# Motor de Notificação e Fila (WhatsApp + E-mail)

> O motor decide QUANDO e PARA QUEM disparar, e garante que nada dispare duplicado nem fora de hora. Erros aqui = cliente cobrado duas vezes, ou nunca. Tratar com rigor.

## 1. Os 8 tipos (dias fixos, não editáveis)
1. **5 dias antes** do vencimento
2. **3 dias antes**
3. **2 dias antes**
4. **1 dia antes**
5. **No dia**
6. **Vencido 1 dia após** o vencimento
7. **Cobrança manual** (botão WhatsApp na parcela)
8. **Boas-vindas** (ao cadastrar cobrança, se a opção estiver marcada)

- Os **dias são fixos**. Editável: conteúdo por canal, horário e ativar/desativar **cada canal** independentemente.

## 2. Dois canais
- **WhatsApp** (Baileys): texto. Ritmo anti-ban (ver skill `baileys-conexao`): intervalo 45–80s, janela 09–20h, fila um-a-um.
- **E-mail** (Resend, domínio compartilhado do operador): assunto + corpo, com **link de unsubscribe** no rodapé. Janela 09–20h, sem o intervalo longo do WhatsApp (respeita rate limit do Resend). Remetente = `local_part` da conta + domínio do operador.
- Um mesmo tipo pode disparar **nos dois canais**; cada canal tem registro de envio próprio.

## 3. Variáveis (substituídas no envio — valem para os dois canais)
- `#VALOR#` → valor da parcela.
- `#NOMECOMPLETO#` → nome + sobrenome do cliente.
- `#NOME#` → só o primeiro nome.
- `#PIX#` → mensagem do meio de pagamento marcado como **padrão** (`is_padrao`).
- `#SAUDACAO#` → uma das variações cadastradas, em **rodízio aleatório a cada envio**.
- `#VENCIMENTO#` → data de vencimento da parcela cobrada.

## 4. Idempotência (CRÍTICO)
- Constraint: **`unique (parcela_id, tipo, canal)`** em `notificacoes_enviadas`.
- O scheduler, ao detectar uma janela atingida, tenta criar o registro; se já existe (mesma parcela + tipo + canal), **não duplica**. Isso protege contra cron rodando repetido.
- Nunca disparar o mesmo lembrete duas vezes no mesmo canal.

## 5. Ciclo de vida do disparo
1. **Scheduler** varre parcelas, calcula janelas (D-5, D-3, D-2, D-1, D0, D+1) por conta.
2. Para cada janela atingida e **canal ativo** do tipo, cria registro `status = fila` (respeitando idempotência).
3. **Worker WhatsApp** consome a fila por conta: janela 09–20h, intervalo 45–80s, um-a-um; substitui variáveis; envia; atualiza status pelo ack (enviado/entregue/lido/falhou).
4. **Worker E-mail** consome a fila: janela 09–20h + rate limit Resend; substitui variáveis; envia com unsubscribe; atualiza status pelos eventos do Resend (enviado/entregue/aberto/falhou).
5. **Overflow:** o que não couber até 20h continua no dia seguinte às 09h.

## 6. Regras de disparo
- Lembretes automáticos só existem porque a parcela é gerada **por data** (ver skill `regras-financeiras` §2.2). Sem isso, não há alvo.
- **Parcela paga antes do vencimento → cancela os lembretes futuros dela em AMBOS os canais** (status `fila` → cancelado).
- **"Vencido 1 dia após"** só dispara se a parcela continuar em aberto.
- **Boas-vindas** dispara conforme a opção marcada no cadastro da cobrança — **não** automaticamente em toda cobrança (evita 3 boas-vindas para cliente com 3 cobranças).
- **Cobrança manual** é disparada sob demanda pelo botão na parcela (não agendada).

## 7. Log e retenção
- Cada envio registrado com **canal + status**. Filtro por cliente, canal e data.
- Registros de `notificacoes_enviadas` **apagados automaticamente após 10 dias**.

## 8. Antipadrões — NÃO fazer
- ❌ Idempotência só por `parcela+tipo` (tem que incluir `canal`).
- ❌ Disparar lembrete de parcela já paga.
- ❌ Boas-vindas automática em toda cobrança (é condicional à opção).
- ❌ Enviar fora da janela 09–20h.
- ❌ Descartar o que passou das 20h (vai pro dia seguinte).
- ❌ E-mail sem unsubscribe.
- ❌ Dias dos lembretes editáveis (são fixos).
