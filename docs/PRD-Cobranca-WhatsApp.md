# PRD — Sistema de Cobrança Automática via WhatsApp (SaaS)

> **Documento de Requisitos de Produto (Product Requirements Document)**
> Versão 1.0 — base para implementação via Claude Code.
> Projeto **standalone**: não reutiliza código, banco, credenciais ou infraestrutura de nenhum outro projeto (ZapBlast, Lotero, bvc_hub etc.). `.env`, repositório e Supabase **próprios e isolados**.

---

## 0. POSTURA DE EXECUÇÃO (regra inegociável — vale para todo o build)

Toda decisão de código, schema e arquitetura deste projeto deve ser tomada como um **arquiteto de software sênior com 20 anos de experiência em sistemas financeiros e SaaS multi-tenant**:

- **Não validar decisão por gentileza.** Se algo está errado, frágil ou ambíguo, apontar e recusar.
- **Não escrever código com regra de negócio ambígua.** Parar e perguntar antes.
- **Apontar risco, gargalo e dívida técnica** em cada etapa.
- **Recusar atalho** que comprometa integridade financeira ou isolamento de dados.
- **Dinheiro e isolamento entre contas são sagrados.** Nenhuma query pode vazar dado entre tenants. Nenhum cálculo financeiro pode ter ambiguidade.
- Sem frases motivacionais, sem "ficou ótimo", sem suposição implícita não documentada.

---

## 1. VISÃO E MODELO DE NEGÓCIO

Plataforma SaaS de **gestão e cobrança recorrente via WhatsApp e e-mail**, vendida por assinatura mensal a terceiros (donos de negócio que precisam cobrar mensalidades dos clientes deles).

**Dois canais de notificação (MVP):**
- **WhatsApp** via Baileys (1 socket por conta).
- **E-mail** via **Resend**, usando **um subdomínio de cobrança do operador** (ex.: `cobranca.suaplataforma.com.br`), autenticado uma única vez (SPF/DKIM/DMARC). **Cada cliente define apenas o `local_part`** (o nome antes do @) em Configurações; o sistema monta o remetente (ex.: `acougue-do-ze@cobranca.suaplataforma.com.br`). Reputação **compartilhada** entre clientes (ver risco §12).
  - **Gancho futuro (fora do MVP):** permitir que um cliente "suba de nível" e autentique o **domínio próprio** dele, isolando a reputação. A modelagem já reserva espaço para isso.
Cada notificação pode sair por WhatsApp, e-mail, ou ambos, conforme configuração da conta.

**Dois fluxos de dinheiro, completamente separados (não confundir nunca):**

| Fluxo | Quem paga | Para quem | Como | Confirmação |
|---|---|---|---|---|
| **A — Assinatura do SaaS** | Cliente do SaaS (o "dono da conta") | Você (operador da plataforma) | Mercado Pago recorrente (automático) | Webhook do Mercado Pago renova a validade da conta |
| **B — Cobranças do cliente** | Devedores do dono da conta | Dono da conta (direto, fora da plataforma) | Pix por texto no WhatsApp | **Baixa 100% manual** pelo dono da conta. Sem gateway. Sem conciliação bancária. |

**Consequência crítica documentada:** os indicadores financeiros (Recebidos, Pagas etc.) refletem **o que o usuário marcou como pago**, não pagamento real confirmado. Isso é intencional e idêntico ao modelo do concorrente de referência.

**Provisionamento:** **não há cadastro self-service.** Somente o Admin (você) cria contas, via Painel Admin. O cliente paga → você (ou o Mercado Pago, via webhook) provisiona/renova.

---

## 2. PAPÉIS

- **Admin (plataforma):** você. Cria/edita/suspende contas, define validade e limite de clientes, acessa contas via impersonação (auditada), vê assinaturas Mercado Pago.
- **Dono da conta (tenant):** 1 pessoa = 1 empresa = 1 conta = 1 conexão WhatsApp. Acessa só os próprios dados.

---

## 3. ARQUITETURA E ISOLAMENTO

### 3.1 Stack
- **Frontend/App:** Next.js 15 (App Router) hospedado na Vercel.
- **Banco/Auth/Storage:** Supabase (Postgres + Supabase Auth + Storage).
- **Worker:** Node.js no VPS Vortexus, rodando:
  - **Baileys** (1 socket por conta conectada).
  - **Fila de disparo** (BullMQ + Redis).
  - **Scheduler/cron** de geração de parcelas recorrentes e enfileiramento de notificações.
- **Pagamento (assinatura SaaS):** Mercado Pago (Preapproval / assinatura recorrente) + webhook.

### 3.2 Isolamento multi-tenant (decisão fechada)
- **Banco único**, não banco físico por cliente.
- Toda tabela de dados de negócio carrega **`conta_id`** (= tenant).
- **Row Level Security (RLS) obrigatório em TODAS as tabelas.** Política padrão: `conta_id = auth.uid()`-resolvido-para-conta. Nenhuma exceção. Tabela sem RLS = bug bloqueante.
- O backend/worker usa **service role** apenas no servidor, nunca exposto ao cliente.
- Admin acessa cross-tenant via política específica de role admin (não via service role no browser).

### 3.3 Segredos (lição registrada)
- Todas as chaves (Supabase service key, Mercado Pago, sessões Baileys) ficam em **`.env` no servidor**, nunca no client bundle.
- Chaves `NEXT_PUBLIC_*` somente para o que é seguro expor (anon key).
- Sessões Baileys persistidas de forma cifrada/segura (ver §10).
- **Proibido** commitar `.env`. `.gitignore` desde o commit 1.

---

## 4. MODELO DE DADOS (schema lógico)

> Todas as tabelas de negócio têm `conta_id uuid not null` + RLS. Timestamps `created_at`, `updated_at` em todas.

**`contas`** (tenant)
`id`, `owner_user_id` (FK auth.users), `nome_empresa`, `status` (ativa | suspensa | expirada), `validade_plano` (date), `limite_clientes` (int), `created_at`.

**`assinaturas`** (motor SaaS — fluxo A)
`id`, `conta_id`, `mp_preapproval_id`, `status` (ativa | pendente | cancelada | inadimplente), `valor`, `proximo_vencimento`, `ultimo_evento_mp`, `created_at`.

**`configuracoes`** (1 por conta)
`conta_id`, `nome_comercial`, `cpf_cnpj`, `endereco`, `contato`, `horario_inicio` (default 09:00), `horario_fim` (default 20:00), `intervalo_min_seg` (default 45), `intervalo_max_seg` (default 80).

**`email_remetente`** (configuração de envio por conta)
`id`, `conta_id`, `local_part` (o que vem antes do @, **sanitizado e único** dentro do domínio compartilhado), `from_name` (nome de exibição), `modo` (compartilhado | proprio), `created_at`.
- **MVP — modo `compartilhado` (default):** o domínio é o subdomínio único do operador (config global da plataforma, não da conta). O remetente final = `{local_part}@{dominio_operador}`.
- **Gancho futuro — modo `proprio`:** campos reservados `dominio_proprio`, `resend_domain_id`, `status_dominio` (pendente | verificado | falha), `registros_dns` (jsonb). Não implementar no MVP; só deixar o schema preparado.
- **Validações do `local_part`:** somente `[a-z0-9.-]` (minúsculas), sem espaço/acento/caractere especial — sistema normaliza automaticamente; **único por conta dentro do domínio compartilhado** (rejeita duplicado).

**Config global da plataforma** (não-tenant; tabela `plataforma_config` ou variável de ambiente): `dominio_email_operador` (ex.: `cobranca.suaplataforma.com.br`), autenticado uma vez no Resend.

**`saudacoes`** (variações do #SAUDACAO#)
`id`, `conta_id`, `texto`. (Seed inicial com 10 variações — ver §8.4.)

**`meios_pagamento`** (menu Tipo de Pagamento)
`id`, `conta_id`, `tipo` (pix | outro), `nome`, `mensagem` (texto da chave/instrução Pix), `is_padrao` (bool). **`#PIX#` usa o registro com `is_padrao = true`.**

**`clientes`**
`id`, `conta_id`, `nome`, `sobrenome`, `celular` (normalizado 55+DDD+nº), `cpf` (**único por conta**, com dígito verificador validado), `email`, `deleted_at` (soft delete — histórico preservado), `created_at`.

**`cobrancas`** (contrato-pai)
`id`, `conta_id`, `cliente_id`, `valor_mensalidade`, `qtd_parcelas` (ignorado se recorrente), `recorrente` (bool), `dia_pagamento` (1–31), `data_primeiro_pagamento`, `observacao`, `enviar_boas_vindas` (bool), `status` (ativa | concluida | cancelada), `created_at`.

**`parcelas`** (mensalidades)
`id`, `conta_id`, `cobranca_id`, `numero`, `valor` (override editável), `data_vencimento`, `status` (aberta | paga | vencida), `data_pagamento`, `observacao`, `created_at`.

**`notificacoes_config`** (8 tipos fixos por conta, com conteúdo por canal)
`id`, `conta_id`, `tipo` (5d | 3d | 2d | 1d | dia | vencido1d | manual | boasvindas), `horario` (editável),
canal WhatsApp: `ativo_whatsapp` (bool), `template_whatsapp` (texto);
canal e-mail: `ativo_email` (bool), `assunto_email`, `template_email` (HTML/texto).
**Os dias são fixos e não editáveis. Editável: horário, conteúdo de cada canal, e ativar/desativar cada canal independentemente.** Cada tipo pode disparar por WhatsApp, e-mail ou ambos.

**`notificacoes_enviadas`** (idempotência + base do Log)
`id`, `conta_id`, `parcela_id` (nullable p/ boas-vindas/manual), `cliente_id`, `tipo`, `canal` (whatsapp | email), `mensagem_final`, `status` (fila | enviado | entregue | lido | aberto | falhou), `agendado_para`, `enviado_em`, `created_at`.
**Constraint de idempotência:** `unique (parcela_id, tipo, canal)` — impede disparo duplicado do mesmo tipo no mesmo canal.
**Retenção:** registros apagados automaticamente após **10 dias**.

**`conexoes`** (Baileys — 1 por conta)
`id`, `conta_id`, `status` (conectado | desconectado | conectando), `numero_conectado`, `device_name`, `session_ref`, `ultima_conexao`.

**`lancamentos`** (caixa — Dashboard Entradas/Saídas)
`id`, `conta_id`, `tipo` (entrada | saida), `origem` (parcela | manual), `parcela_id` (nullable), `valor`, `data`, `descricao`.
**Regra:** dar baixa numa parcela cria automaticamente um `lancamento` tipo `entrada` origem `parcela`. Saídas são lançadas manualmente.

**`audit_log`** (rastreabilidade)
`id`, `actor` (admin | conta), `actor_id`, `acao`, `conta_id_alvo`, `detalhe`, `created_at`. **Toda impersonação é registrada aqui.**

---

## 5. REGRAS DE GERAÇÃO DE PARCELAS (núcleo financeiro)

### 5.1 Cobrança com nº fixo de parcelas
- Ex.: 3 parcelas → gera exatamente **3 parcelas** nos meses à frente.
- Vencimento de cada parcela = **dia fixo** (`dia_pagamento`) do respectivo mês.
- **Dia inexistente no mês** (ex.: 31 em fevereiro) → joga para o **último dia do mês**.
- Quando todas as parcelas estiverem pagas → `cobranca.status = concluida`.

### 5.2 Cobrança recorrente (checkbox "Recorrente")
- `qtd_parcelas` é **ignorado** (recorrência é infinita até cancelar).
- **Geração POR DATA, não por pagamento.** O sistema mantém **sempre 1 parcela em aberto à frente**, gerada antecipadamente pelo scheduler.
  - **Motivo (crítico):** se a próxima parcela só nascesse no momento do pagamento, os lembretes "5/3/2/1 dia antes" do próximo ciclo **nunca disparariam** para quem paga atrasado, no dia, ou não paga. Gerar por data garante que o lembrete sempre tenha alvo.
- Regra de geração: ao entrar na janela de antecedência (ou na virada do ciclo), o scheduler cria a parcela do próximo vencimento se ainda não existir.
- Cancelar a recorrente interrompe a geração futura; parcelas já abertas permanecem até serem tratadas.

### 5.3 Baixa de parcela ("pago")
- **Regra única, dois pontos de entrada idênticos:** botão "pago" no card do menu Cobranças **e** botão calendário dentro da cobrança do cliente fazem **exatamente a mesma coisa**.
- Efeitos da baixa:
  1. `parcela.status = paga`, `data_pagamento = hoje`.
  2. Cria `lancamento` entrada (alimenta Dashboard).
  3. **Cancela todas as notificações pendentes (status `fila`) daquela parcela** (não faz sentido lembrar de algo já pago).
  4. Se recorrente: dispara verificação de geração da próxima parcela (mantendo 1 à frente).

### 5.4 Status visual do cliente (card de cobrança)
- Baseado na(s) parcela(s) **mais próxima(s)** em aberto.
- Estados: **Em dia** | **Vence hoje** | **Vencido**.
- Se houver simultaneamente 1 vencida e 1 perto de vencer → **mostrar as duas** (não esconder uma).

---

## 6. MENUS / TELAS

### 6.1 Login
- Supabase Auth (e-mail + senha).
- **Esqueci minha senha** (reset por e-mail).
- **Verificação de e-mail** no cadastro (feito pelo Admin).
- Ao logar: validar `conta.status` e `validade_plano`. Se expirada/suspensa → bloquear com tela de "plano expirado / renovar".

### 6.2 Dashboard
Abre sempre no **mês corrente**, com seletor de mês no topo + botão Filtrar (espelha as fotos enviadas).
- **Saldo do Mês** = Recebidos − Saídas.
- **Recebidos no Mês** (entradas: parcelas pagas no mês + entradas manuais).
- **Saídas no Mês** (lançamentos manuais).
- Bloco de indicadores: **CLIENTES** (total cadastrados), **COBRANÇAS ATIVAS** (contratos com ≥1 parcela em aberto), **EM ABERTO** (parcelas não pagas do mês), **PAGAS** (parcelas pagas no mês).
- **Badge de status da conexão** (ex.: "API Desconectada" em destaque) — ver §6.8.
- Atalhos: Cadastrar Clientes, Contas a Receber, Entradas e Saídas.

### 6.3 Clientes
- Lista + cadastro. Campos **obrigatórios:** nome, sobrenome, celular, CPF, e-mail.
- **CPF:** valida dígito verificador; **único por conta** (não duplica).
- **Celular:** normaliza para 55+DDD+número; **rejeita inválido**.
- **E-mail:** obrigatório (usado como canal de cobrança por e-mail, ver §6.5 e §6.7-B).
- Exclusão = **soft delete**: some da lista, **histórico financeiro permanece registrado no registro do cliente**.
- Um cliente pode ter **várias cobranças ativas**.

### 6.4 Cobranças
Indicadores do topo (sempre mês selecionado, abre no atual):
**Valores Recebidos** · **Valores a Receber** · **Clientes Cadastrados** · **Cobranças Ativas** · **Mensalidades em Aberto** · **Mensalidades Pagas**.
- Definições: "Cobrança ativa" = contrato com ≥1 parcela em aberto. "Mensalidade em aberto" = parcela não paga. (Confirmado.)

**Cadastrar cobrança (foto 1):**
- Selecione o cliente (dropdown com todos os clientes cadastrados).
- Valor da mensalidade.
- **Quantidade de parcelas** (renomeado de "quantidade de mensalidades").
- **Dia do pagamento** (dia fixo do mês).
- Checkbox **[ ] Recorrente**.
- Observação.
- **Opção [ ] Enviar notificação de boas-vindas** (sim/não) — controla se a mensagem de boas-vindas dispara ao cadastrar.

**Card da cobrança (foto 2):** valor, tempo a vencer, celular, data de vencimento, status (em dia / vence hoje / vencido).
- Botões: **pago** (baixa do mês — §5.3), **lupa** (abre detalhe — foto 3).

**Detalhe da cobrança (foto 3):** lista de parcelas (#id, vencimento, pago em, valor, status como "PAGA" / "VENCIDA Xd").
- Botões por parcela: **lápis** (alterar vencimento, valor da parcela e observação), **calendário** (baixa — idêntico ao "pago"), **WhatsApp** (envia cobrança manual ao cliente).

### 6.5 Notificação
8 tipos **fixos** (dias não editáveis). Cada tipo tem conteúdo **por canal** (WhatsApp e e-mail) e pode ser ativado/desativado por canal de forma independente. Botões por tipo: **Editar** (edita horário + conteúdo de cada canal) e **Ativar/Desativar** (por canal).
1. 5 dias antes
2. 3 dias antes
3. 2 dias antes
4. 1 dia antes
5. No dia
6. Vencido 1 dia após o vencimento
7. Cobrança manual (disparada pelo botão WhatsApp na parcela)
8. Boas-vindas (ao cadastrar cobrança, se a opção estiver marcada)

**Canais:**
- **WhatsApp:** texto. Respeita janela 09–20h, intervalo 45–80s, fila um-a-um.
- **E-mail (Resend):** assunto + corpo, enviado do domínio verificado da conta (§6.7-B), com **link de descadastro (unsubscribe)** no rodapé. Respeita a janela 09–20h; sem o intervalo longo do WhatsApp (e-mail não tem risco de ban), apenas o rate limit do provedor.
- Um mesmo tipo pode disparar nos dois canais; cada canal tem registro próprio de envio (idempotência por `parcela_id + tipo + canal`).

**Regras de disparo:**
- Lembretes automáticos só existem porque a parcela é gerada por data (ver §5.2).
- **Parcela paga antes do vencimento → lembretes futuros dela são cancelados** automaticamente, **em ambos os canais**.
- "Vencido 1 dia após" só dispara se a parcela continuar em aberto.
- **Boas-vindas:** dispara conforme a opção marcada no cadastro da cobrança (não automaticamente sempre). Resolve o caso "cliente com 3 cobranças não recebe 3 boas-vindas indesejadas".

**Variáveis (substituídas no envio, valem para os dois canais):**
- `#VALOR#` → valor da parcela.
- `#NOMECOMPLETO#` → nome + sobrenome.
- `#NOME#` → só o primeiro nome.
- `#PIX#` → mensagem do meio de pagamento marcado como **padrão** (Pix copia-e-cola natural no e-mail).
- `#SAUDACAO#` → uma das variações, **em rodízio aleatório a cada envio**.
- `#VENCIMENTO#` → data de vencimento da parcela cobrada.

### 6.6 Tipo de Pagamento
- MVP: cadastrar **somente Pix** (mensagem/chave). Demais formas (Mercado Pago, PagBank etc. das fotos) ficam para depois.
- Conceito de **Pix padrão** (`is_padrao`) — é o que alimenta `#PIX#`.

### 6.7 Conexão WhatsApp (Baileys)
- **QR Code** na tela para parear.
- **Status** (conectado / desconectado / conectando), **número conectado**, **nome do dispositivo**.
- **Botão desconectar** e **botão reiniciar conexão** (gera novo QR sem mexer no servidor).
- **Reconexão automática** se cair.
- **Configurações anti-ban:**
  - Intervalo entre disparos **45–80 segundos** (configurável; default desse range).
  - Janela de envio **09:00–20:00**.
  - Fila um-a-um, nunca em lote.
- **Sem trava de conversa prévia no sistema** (decisão do operador): o sistema **não bloqueia** envio para número sem conversa. A boa prática de só cadastrar quem já tem conversa é **responsabilidade do dono da conta** no momento do cadastro do cliente. Risco residual registrado em §12.

### 6.7-B Remetente de E-mail (Resend — domínio compartilhado do operador)
- O **domínio de cobrança é do operador** (subdomínio dedicado), autenticado **uma única vez** no Resend. O cliente **não mexe em DNS**.
- Em **Configurações**, o cliente define apenas o **`local_part`** (nome antes do @) e o **nome de exibição** (`from_name`).
- Validação: `local_part` sanitizado (`[a-z0-9.-]`, sem acento/espaço) e **único** no domínio compartilhado. Remetente final montado pelo sistema.
- **Sem etapa de verificação por cliente** (o domínio já está verificado globalmente). O canal e-mail fica disponível assim que o `local_part` é definido.
- **Gancho futuro:** modo `proprio` (cliente autentica domínio dele) reaproveita a verificação DNS — não implementar no MVP.

### 6.8 Alertas de canal indisponível (decisão fechada)
- **WhatsApp caído** → badge vermelho fixo na Dashboard ("API Desconectada") **+ e-mail** ao dono da conta.
- **E-mail:** como o domínio é único e já verificado, não há bloqueio por verificação de cliente. Alerta de e-mail só em caso de **falha global** (domínio do operador com problema no Resend / reputação) → aviso ao operador (você), não ao cliente.
- Evita notificações pararem em silêncio em qualquer um dos canais.

### 6.9 Log
- Cada mensagem enviada, **com canal e status**:
  - WhatsApp (ack Baileys): **enviado / entregue / lido / falhou**.
  - E-mail (eventos Resend): **enviado / entregue / aberto / falhou**.
- **Filtro por cliente, por canal e por data.**
- **Apaga automaticamente após 10 dias.**

### 6.10 Configurações
- Dados da empresa: nome comercial, CPF/CNPJ, endereço, contato (espelha foto).
- **Remetente de e-mail:** define o `local_part` (nome antes do @) e o nome de exibição — ver §6.7-B.

### 6.11 Sair
- Botão no fim do menu lateral → **modal de confirmação** → logout (encerra sessão Supabase).

---

## 7. PAINEL ADMIN (somente você)

- **Criar conta:** define dono (e-mail), nome da empresa, validade do plano, limite de clientes.
- **Editar / suspender / expirar conta.**
- **Renovar validade** manualmente (fallback).
- **Visão de assinaturas Mercado Pago:** status, próximo vencimento, inadimplência.
- **Impersonação:** acessar a conta de um cliente para suporte. **Toda impersonação registrada no `audit_log`** (quem, qual conta, quando).
- **Limites:** bloquear cadastro de cliente quando atingir `limite_clientes`.

---

## 8. MOTOR DE NOTIFICAÇÃO (fila e scheduler)

### 8.1 Geração/enfileiramento
- Scheduler varre parcelas e calcula janelas (D-5, D-3, D-2, D-1, D0, D+1) por conta.
- Para cada janela atingida, e para **cada canal ativo** do tipo correspondente (`ativo_whatsapp` / `ativo_email`), cria registro em `notificacoes_enviadas` com `status = fila`, respeitando a **idempotência** (`unique parcela_id+tipo+canal`).

### 8.2 Consumo (workers)
- **Worker WhatsApp (BullMQ):** por conta, janela **09:00–20:00**, intervalo **45–80s**, **um a um**. Atualiza status pelo ack do Baileys.
- **Worker E-mail (Resend):** janela 09:00–20:00, respeita rate limit do provedor (sem o intervalo longo do WhatsApp). Envia do **domínio compartilhado do operador** com o `local_part` da conta. Atualiza status pelos eventos/webhook do Resend (entregue/aberto/falhou). Inclui link de unsubscribe.
- Antes de enviar (ambos): substitui as variáveis.
- **Overflow:** o que não couber até as 20h **continua no dia seguinte às 09h** (não é descartado).

### 8.3 Cancelamento
- Baixa de parcela → cancela itens `fila` daquela parcela **em ambos os canais**.

### 8.4 Seed de saudações (#SAUDACAO#)
1. Olá, tudo bem?
2. Oi, tudo bem com você?
3. Olá! Espero que esteja tudo bem por aí.
4. Oi, tudo certo por aí?
5. Olá, como vai você?
6. Oi! Tudo tranquilo?
7. Olá, tudo bem por aí?
8. Oi, espero que esteja tudo ótimo!
9. Olá! Tudo bem contigo?
10. Oi, como você está?

---

## 9. MERCADO PAGO (assinatura do SaaS — fluxo A)

- **Preapproval (assinatura recorrente):** cobra mensalmente o dono da conta.
- **Webhook:** ao confirmar pagamento → estende `validade_plano` e mantém `conta.status = ativa`. Falha/cancelamento → marca inadimplente/suspende conforme política.
- **Provisionamento:** continua sendo o Admin quem cria a conta; o Mercado Pago renova automaticamente. (Não há checkout self-service de novos cadastros no MVP.)
- **Segurança:** validar assinatura/origem do webhook; idempotência por evento.

---

## 10. NÃO-FUNCIONAIS

- **Escala alvo MVP:** múltiplas contas, **~100 clientes por conta**. Fila e Baileys dimensionados para isso no Vortexus (1 socket por conta ativa + 1 worker de fila por conta/global com chave por conta).
- **Sessões Baileys:** persistidas de forma segura e isoladas por `conta_id`; nunca expostas ao client.
- **RLS:** auditar que toda tabela tem política. Teste automatizado: tentar ler dado de outra conta deve falhar.
- **E-mail (Resend):** chave de API no servidor (`.env`). **Um subdomínio do operador autenticado uma vez** (config global). Remetente por conta = `local_part` + domínio compartilhado. Webhook do Resend para status. Monitorar reputação/volume do domínio compartilhado (limite do plano Resend).
- **Backups:** Supabase com backup ativo.
- **Observabilidade:** logs de erro do worker e dos webhooks.

---

## 11. FORA DE ESCOPO (MVP)
- Envio de Pix como **QR Code imagem** (no MVP, Pix é texto / copia-e-cola; vale para WhatsApp e e-mail).
- Demais meios de pagamento além de Pix no menu Tipo de Pagamento.
- Conciliação bancária automática das cobranças do cliente (baixa é manual).
- Sub-usuários por conta (1 pessoa por login).
- Cadastro self-service de novos clientes do SaaS.

---

## 12. RISCOS REGISTRADOS
1. **Ban do WhatsApp (Baileys):** mitigado por intervalo 45–80s, janela 09–20h, fila um-a-um. **Não há trava de conversa prévia no sistema** (decisão do operador): cabe ao dono da conta só cadastrar quem já tem conversa. Risco residual permanece — comunicar ao cliente.
2. **Reputação de e-mail COMPARTILHADA (atenção):** todos os clientes enviam do mesmo domínio do operador. **Um cliente que dispare para base ruim e leve denúncias derruba a entregabilidade de TODOS.** Mitigações obrigatórias: subdomínio dedicado só a cobrança (isolado do e-mail crítico da operação), unsubscribe em todo e-mail, e monitorar reputação/bounce no Resend. Cliente abusivo deve poder ser suspenso rápido. Para clientes de volume maior, migrar para o modo `domínio próprio` (gancho já previsto) e isolar a reputação.
3. **Baixa manual ≠ pagamento real:** indicadores não são conciliação financeira. Comunicar claramente na UI.
4. **Geração recorrente por pagamento (rejeitada):** se algum dev "otimizar" para gerar parcela só no pagamento, quebra os lembretes. **Não fazer.**
5. **Vazamento entre tenants:** qualquer query sem filtro de `conta_id`/RLS é incidente crítico.
