# Auditoria, Alertas e Resposta a Incidentes

Ler este arquivo ao: implementar/alterar logs de auditoria, criar alertas de segurança, ou diante de qualquer suspeita de invasão/vazamento.

## 1. Tabela `logs_auditoria` (schema de referência)

```sql
CREATE TABLE logs_auditoria (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id      uuid NOT NULL,
  usuario_id    uuid,                    -- null p/ eventos de sistema/webhook
  acao          text NOT NULL,           -- ex.: 'login_falha', 'cliente_excluido'
  recurso_tipo  text,                    -- 'cobranca' | 'cliente' | 'template'...
  recurso_id    uuid,
  ip            inet,
  user_agent    text,
  detalhes      jsonb DEFAULT '{}',      -- antes/depois em mudanças críticas
  criado_em     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE logs_auditoria ENABLE ROW LEVEL SECURITY;
-- Usuário: apenas SELECT da própria conta. INSERT só via service role/trigger.
-- SEM policy de UPDATE e SEM policy de DELETE: append-only por construção.
CREATE INDEX idx_auditoria_conta_data ON logs_auditoria (conta_id, criado_em DESC);
CREATE INDEX idx_auditoria_acao ON logs_auditoria (acao, criado_em DESC);
```

Regras:
- Gravar auditoria no MESMO fluxo da ação (não "depois, se der"). Falhou a ação → não audita como sucesso.
- `detalhes` guarda o diff em mudanças críticas (`{"antes": {...}, "depois": {...}}`) — mascarando dados pessoais.
- Retenção: 12 meses quentes; depois, arquivar (export mensal para storage frio) antes de expurgar.

## 2. Catálogo de eventos (mínimo)

| Evento | Severidade |
|---|---|
| `login_sucesso` / `login_falha` / `login_bloqueado` | info / aviso / alerta |
| `senha_redefinida` / `2fa_ativado` / `2fa_desativado` | alerta |
| `email_principal_alterado` | alerta |
| `cliente_criado` / `cliente_editado` / `cliente_excluido` | info / info / aviso |
| `cobranca_cancelada` / `template_alterado` | info |
| `whatsapp_conectado` / `whatsapp_desconectado` | aviso |
| `exportacao_dados` | alerta |
| `plano_alterado` / `pagamento_confirmado` (webhook) | info |
| `usuario_convidado` / `usuario_removido` / `papel_alterado` | aviso |

## 3. Alertas automáticos (detecção)

Implementar como job periódico (pg_cron ou worker) sobre `logs_auditoria`:

1. **Brute force distribuído:** > 20 `login_falha` na mesma conta em 1h → e-mail ao dono + exigir verificação extra no próximo login.
2. **Comportamento anômalo de dados:** exclusões de clientes em massa (> 20 em 10 min) ou exportação fora de padrão → alerta ao dono.
3. **Acesso novo:** IP/dispositivo inédito em login → e-mail "Foi você?" (ver referência de autenticação).
4. **Infra:** worker sem heartbeat por 5 min, fila crescendo sem consumo, pico de `webhook_assinatura_invalida` → alerta ao Felippe (canal interno).

Alerta que ninguém recebe não existe: cada alerta define destinatário (dono da conta vs. operação do Cobranx).

## 4. Playbook de resposta a incidente

Diante de suspeita (acesso não reconhecido, vazamento, comportamento estranho, chave exposta):

**Passo 1 — Conter (primeiros 30 min)**
- Rotacionar as credenciais possivelmente comprometidas: service role, senha Redis, tokens Mercado Pago, chave da conta afetada.
- Revogar TODAS as sessões da(s) conta(s) afetada(s).
- Se o vetor for o VPS: bloquear no firewall e trocar chaves SSH antes de investigar.
- Se o vetor for uma sessão Baileys: desconectar a instância e apagar a sessão do disco.

**Passo 2 — Investigar (mesmo dia)**
- `logs_auditoria` é a fonte: reconstruir linha do tempo (quem, o quê, quando, de onde) filtrando por conta, IP e período.
- No VPS: `last -50`, logs do fail2ban, histórico de comandos, processos ativos.
- Determinar escopo: quais contas, quais dados, desde quando.

**Passo 3 — Erradicar e restaurar**
- Corrigir a falha de origem (código, config, policy) ANTES de reabrir o que foi fechado.
- Restaurar dados de backup se houve alteração/perda.

**Passo 4 — Comunicar (obrigação legal)**
- Vazamento de dados pessoais com risco relevante aos titulares → LGPD art. 48: comunicar a ANPD e os titulares afetados em prazo razoável, descrevendo dados afetados, riscos e medidas tomadas. Ser factual e direto; não minimizar.
- Clientes afetados operacionalmente (ex.: número banido, mensagens indevidas) → comunicar proativamente com plano de correção.

**Passo 5 — Post-mortem (até 1 semana)**
- Documento curto: linha do tempo, causa raiz, o que falhou na detecção, ações permanentes com prazo.
- Transformar cada ação permanente em regra nesta skill, para o erro não voltar.

## Regra de ouro

Em incidente, a ordem é sempre: **conter → investigar → corrigir → comunicar → aprender**. Nunca "investigar com calma" antes de conter: cada minuto com a credencial válida é dano acumulando.
