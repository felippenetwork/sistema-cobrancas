# Performance e Banco

Ler ao: escrever query nova em tabela que cresce, investigar lentidão, adicionar cache, criar migration com índices. Regra geral: medir antes de otimizar — mas os padrões abaixo são obrigatórios desde o início porque corrigi-los depois custa caro.

## 1. Índices (multi-tenant muda tudo)

Como TODA query filtra por `conta_id`, índices são compostos começando por ele:

```sql
CREATE INDEX idx_cobrancas_conta_status ON cobrancas (conta_id, status);
CREATE INDEX idx_cobrancas_conta_venc   ON cobrancas (conta_id, vencimento DESC);
CREATE INDEX idx_notif_conta_criado     ON notificacoes_enviadas (conta_id, criado_em DESC);
```

- Coluna nova usada em WHERE/ORDER de query frequente → índice na MESMA migration.
- Índice parcial para estados quentes: `CREATE INDEX ... ON notificacoes (proximo_envio) WHERE status = 'agendada';` — o tick do scheduler varre só o que importa.
- Query lenta reportada → `EXPLAIN ANALYZE` antes de qualquer mudança; decidir com dados.

## 2. N+1 (o assassino silencioso de dashboards)

PROIBIDO buscar lista e depois buscar relacionados em loop. O Supabase resolve com select aninhado:

```typescript
// ERRADO: 1 + N queries
const { data: cobrancas } = await supabase.from('cobrancas').select('*');
for (const c of cobrancas) { await supabase.from('clientes')... }

// CERTO: 1 query
const { data } = await supabase
  .from('cobrancas')
  .select('id, valor, vencimento, status, cliente:clientes(id, nome, telefone)')
  .eq('status', 'pendente')
  .order('vencimento')
  .range(0, 24);
```

Agregações de dashboard (totais, contagens por status) → RPC/view no banco, nunca "buscar tudo e somar no JS".

## 3. Paginação e contagem

- Toda listagem: `range()` com página de 25–50 + `order` determinístico (coluna + `id` como desempate).
- `count: 'estimated'` para exibir totais em tabelas grandes; `exact` só quando o número precisa ser exato (faturamento).

## 4. Cache no Next

- Dados de listagem/dashboard: `revalidateTag`/`revalidatePath` após mutação — a UI reflete a mudança sem refetch manual espalhado.
- `React.cache()` para fetch repetido na mesma renderização (ex.: dados da conta usados por vários componentes da página).
- NUNCA cachear entre contas: chave de cache sempre inclui `contaId`. Cache compartilhado entre tenants é vazamento de dados via performance.

## 5. Bundle e frontend

- Biblioteca pesada (gráficos) → `dynamic(() => import(...), { ssr: false })` na página que usa, não no bundle global.
- Imagens via `next/image`. Fontes via `next/font` (zero layout shift).
- Depois de feature grande: `next build` e olhar o tamanho das rotas — rota de dashboard acima de ~300 kB de JS merece investigação.

## 6. Cron de disparo (não é mais fila com worker)

- O "processamento em lote" hoje é a execução do cron (`app/api/cron/whatsapp-uazapi`, ver skill `whatsapp-uazapi`) dentro do orçamento de `maxDuration` (300s) — respeitando o ritmo anti-ban (45–80s entre envios), throughput não é o objetivo.
- Job pesado (importação de N clientes) → quebrar em lotes menores; uma execução de cron nunca deve se aproximar do timeout no meio de um lote — encerrar graciosamente e deixar o resto para o próximo tick (1min depois).
- `notificacoes_enviadas` não é fila em memória — é tabela Postgres; histórico e status vivem lá, sem necessidade de `removeOnComplete` ou equivalente.

## 7. Quando NÃO otimizar

Sem medição não há otimização: nada de memo/useMemo espalhado "por via das dúvidas", nem micro-otimização em código que roda 1x por request. Prioridade de impacto real no Cobranx: índices > N+1 > paginação > cache > bundle > o resto.
