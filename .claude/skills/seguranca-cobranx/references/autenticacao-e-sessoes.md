# Autenticação e Sessões — fluxos completos

Ler este arquivo ao implementar ou alterar: cadastro, login, verificação de e-mail, recuperação de senha, 2FA, gestão de sessões, alertas de acesso.

## 1. Cadastro

1. Validar input (zod): e-mail válido, senha ≥ 8 chars, rejeitar lista de senhas comuns.
2. Resposta anti-enumeração: se o e-mail já existe, responder o mesmo "Verifique seu e-mail para continuar" — nunca "e-mail já cadastrado".
3. Criar conta em estado `pendente_verificacao`.
4. **Gate de verificação:** conta não verificada pode explorar a UI, mas NÃO pode: conectar WhatsApp, criar cobranças com envio, importar contatos. Isso impede abuso da plataforma para spam com cadastros descartáveis.
5. Link de verificação: token de uso único, expira em 24h.
6. Registrar `cadastro_criado` e `email_verificado` na auditoria.

## 2. Login

1. Rate limit ANTES de consultar o banco: 5 tentativas por IP+email / 15 min. Exceder → resposta genérica de bloqueio temporário (não revelar tempo restante exato).
2. Falha → registrar em `logs_auditoria` (`login_falha`: email, IP, user_agent). Sucesso → `login_sucesso`.
3. Mensagem de erro única: "Credenciais inválidas" — igual para usuário inexistente e senha errada.
4. Após sucesso, comparar IP/user_agent com os últimos acessos da conta: combinação nova → disparar e-mail "Novo acesso à sua conta" com data, IP aproximado e link "Não fui eu" (que leva à troca de senha + revogação de sessões).

## 3. Recuperação de senha (fluxo que mais sofre ataque)

1. Endpoint com rate limit próprio (3 pedidos por e-mail / hora).
2. Resposta SEMPRE igual: "Se este e-mail estiver cadastrado, você receberá as instruções" — exista a conta ou não.
3. Token: aleatório (≥ 32 bytes), uso único, expira em 30 min, armazenado com hash (nunca em claro no banco).
4. Ao redefinir: invalidar o token, **revogar todas as sessões ativas**, registrar `senha_redefinida` na auditoria, enviar e-mail "Sua senha foi alterada".
5. O link de reset não loga o usuário automaticamente após a troca — exigir login com a senha nova.

## 4. 2FA (TOTP)

1. Ativação: gerar segredo via Supabase Auth MFA, exibir QR code, **confirmar com um código válido antes de ativar**.
2. Gerar 8 códigos de recuperação de uso único; exibir uma única vez; armazenar hasheados.
3. Login com 2FA ativo: senha correta → tela do código; 5 erros de código → mesmo bloqueio temporário do login.
4. Desativar 2FA exige senha + código atual, e gera e-mail de alerta + auditoria.
5. Ações que EXIGEM 2FA quando ativo (step-up): exportação em massa, exclusão da conta, troca do e-mail principal.

## 5. Gestão de sessões

1. Tela "Sessões ativas" nas configurações: dispositivo/navegador, IP aproximado, último uso, com botão "Encerrar" por sessão e "Encerrar todas as outras".
2. Revogação é server-side (invalidar refresh token), não só limpar cookie.
3. Timeout por inatividade: sessão sem uso por 14 dias → expira (produto financeiro não mantém sessão eterna).
4. Troca de e-mail principal: confirmar no e-mail antigo E no novo; auditoria.

## 6. Convites e múltiplos usuários por conta (quando existir)

1. Convite por e-mail com token de uso único (72h); papel definido pelo dono no envio.
2. Remoção de usuário da conta revoga as sessões dele imediatamente.
3. Rebaixamento de papel tem efeito imediato (verificar papel na requisição, não no login).
4. Auditoria: `usuario_convidado`, `usuario_removido`, `papel_alterado`.

## Anti-padrões proibidos

- Confirmar existência de e-mail/telefone em QUALQUER endpoint (login, cadastro, recuperação, convite).
- Tokens de reset/verificação em claro no banco ou em logs.
- "Lembrar de mim" que estende sessão sem limite.
- Bypass de rate limit "só em dev" que vaza para produção (usar env explícita e default seguro).
