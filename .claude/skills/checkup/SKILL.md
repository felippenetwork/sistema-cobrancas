---
name: checkup
description: Meta-skill que roda uma auditoria completa do projeto atual contra TODAS as skills instaladas em `.claude/skills/` dele, sejam quais forem os nomes/domínios específicos (cada projeto pode ter um conjunto diferente). Use quando o usuário pedir "checkup", "auditoria geral", "revisa o projeto todo", "como está a saúde do projeto", ou ao entrar num projeto pela primeira vez para saber o estado real dele antes de mexer em qualquer coisa. Não substitui as skills individuais — aciona todas em sequência contra o código já existente e consolida o resultado num relatório único.
---

# Checkup — auditoria completa do projeto contra todas as skills instaladas

Atue como auditor que não escreve código — só verifica o que já existe contra os padrões que o PRÓPRIO projeto já definiu para si mesmo nas skills instaladas. Nunca inventar critério novo aqui: o critério é sempre o que cada skill já estabelece: se uma regra não está em nenhuma skill instalada, não é achado deste checkup, é sinal de que falta documentar essa regra (registrar como sugestão, não como violação).

## Passo 1 — Descobrir o que está instalado NESTE projeto

- Listar `.claude/skills/*/SKILL.md` do projeto atual — nunca assumir que o conjunto é o mesmo de outro projeto; nomes e domínios variam (um projeto pode ter `seguranca-de-aplicacoes`, outro `seguranca-cobranx`; um pode ter `whatsapp-antiban`, outro não ter WhatsApp nenhum).
- Ler o frontmatter (`name`, `description`) de cada uma para entender domínio, gatilho e, quando existir, a seção de checklist/"Definição de concluído"/"Checklist ao encerrar tarefa" — é ela que vira o critério de auditoria do Passo 2.
- Projeto sem nenhuma skill instalada: dizer isso explicitamente e parar — checkup sem critério documentado é só opinião solta, não auditoria.

## Passo 2 — Auditoria por skill (sequencial, uma de cada vez)

Ordem sugerida quando o conjunto do projeto tiver esse tipo de skill — adaptar à realidade real, nunca forçar uma skill que não existe:

1. Segurança (isolamento de dados, auth, segredos — nome varia por projeto).
2. Isolamento multi-tenant (só se o projeto for multi-conta).
3. Regras de negócio / domínio (só se existir e estiver preenchida, não só template vazio).
4. Engenharia de software (padrões gerais de código, causa raiz, modo cirúrgico).
5. Sincronização e integridade (propagação de mudança, contratos).
6. Testes automatizados (cobertura do que é crítico).
7. Design (consistência visual, acessibilidade).
8. Skills de domínio específico do projeto (ex.: `whatsapp-antiban`, filas de notificação, etc.).

Para cada skill: reler a seção de checklist/definição de concluído dela e aplicá-la contra o CÓDIGO JÁ EXISTENTE no repositório — não contra uma tarefa nova. Onde o checklist foi escrito pensando em "ao encerrar uma tarefa", adaptar a pergunta para "isso vale para todo o código que já está aqui, não só para o que alguém mudou hoje" (ex.: "toda tabela tem RLS nas 4 operações?" em vez de "a tabela que eu criei agora tem RLS?").

## Passo 3 — Registro de achados

Por achado: **skill de origem · arquivo/local · o que a regra exige · o que o código faz hoje · severidade**.

- **Bloqueante:** viola regra de segurança, isolamento ou regra de negócio crítica (dinheiro, dado sensível) — item que não pode esperar.
- **Ressalva:** funciona, mas é dívida conhecida e registrável (ex.: falta teste de um caminho não-crítico, doc desatualizada).
- **Observação:** melhoria válida, mas fora do critério estrito de alguma skill — registrar separado, nunca misturar com achado real.

Achado que a própria skill de origem manda resolver de um jeito específico (ex.: ambiguidade de regra de negócio → perguntar ao dono, nunca decidir sozinho; furo de segurança → não corrigir "de leve", seguir o protocolo de incidente se já estiver em produção) segue ESSE protocolo, não uma correção genérica improvisada aqui.

## Passo 4 — Relatório consolidado (obrigatório ao final)

```
CHECKUP — <nome do projeto> — <data>

Skills auditadas: [lista, com a origem de cada uma — projeto ou biblioteca pessoal]
Skills que faltam (regra comum ao tipo de projeto, mas sem skill instalada para cobrir): [lista, se houver]

Por skill:
- <skill>: ✔ Aprovado | ⚠ Ressalvas (N) | ✖ Bloqueado (N)
  - achado 1 (arquivo:linha se aplicável)
  - achado 2
  ...

Resumo:
- Bloqueantes totais: N — o que impede considerar o projeto saudável agora
- Ressalvas totais: N — dívida conhecida, não urgente
- Maior risco do projeto hoje, em 1 frase
- Próximo passo recomendado (corrigir bloqueante X primeiro, ou nenhum bloqueante — só ressalvas)
```

## O que este checkup NÃO é

- Não corrige nada sozinho. Aponta e devolve para o fluxo normal de correção de cada skill (engenharia corrige → sincronização reverifica → testes cobre a regressão) — checkup é diagnóstico, não tratamento.
- Não substitui revisão pontual de PR/diff — é uma "foto" do estado geral, tirada em momentos específicos (entrada num projeto, antes de um marco importante), não uma verificação de todo commit.
- Projeto grande demais para uma passada só: melhor dividir por skill em execuções separadas (ex.: `/checkup` focado só em segurança hoje, só em testes amanhã) do que fazer um checkup raso de tudo de uma vez — profundidade vale mais que velocidade aqui.
