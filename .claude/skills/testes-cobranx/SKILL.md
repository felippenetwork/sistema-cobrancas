---
name: testes-cobranx
description: Estratégia e padrões de testes automatizados do Cobranx (Vitest + Playwright, sem worker) — autoridade para recusar corte de cobertura crítica sob pressão de prazo, prova de regressão real (vermelho antes/verde depois), verificação anti-flaky e teste de mutação na lógica mais crítica. Use SEMPRE que criar ou alterar testes, implementar lógica financeira/régua/agendamento (exige teste na mesma tarefa), corrigir bugs (regressão obrigatória) ou configurar CI. Testes protegem dinheiro: cálculo errado e mensagem para quem já pagou são os bugs mais caros do produto.
---

# Testes — Cobranx

## Princípio

Testar onde o erro custa caro, não onde é fácil. No Cobranx, erro caro é: **dinheiro calculado errado, mensagem enviada para quem já pagou, dado de uma conta aparecendo em outra, disparo fora da janela, e renovação LookDefense/baixa PIX duplicada.** Cobertura % é vaidade — a pergunta certa é "as regras que envolvem dinheiro e reputação têm prova automática?". Teste bom é o que falha quando a regra quebra; teste que nunca falha, mesmo com a lógica quebrada, é teatro de cobertura, não proteção.

**Autoridade sobre qualidade, não concordância automática.** Pedido para pular teste de lógica crítica "para acelerar o prazo" é avaliado tecnicamente: dizer o custo real (o que fica sem prova automática) e propor o mínimo viável que ainda protege — nunca cortar cobertura crítica sem alertar explicitamente o Felippe sobre o risco assumido.

## Pirâmide adaptada ao Cobranx

| Camada | Ferramenta | O que cobre | Quantidade |
|---|---|---|---|
| Unit | Vitest | Cálculo financeiro, datas da régua, máquina de estados, parsers/máscaras | Muitos (rápidos, sem I/O) |
| Integração | Vitest + banco de teste | Server actions com RLS real, provisionamento, isolamento | Os que provam contratos |
| Rota de cron | Vitest + Supabase de teste + uazapi/Meta MOCKADOS | Idempotência, janela, retry, vínculo instância→conta | Poucos e certeiros |
| E2E | Playwright | 3–5 fluxos vitais de ponta a ponta | Mínimo — caros e lentos |

> Não existe mais camada "worker" a testar separadamente — a lógica de disparo roda dentro das rotas de cron do Next (ver skill `whatsapp-uazapi`). `worker/src` é código morto; não escrever teste novo contra ele.

## Regras inegociáveis

1. **Regra do bug, com prova de verdade:** todo bug corrigido ganha, NA MESMA TAREFA, um teste rodado primeiro CONTRA O CÓDIGO AINDA QUEBRADO para confirmar que falha (vermelho real, não suposto) — só depois aplicar a correção e confirmar verde. Teste de regressão nunca visto falhando é aposta, não prova.
2. **Regra do dinheiro:** lógica financeira/crítica implementada ganha teste na mesma tarefa (par com a skill `regras-financeiras`).
3. **Datas sempre controladas** (`vi.setSystemTime`) — teste que depende do relógio real é flaky por construção. Testar explicitamente: virada de dia, virada de mês, dia 31→fevereiro, horário de fronteira da janela (08:59 / 09:00 / 20:00 / 20:01).
4. **Serviços externos SEMPRE mockados** por trás de uma interface: nenhum teste envia WhatsApp de verdade, cobra via Mercado Pago/EfiBank de verdade, ou chama LookDefense de verdade — isso é incidente, não teste.
5. **Dados falsos, nunca reais:** factories com dados brasileiros sintéticos (telefones inválidos de propósito, nomes genéricos); nenhum dado pessoal real em fixture.
6. **Permissões e isolamento testados de verdade:** testes de integração autenticam como usuário comum (client anon + sessão, RLS valendo) — testar com service role "para facilitar" anula o propósito. O teste de isolamento de tenant é o mais importante da suíte (skill `isolamento-de-contas`).
7. **Idempotência:** processar o mesmo evento duas vezes (job de notificação, webhook de PIX/Mercado Pago) = um efeito só.
8. **Anti-flaky antes de aceitar:** teste novo com async, timing ou concorrência roda isolado múltiplas vezes (mínimo 5x) antes de ser considerado estável.

## Quem testa o teste (mutação, só na lógica mais crítica)

Suíte verde não prova que a suíte protege — prova só que, hoje, nada quebrou. Para a lógica mais crítica (cálculo de dinheiro, máquina de estado de pagamento, isolamento de conta, idempotência de baixa PIX): ao criar o teste, quebrar deliberadamente a implementação (inverter uma condição, remover uma validação, trocar `<` por `<=`) e confirmar que o teste correspondente falha. Se não falhar, o teste testa a forma, não o comportamento — corrigir o assert antes de confiar nele.

## Obrigatórios (o contrato de qualidade do produto)

1. **Cálculo financeiro** (`calcularValorAtualizado`, `calcularVencimento`): multa aplicada 1x; juros pro-rata por dia; centavos exatos sem float; parcela com vencimento dia 31 → último dia de fevereiro; valores zero e negativos rejeitados. **Achado aberto (TST-C2): `calcularVencimento` ainda sem teste** — prioridade ao tocar essa função.
2. **Régua**: datas geradas corretas em America/Sao_Paulo (incluindo virada de dia/UTC); notificação fora da janela reagendada, nunca perdida; **baixa/cancelamento cancela TODAS as futuras na mesma transação** (o teste mais importante do produto).
3. **Máquina de estados**: transições inválidas rejeitadas (paga não volta a pendente; cancelada é final).
4. **Idempotência**: processar o mesmo evento de cron ou webhook 2x = 1 mensagem enviada, 1 baixa, 1 registro. **Achado aberto (RN-A1): baixa de parcela não é atômica** (6 operações sequenciais sem transação) — cobrir com teste que force falha no meio da sequência antes de considerar a RPC de baixa confiável.
5. **Isolamento de conta e provisionamento**: já especificados em `isolamento-de-contas` — rodam na mesma suíte. **Achado aberto (TST-A1): RLS testado só em `clientes` e `contas`** — expandir para `parcelas`, `lancamentos`, `notificacoes_enviadas` é prioridade alta, não opcional.
6. **Regra do bug (regressão):** todo bug corrigido ganha, na mesma tarefa, um teste que falharia antes da correção.

## Padrões de escrita

- Vitest, arquivos `*.test.ts` ao lado do código testado (unit) e em `tests/integration/`, `tests/e2e/` para os demais.
- Nome descritivo em PT no padrão comportamento: `it('cancela notificações futuras quando a cobrança é marcada como paga')` — o relatório de testes vira documentação das regras.
- Estrutura AAA (arrange, act, assert); um comportamento por teste; sem lógica condicional dentro do teste; assert específico (proibido `toBeTruthy()` em objeto ou snapshot como substituto de assert de comportamento).
- Dados por factory com dados brasileiros FALSOS — nunca dado real.

## Integração com banco (RLS de verdade)

- Rodar contra banco de TESTE (projeto Supabase de teste ou Postgres local com as migrations aplicadas) — nunca dev compartilhado, jamais produção.
- Testes de action autenticam como usuário de teste real (client anon + sessão) para o RLS valer.
- Cada teste cria seus dados e limpa no fim (ou transação com rollback); suíte roda em qualquer ordem.

## Rota de cron (sem WhatsApp real)

- uazapi e Meta Cloud API 100% mockados: interface de envio com implementação fake que registra chamadas. NENHUM teste dispara mensagem real.
- Cobrir: execução consome payload válido; registro sem `conta_id` válido falha imediato; instância de outra conta → aborta; falha de envio → retry com backoff → após esgotar, status `falhou` com motivo. **Achado aberto (TST-C5): nada disso está coberto hoje.**

## E2E (Playwright) — os fluxos vitais, e só eles

1. Login → dashboard carrega com dados da conta certa.
2. Criar cliente → criar cobrança com régua → agendamentos aparecem no detalhe.
3. Marcar cobrança como paga → status muda → notificações futuras somem.
4. Cancelar notificação agendada individual.
5. (Quando existir cadastro) Conta nova → onboarding → estado zerado.

Seletores por role/label (`getByRole('button', { name: 'Criar cobrança' })`) — casa com a acessibilidade da skill `design-system` e não quebra com refactor de CSS. **Achado aberto (TST-A2): Playwright ainda não está instalado** — nenhum E2E existe hoje.

## CI e disciplina

- Suíte unit+integração roda em todo PR (junto de tsc, gitleaks, npm audit — ver `codigo-cobranx → references/git-e-releases.md`); E2E ao menos no merge para a main.
- PR não mergeia com teste vermelho. Teste flaky é bug com prioridade: corrigir ou apagar conscientemente — flaky ignorado ensina a ignorar vermelho.
- PROIBIDO: `skip` sem issue/motivo escrito, asserts genéricos, snapshot de tela como substituto de assert de comportamento.
- Suíte verde é pré-requisito de entrada para a "Definição de concluído" da skill `sincronizacao-sistema`.

## Checklist ao encerrar tarefa com lógica de negócio

- [ ] Regra de dinheiro/régua implementada tem teste na mesma tarefa?
- [ ] Bug corrigido tem teste de regressão que foi visto falhando ANTES da correção?
- [ ] Datas testadas com relógio controlado (incluindo fronteiras)?
- [ ] Nenhum teste toca produção, dado real, WhatsApp real ou integração externa real (Mercado Pago/EfiBank/LookDefense)?
- [ ] Tabela nova entrou nos testes de isolamento e provisionamento?
- [ ] Lógica mais crítica tocada passou por quebra deliberada para confirmar que o teste pegaria?
- [ ] Suíte inteira verde localmente antes do commit?
