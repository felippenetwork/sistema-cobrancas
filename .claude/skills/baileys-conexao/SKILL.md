---
name: baileys-conexao
description: Regras de conexão WhatsApp via Baileys e proteção anti-ban deste projeto. Use SEMPRE que mexer na conexão WhatsApp, pareamento/QR, sessão Baileys, envio de mensagem por WhatsApp, ou no ritmo/fila de disparo. Define isolamento de sessão por conta, ritmo de envio e o que NÃO fazer para reduzir risco de banimento. Consulte antes de escrever qualquer código que conecte ou envie pelo WhatsApp.
---

# Baileys — Conexão WhatsApp e Anti-Ban

> Baileys é WhatsApp **não-oficial**. Risco de ban é real e, neste produto, o ban derruba a conexão inteira do cliente (ele perde o canal de cobrança). Estas regras existem para minimizar isso. Tratar com a mesma seriedade das regras financeiras.

## 1. Modelo de conexão
- **1 conta (tenant) = 1 socket Baileys = 1 número.** Nunca compartilhar socket entre contas.
- Socket roda no **worker (VPS Vortexus)**, nunca no front nem em serverless.
- Sessão (credenciais Baileys) **persistida por conta**, de forma segura e isolada (`conta_id`), nunca exposta ao navegador. Restaurar a sessão ao reiniciar o worker (não pedir QR de novo sem necessidade).

## 2. Tela de Conexão (o que expor)
- **QR Code** para parear.
- **Status:** conectado / desconectado / conectando.
- **Número conectado** e **nome do dispositivo** visíveis.
- Botão **desconectar** e botão **reiniciar conexão** (gera novo QR sem mexer no servidor).
- **Reconexão automática** se a conexão cair.

## 3. Anti-ban (ritmo de envio — obrigatório)
- **Intervalo entre disparos: 45–80 segundos**, aleatório dentro da faixa (não fixo, não menor). Configurável por conta, mas a faixa default é essa.
- **Janela de envio: 09:00–20:00** (fuso America/Sao_Paulo). Fora disso não dispara.
- **Fila um-a-um.** Nunca enviar em lote/paralelo no mesmo número.
- **Overflow:** o que não couber até as 20h continua **no dia seguinte às 09h** (não descarta, não acelera).
- Mensagem é **texto** no MVP.
- **Sem trava de conversa prévia no sistema** (decisão do operador): o sistema NÃO bloqueia envio para número sem conversa. A boa prática de só cadastrar quem já tem conversa é responsabilidade do dono da conta. NÃO implementar bloqueio por ausência de conversa.

## 4. Alerta de queda
- Conexão caída → **badge vermelho fixo na Dashboard** ("WhatsApp desconectado") **+ e-mail** ao dono da conta.
- Objetivo: o cliente não descobrir tarde demais que os lembretes pararam.

## 5. Status de entrega (ack) → Log
- Capturar o ack do Baileys e registrar no Log: **enviado / entregue / lido / falhou**.
- Atualizar o registro de `notificacoes_enviadas` conforme o ack chega.

## 6. Robustez
- Tratar desconexões (logout, conflito de sessão, número banido) sem derrubar o worker inteiro nem afetar outras contas.
- Reinício do worker restaura sessões existentes.
- Logar erros de conexão para diagnóstico (sem vazar credenciais).

## 7. Antipadrões — NÃO fazer
- ❌ Intervalo de disparo menor que 45s ou fixo.
- ❌ Enviar fora da janela 09–20h.
- ❌ Disparo em lote/paralelo no mesmo número.
- ❌ Sessão Baileys exposta ao client ou compartilhada entre contas.
- ❌ Socket Baileys em serverless/Vercel (tem que ser no worker do VPS).
- ❌ Pedir QR de novo quando a sessão persistida ainda é válida.
- ❌ Uma conta com problema derrubar o worker das outras.
