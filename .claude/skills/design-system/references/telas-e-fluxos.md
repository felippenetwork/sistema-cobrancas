# Telas e Fluxos — anatomia

Ler ao criar/alterar telas inteiras ou definir fluxos. Estas anatomias são o padrão do produto; desvios precisam de motivo.

## Layout base (app shell completo)

- Sidebar fixa (240px, `bg-card border-r border-border`) + área de conteúdo `max-w-6xl mx-auto px-6 py-6`.
- **Header global** (`h-14 border-b border-border bg-card`, acima do conteúdo): à direita, indicador de status do WhatsApp (ponto success/destructive + "Conectado", clicável → Conexão), sino de notificações (badge numérico discreto) e menu de avatar (nome da empresa, e-mail, links Configurações · Plano · Sair). Nada mais no header.
- Header de página (dentro do conteúdo): título `text-xl font-semibold` à esquerda; ação primária da página à direita; breadcrumb (`text-sm text-muted-foreground`) apenas em telas de detalhe.
- Uma única ação primária (azul) por tela.
- Performance é design: a view principal carrega em < 2s — skeleton imediato, dados progressivos.

## Dashboard

Padrão validado no mercado (Mercury, Ramp, Cora): liderar com o número que responde "está tudo bem?", contenção visual como sinal de confiança, e cada bloco apontando uma ação — nunca relatório passivo.

Hierarquia de cima para baixo:
1. Linha de cards de métrica (ver `regras-financeiras` para a definição exata de cada indicador): **Recebido no mês** · **A receber no mês** · **Em aberto** · **Saldo do mês**. Regra condicional: se houver parcelas vencidas, o card correspondente ganha destaque (`border-destructive/40 bg-destructive-bg`, valor em `text-destructive`) e um link "Ver vencidas" — é a pergunta nº 1 de quem cobra. Sem vencidas, exibe indicação neutra discreta.
2. Gráfico "Recebimentos no mês" (barras, `h-64`) — biblioteca leve, cores dos tokens (`--success`/`--primary`), tooltip com valor formatado em R$.
3. Listas rápidas: **Vencendo hoje** e **Em atraso** — poucos itens cada (cliente, valor, dias), ação rápida ("Cobrar agora") no hover, link "Ver todas".

Dashboard responde em segundos: "quanto entra, quanto está atrasado, o que preciso agir hoje" — e cada resposta tem um clique de ação ao lado. Progressive disclosure: resumo aqui, detalhe nas telas de lista.

## Lista de cobranças

1. Header: "Cobranças" + botão "Nova cobrança".
2. Toolbar: busca (cliente/descrição) · tabs de status (Todas · Pendentes · Vencidas · Pagas · Canceladas) com contagem · seletor de mês.
3. Tabela: Cliente · Descrição · Valor (direita) · Vencimento · Status (badge) · ⋯ (Ver, Marcar como paga, Cobrar agora, Cancelar).
4. Paginação com total ("128 cobranças"). Filtro ativo reflete na URL (querystring) — recarregar mantém o estado.

## Detalhe da cobrança

1. Breadcrumb (Cobranças / #1042) · título "R$ 450,00 — João Silva" + badge de status · ações (Marcar como paga · Cobrar agora · ⋯).
2. Grid 2 colunas (empilha no mobile):
   - Esquerda: dados (cliente com link, descrição, valor, vencimento, criação, forma de pagamento).
   - Direita: **timeline de notificações** — cada evento com ícone de canal (WhatsApp/e-mail), data/hora, status de entrega (enviado/entregue/lido/falhou); agendadas futuras aparecem esmaecidas com opção de cancelar.
3. A timeline é o diferencial do produto: o usuário VÊ a régua de cobrança funcionando.

## Cliente (detalhe)

1. Nome + contatos (telefone formatado, e-mail) + ações (Editar · Nova cobrança para este cliente).
2. Cards: Total em aberto · Total pago · Cobranças ativas.
3. Tabela de cobranças do cliente (mesmo padrão da lista geral, sem coluna Cliente).

## Nova cobrança (página, não modal)

1. Seções em card único: Cliente (select com busca + "Criar novo cliente" inline) → Detalhes (descrição, valor, vencimento com atalhos, fixa ou recorrente) → Régua de notificação (preview da mensagem real com as variáveis preenchidas — ver skill `notificacoes-fila`).
2. Rodapé fixo do formulário: [Cancelar] [Criar cobrança].
3. Sucesso → toast "Cobrança criada" + redirect para o detalhe (nunca deixar na página do formulário vazio).

## Configurações

Tabs: Conta · WhatsApp (status da conexão + QR quando desconectado) · Templates (lista + editor com preview ao vivo e variáveis clicáveis) · Notificações · Plano e cobrança · Segurança (senha, 2FA, sessões ativas).

## Onboarding (primeiro acesso)

Checklist persistente no dashboard até completar (dispensável): 1. Conectar WhatsApp → 2. Criar primeiro cliente → 3. Criar primeira cobrança. Cada item com botão direto. Produto vazio sem orientação = churn no dia 1.

## Padrões de fluxo (valem em todo o app)

- **Criar** → toast de sucesso + redirect ao detalhe do criado.
- **Editar** → salvar mantém na tela com toast; botão desabilitado sem mudanças (dirty check).
- **Excluir/cancelar** → modal de confirmação com impacto; sucesso → toast + volta à lista.
- **Ação em massa** → barra de seleção + confirmação única com contagem ("Cancelar 12 cobranças?").
- **Operação > 2s** → botão em loading + tela mantém interatividade; > 10s (importação) → progresso com contagem.
- **Erro de servidor** → toast com "Tentar novamente"; formulário preserva os dados digitados SEMPRE.
