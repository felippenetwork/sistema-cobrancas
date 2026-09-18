# Testes de Segurança, CI e Rotinas

Ler este arquivo ao: criar testes, revisar código antes de release, configurar CI, ou executar as rotinas periódicas de segurança.

## 1. Teste de isolamento de tenant (o teste mais importante do sistema)

Objetivo: provar que a conta A não lê nem escreve dados da conta B — em TODA tabela.

Estrutura (script `tests/security/tenant-isolation.test.ts`):

1. Setup: criar `conta_a` e `conta_b` com usuários próprios (projeto Supabase de TESTE, nunca produção).
2. Semear 1 registro de cada tabela de negócio na conta B.
3. Autenticado como usuário da conta A (client anon + sessão real, para o RLS valer), executar contra cada tabela:
   - `SELECT` nos registros da B → deve retornar **0 linhas** (não erro: RLS filtra).
   - `INSERT` com `conta_id` da B → deve falhar.
   - `UPDATE` e `DELETE` em registro da B → deve afetar **0 linhas**.
4. O teste itera uma LISTA CENTRAL de tabelas. Regra de manutenção: **criou tabela nova → adicionou na lista no mesmo PR.** Um teste extra que compara a lista com `information_schema.tables` e falha se houver tabela de negócio fora da lista fecha essa brecha.

Rodar antes de todo deploy. Este teste teria pegado o bug da policy de UPDATE faltante.

## 2. Testes de autorização de rotas

Para cada API route / server action mutável, 3 casos mínimos:

1. Sem sessão → 401/erro de autenticação.
2. Sessão de outra conta tentando agir sobre recurso alheio (IDOR) → 0 linhas afetadas / erro de não encontrado.
3. Papel insuficiente em ação de dono → negado.

## 3. Revisão de segurança pré-deploy (checklist de release)

- [ ] Teste de isolamento de tenant verde (incluindo tabelas novas na lista)
- [ ] `tsc --noEmit` e build verdes (app e worker)
- [ ] `npm audit` sem high/critical em dependência direta
- [ ] Diff revisado buscando: SQL interpolado, `dangerouslySetInnerHTML`, `console.log` com dado pessoal, chave hardcoded, rota mutável sem verificação de sessão
- [ ] Rota/endpoint público novo tem rate limit
- [ ] Ação sensível nova grava auditoria
- [ ] Migration nova: RLS + 4 policies presentes
- [ ] Env novas documentadas e configuradas (Vercel/Vortexus) antes do deploy

## 4. CI e proteção do repositório

- **gitleaks** no pre-commit e no CI — bloqueia commit/push com segredo. Configurar uma vez:
  ```bash
  # pre-commit local
  gitleaks protect --staged
  ```
- CI mínimo por PR: `tsc --noEmit` + build + testes de segurança + `npm audit` + gitleaks.
- Branch `main` protegida: merge só com CI verde.
- Dependabot/Renovate ativo para alertas de vulnerabilidade em dependências.

## 5. Dados de teste

- NUNCA telefone, e-mail ou dívida reais em dev/teste — usar geradores (faker) com DDDs válidos porém números reservados/inventados.
- Seeds de teste não contêm segredos reais.
- Ambiente de dev tem projeto Supabase e chaves próprios; impossibilidade física de apontar dev para o banco de produção (URLs distintas em `.env` distintos).

## 6. Rotinas periódicas (agendar de verdade)

**Mensal (15 min):**
- `fail2ban-client status sshd` e `last -20` no Vortexus (acessos estranhos?)
- Disco/CPU do VPS; fila sem acúmulo anormal
- Dependabot: tratar alertas abertos

**Trimestral (1–2 h):**
- Rodar o checklist completo de `hardening-vortexus.md`
- Testar RESTORE de um backup (banco em projeto temporário + sessões Baileys)
- Revisar quem tem acesso a: Supabase, Vercel, GitHub, VPS, Mercado Pago — remover o que não precisa
- Revisar policies de tabelas alteradas no período

**Semestral:**
- Rotacionar service role, senha do Redis e tokens de integração (mesmo sem incidente)
- Reler o post-mortem de incidentes do período e verificar se as ações viraram regra na skill

## Princípio

Segurança madura não é um recurso instalado — é: código novo nascendo dentro das regras (o SKILL.md), provas automáticas de isolamento (esta referência), e rotina de manutenção com data marcada. Se não está agendado, não existe.
