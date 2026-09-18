# Provisionamento e Ciclo de Vida da Conta

Ler ao criar/alterar: cadastro de conta, onboarding, suspensão por inadimplência, reativação, exclusão/offboarding, troca de dono.

## 1. Criação (provisionamento da conta zerada)

Tudo numa única transação (RPC/função no banco) — conta pela metade é fonte de bugs fantasma:

```
1. INSERT contas (id uuid, numero serial exibível, nome, plano, status='ativa', criado_em)
2. INSERT usuarios (dono) vinculado à conta, papel 'dono'
3. INSERT configuracoes (1 linha, defaults de fábrica):
   janela de envio 09:00–20:00 · intervalos aleatórios padrão ·
   limite diário conservador · timezone America/Sao_Paulo · canais ativos
4. INSERT templates: CÓPIA dos templates-modelo do sistema para a conta
   (lembrete pré-vencimento, dia do vencimento, pós-vencimento)
5. INSERT logs_auditoria: 'conta_criada'
```

Falhou qualquer passo → rollback total; o cadastro reporta erro e pode tentar de novo. NUNCA conta sem configurações ("undefined" espalhado) nem configurações sem conta (órfãs).

**Estado inicial garantido:** `clientes`, `cobrancas`, `notificacoes_enviadas`, `agendamentos` e demais tabelas de negócio = **0 linhas**. Instância WhatsApp = nenhuma (conectar é passo 1 do onboarding). O teste de provisionamento afirma exatamente esta tabela de contagens.

**Defaults são cópia, não referência:** se um default de fábrica mudar no futuro, muda para contas NOVAS; contas existentes mantêm o que têm (mudar retroativamente configuração de cliente sem consentimento é quebra de confiança). Migração retroativa, se necessária, é decisão explícita e comunicada.

## 2. Suspensão (inadimplência do SaaS via Mercado Pago)

Suspender ≠ apagar. Status da conta: `ativa → suspensa`.

- **Para imediatamente:** novos disparos (o scheduler ignora contas suspensas), criação de cobranças, importações.
- **Continua funcionando:** login, leitura de todos os dados, exportação — o cliente nunca fica refém dos próprios dados (isso também é LGPD na prática).
- Jobs já na fila da conta suspensa: cancelados ou pausados com status claro, nunca processados "porque já estavam lá".
- Banner persistente na conta: "Assinatura pendente — regularize para retomar os envios" + link de pagamento.
- Auditoria: `conta_suspensa` (motivo: pagamento) / `conta_reativada`.

## 3. Reativação

- Webhook de pagamento confirmado (validado — ver seguranca-cobranx) → `status='ativa'`, envios voltam a partir da PRÓXIMA janela (não rajada imediata dos atrasados — risco de ban e de constrangimento ao devedor).
- Notificações que venceram durante a suspensão: reagendadas pela régua, não disparadas em lote.

## 4. Exclusão / offboarding (processo, nunca um DELETE solto)

Ordem obrigatória:

```
1. Confirmação forte: dono autenticado + 2FA (se ativo) + digitar o nome da conta
2. Oferecer exportação dos dados (CSV de clientes e cobranças) ANTES
3. Desconectar instâncias WhatsApp e APAGAR sessões Baileys do disco (Vortexus)
4. Cancelar assinatura no Mercado Pago (via API)
5. Cancelar todos os jobs da conta na fila
6. Marcar conta status='excluida' (soft) + agendar expurgo físico em 30 dias
7. Durante os 30 dias: login bloqueado, dados intactos (janela de arrependimento)
8. Expurgo (job): apagar dados de negócio na ordem reversa das FKs;
   anonimizar logs_auditoria e histórico contábil (manter trilha sem dados pessoais)
9. Auditoria: 'conta_excluida' e 'conta_expurgada'
```

Pedido LGPD explícito de eliminação imediata → pular a janela de 30 dias, registrar o pedido.

## 5. Troca de dono

- Fluxo com confirmação nas DUAS pontas (dono atual autoriza; novo dono aceita por e-mail verificado).
- Sessões do dono anterior revogadas ao concluir; auditoria `dono_alterado`.

## 6. Números e identidade da conta

- `id` interno: UUID (usado em FKs, URLs e API).
- `numero`: sequencial amigável para suporte ("conta nº 5") — exibido só para o próprio dono e para o admin; nunca em contexto público.
- Nome/slug da conta não é único global visível (evitar "esse nome já existe" revelando clientes da plataforma); unicidade, se necessária, valida sem confirmar existência ("não disponível").
