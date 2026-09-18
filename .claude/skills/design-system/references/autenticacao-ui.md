# Autenticação — UI das telas públicas

Ler ao criar/alterar: login, cadastro, verificação de e-mail, recuperação de senha, tela de 2FA. Padrão dominante de SaaS B2B/fintech: para ferramenta de trabalho, **card centralizado limpo** supera split-screen decorativo — foco total em entrar, zero distração. Tema dark igual ao resto do produto (nunca clarear a tela de login "pra ficar mais convidativa").

## Layout da página de login

- Fundo `bg-background`, sem navegação, sem links externos — a única tarefa é entrar.
- Card centralizado: `w-full max-w-[400px] bg-card border border-border rounded-lg p-8` (360–420px é o padrão de mercado), centralizado com flex `min-h-screen`.
- Acima do card: logo do Cobranx (`h-8`, centralizado, `mb-6`). Dentro: título "Entrar" (`text-lg font-semibold`) + subtítulo opcional (`text-sm text-muted-foreground`).
- Abaixo do card: "Não tem conta? **Criar conta grátis**" (`text-sm`).
- Rodapé da página, discreto: "© Cobranx · Termos · Privacidade" (`text-xs text-muted-foreground`).

## Formulário de login

```
E-mail                          ← label sempre visível (nunca só placeholder)
[__________________________]    ← type="email" autocomplete="email" inputMode="email"

Senha              Esqueci a senha   ← link à direita do label, text-sm text-primary
[__________________________] 👁     ← type="password" autocomplete="current-password" + toggle olho

[        Entrar        ]           ← primário, full-width, h-10
```

- Labels permanecem visíveis após digitar.
- Atributos `autocomplete` corretos são OBRIGATÓRIOS (`email`, `current-password`, `new-password` no cadastro) — é o que faz gerenciadores de senha funcionarem.
- Toggle de visibilidade da senha (ícone olho lucide, `aria-label="Mostrar senha"`).
- Enter submete de qualquer campo. Alvos de toque ≥ 44px no mobile.
- Estado de erro: mensagem única acima do botão, `text-sm text-destructive` em caixa `bg-destructive-bg border border-destructive/30 rounded-md p-3`: **"E-mail ou senha inválidos."** — genérica por segurança (anti-enumeração, ver skill `seguranca-cobranx`), mas específica na ação. Campos mantêm o valor digitado no e-mail.
- Botão em loading: spinner + "Entrando…", desabilitado.
- Bloqueio por tentativas: "Muitas tentativas. Aguarde alguns minutos e tente novamente." — sem contagem regressiva exata.

## Cadastro

- Mesmo card; campos: Nome da empresa · E-mail · Senha.
- Indicador de requisitos da senha ao vivo (mínimo 8 caracteres — ícone que vira verde), não barra de "força" vaga.
- Aceite: "Ao criar a conta, você concorda com os **Termos** e a **Política de Privacidade**" (`text-xs text-muted-foreground` acima do botão) — sem checkbox extra.
- Pós-cadastro → tela "Confirme seu e-mail" com o e-mail exibido, botão "Reenviar" (cooldown de 60s visível) e instrução de checar spam.

## Recuperação de senha

- Card com 1 campo (e-mail) + botão "Enviar link de recuperação".
- Resposta SEMPRE neutra: "Se este e-mail estiver cadastrado, enviaremos as instruções." (anti-enumeração).
- Tela de nova senha: campo + confirmação com os mesmos requisitos visuais do cadastro; sucesso → "Senha alterada" + botão "Ir para o login".

## Tela de 2FA

- Card: título "Verificação em duas etapas", texto "Digite o código do seu app autenticador".
- 6 caixas de dígito (`h-12 w-10 text-center text-lg tabular-nums`) com auto-avanço e colagem do código inteiro suportada.
- Link secundário: "Usar código de recuperação".
- Erro: "Código inválido ou expirado." + limpar caixas + foco na primeira.

## Sinais de confiança (com moderação)

- Linha discreta sob o botão de login: ícone cadeado `h-3.5 w-3.5` + "Conexão segura" (`text-xs text-muted-foreground`). Só isso.
- PROIBIDO: selos falsos ("100% seguro", cadeados gigantes dourados), badges de certificação que o produto não possui.

## Proibições nas telas públicas

- Split-screen com foto de banco de imagem — assinatura de template genérico.
- Login social exibido sem estar implementado e funcionando.
- Placeholder como único label; captcha visível sem histórico de abuso; animação de fundo.
- Qualquer texto tipo "Bem-vindo de volta! 👋".

## Mobile (< 640px)

- Card ocupa a largura com `px-4`, sem borda (`border-0 shadow-none bg-transparent`) — o formulário É a página.
- `inputMode`/`type` corretos disparam o teclado certo; primeiro campo NÃO recebe autofocus no mobile (evita teclado cobrindo a tela antes do usuário ler).
