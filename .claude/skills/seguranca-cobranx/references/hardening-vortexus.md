# Hardening do VPS Vortexus

Ler este arquivo ao configurar, revisar ou alterar qualquer coisa no servidor. Isto é infraestrutura: skill nenhuma protege o app se o servidor estiver aberto. Executar uma vez, revisar a cada mudança relevante.

## 1. SSH

```bash
# /etc/ssh/sshd_config
PasswordAuthentication no      # só chave SSH, nunca senha
PermitRootLogin no             # root não loga direto
```

- Acesso por chave ed25519; a chave privada só na máquina do Felippe (nunca no repositório, nunca por e-mail/WhatsApp).
- `sudo systemctl restart sshd` após alterar (testar login em outra aba ANTES de fechar a atual).

## 2. Firewall (UFW)

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp        # SSH
ufw allow 80,443/tcp    # somente se o Vortexus servir algo por HTTP(S)
ufw enable
ufw status verbose      # conferir: NADA além do necessário
```

**Redis (6379) e Postgres locais NUNCA aparecem liberados para 0.0.0.0.** Se o app na Vercel precisa enfileirar jobs, usar Redis gerenciado com TLS (Upstash) ou endpoint HTTP autenticado no worker — não abrir o Redis do VPS para a internet.

## 3. Fail2ban

```bash
apt install fail2ban -y
systemctl enable --now fail2ban
fail2ban-client status sshd   # ver IPs banidos
```

Bane automaticamente IPs com tentativas repetidas de SSH. Custo zero, elimina 99% do ruído de brute force.

## 4. Redis local

```bash
# /etc/redis/redis.conf
bind 127.0.0.1 ::1            # só local
requirepass <senha-forte-32+chars>
rename-command CONFIG ""      # desabilita comandos perigosos
rename-command FLUSHALL ""
```

Senha em variável de ambiente do worker, nunca no código. Após mudar: `systemctl restart redis`.

## 5. Usuário e processos

- Criar usuário próprio para o worker (ex.: `cobranx`), sem sudo. Worker roda via PM2/systemd sob esse usuário — nunca root.
- Diretório de sessões Baileys: `chown -R cobranx:cobranx`, `chmod 700` no diretório, `600` nos arquivos.
- `pm2 startup` + `pm2 save` para o worker voltar sozinho após reboot.

## 6. Atualizações automáticas

```bash
apt install unattended-upgrades -y
dpkg-reconfigure -plow unattended-upgrades
```

Patches de segurança do sistema aplicados sozinhos. Atualização de Node/dependências continua manual e testada.

## 7. Monitoramento mínimo

- `pm2 logs` estruturados com rotação (`pm2 install pm2-logrotate`) — disco cheio derruba o worker.
- Alerta simples de "worker caiu": healthcheck HTTP do worker monitorado por serviço gratuito (UptimeRobot ou similar) apontando para um endpoint `/health` autenticado ou público sem dados.
- Revisar mensalmente: `last -20` (logins), `fail2ban-client status sshd`, espaço em disco (`df -h`).

## 8. Backup do que só existe no VPS

O banco está no Supabase (tem backup próprio). No VPS, o que precisa de backup:

- Arquivos de sessão Baileys (criptografados antes de sair do servidor: `tar` + `age`/`gpg`)
- `.env` do worker
- Configuração do PM2 (`pm2 save` gera o dump)

Rotina: script diário que gera o tar criptografado e envia para storage externo (bucket S3/B2/Supabase Storage privado). Backup que mora só no próprio servidor não protege contra o servidor morrer.

## Checklist de revisão rápida (rodar após qualquer mudança no VPS)

- [ ] `ufw status` sem portas além de SSH (+80/443 se aplicável)?
- [ ] SSH sem senha e sem root?
- [ ] Redis com bind local + requirepass?
- [ ] Worker rodando como usuário sem sudo?
- [ ] Sessões Baileys com permissão 700/600?
- [ ] fail2ban ativo?
- [ ] Backup diário criptografado saindo do servidor?
