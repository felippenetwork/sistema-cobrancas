# Componentes — especificação

Ler ao criar ou alterar qualquer componente. Base: shadcn/ui customizado pelos tokens do `SKILL.md` (mapeados em `tailwind.config.ts` — usar sempre os nomes de classe abaixo, nunca hex solto nem cor Tailwind padrão como `bg-zinc-50` ou `bg-slate-900`).

## Botões

- Variantes: **primário** (`bg-primary hover:bg-[var(--primary-hover)] text-primary-foreground`, 1 por contexto), **secundário** (`border border-border bg-transparent hover:bg-accent text-foreground`), **fantasma** (`hover:bg-accent`, ações terciárias), **destrutivo** (`bg-destructive hover:bg-destructive/90 text-destructive-foreground`, só em confirmações).
- Tamanhos: padrão `h-9 px-4 text-sm`; pequeno `h-8 px-3 text-xs` (dentro de tabelas).
- Estados obrigatórios: `disabled:opacity-50 disabled:pointer-events-none`; **loading** troca o rótulo por spinner inline + rótulo ("Salvando…") e desabilita — nunca botão que "não responde".
- Rótulo é verbo + objeto: "Criar cobrança", "Salvar template". Nunca "OK", "Sim", "Enviar" solto.

## Inputs e formulários

- Anatomia: label (`text-sm font-medium text-foreground`) → input (`h-9 rounded-lg border border-border bg-input focus-visible:ring-2 ring-ring`) → help text opcional (`text-xs text-muted-foreground`) → erro (`text-sm text-destructive`, com `aria-describedby`).
- Máscaras brasileiras obrigatórias: telefone `(21) 99876-5432`, CPF `000.000.000-00`, CNPJ `00.000.000/0000-00`, moeda com prefixo R$ fixo e digitação em centavos (digitou 1500 → exibe R$ 15,00).
- Validação: no blur do campo + no submit; erro some quando corrigido; NUNCA limpar o formulário em erro de submit.
- Select: shadcn Select com busca quando > 10 opções (ex.: lista de clientes).
- Datas: date picker com formato dd/mm/aaaa; atalhos "Hoje", "Em 7 dias", "Em 30 dias" em campos de vencimento.

## Tabelas (complemento ao núcleo do `SKILL.md`)

- Toolbar acima: busca à esquerda (`h-9`, ícone lupa), filtros de status como chips/tabs, botão primário à direita.
- Seleção múltipla: checkbox por linha + header; barra de ações em lote surge fixa acima da tabela ("3 selecionadas · Cancelar · Reenviar").
- Cabeçalho: `text-xs font-medium text-muted-foreground uppercase tracking-wide`, borda inferior `border-border`.
- Linhas: `border-b border-border`, hover `hover:bg-accent`, altura confortável mas densa (`py-3`).
- Célula de valor: `text-right tabular-nums font-medium`. Célula de status: badge do núcleo. Célula de data: `text-muted-foreground`.
- Linha clicável abre o detalhe; área do checkbox e do menu "⋯" não propagam o clique.
- Responsivo < 640px: tabela vira lista de cards (linha → card com título, valor, badge, data) — nunca tabela espremida ilegível.

## Modais e confirmações

- Larguras: confirmação `max-w-md`; formulário `max-w-lg`. Formulários longos (nova cobrança) são PÁGINA, não modal.
- Fundo do modal `bg-card border border-border`; overlay `bg-black/60` (mais escuro que o padrão claro, para não "lavar" o tema dark). Foco vai para o modal ao abrir; Esc fecha.
- Confirmação destrutiva: título com a ação ("Excluir cliente?"), corpo com o impacto concreto ("Isso cancela 3 notificações agendadas. O histórico será mantido."), botões [Cancelar] [Excluir cliente].
- Ação gravíssima (excluir conta, desconectar WhatsApp com envios pendentes): exigir digitar o nome do recurso para habilitar o botão.

## Toasts e feedback

- Posição: canto inferior direito; duração 4s (sucesso) / 6s (erro); máximo 3 empilhados.
- Sucesso: `border-l-2 border-success bg-card`, texto objetivo ("Cobrança criada"). Erro: `border-l-2 border-destructive bg-card` + ação quando existir ("Tentar novamente").
- Ações reversíveis ganham "Desfazer" no toast (7s) em vez de modal de confirmação.
- Toast NUNCA é o único registro de erro: erro também aparece no contexto (campo, tela).

## Card de métrica (dashboard)

```
┌──────────────────────────────┐
│ A receber este mês       ⓘ   │  ← text-xs text-muted-foreground
│ R$ 24.830,00                 │  ← text-2xl font-semibold tabular-nums
│ ↑ 12% vs. mês anterior       │  ← text-xs, success/destructive conforme direção
└──────────────────────────────┘
```
`bg-card border border-border rounded-lg p-4 md:p-6`. Sem ícone gigante colorido, sem gradiente.

## Sidebar / navegação

- Largura 240px, `bg-card border-r border-border`; logo no topo; itens `h-9 rounded-md text-sm text-muted-foreground`, ativo `bg-accent text-foreground font-medium`.
- Seções agrupadas (GERAL, CLIENTES, FINANCEIRO, CONFIG). Item "Sair" destacado no rodapé.
- < 1024px: colapsa em Sheet (drawer) com botão hambúrguer no header.

## Skeletons e empty states

- Skeleton reproduz a forma real (mesmas alturas de linha/card), `bg-muted animate-pulse rounded`; 5 linhas fantasma em tabelas.
- Empty state: ícone lucide `h-8 w-8 text-muted-foreground` + título objetivo + 1 frase + botão primário. Primeira vez ≠ filtro sem resultado ("Nenhuma cobrança criada ainda" vs. "Nenhum resultado para estes filtros" + "Limpar filtros").

## Status de conexão (alerta)

WhatsApp caído / e-mail com problema: faixa fixa no topo do conteúdo com `bg-destructive-bg text-destructive` (ou `warning` conforme gravidade), texto direto ("WhatsApp desconectado — reconectar") + ação. Visível, nunca escondido num canto.

## Acessibilidade por componente

- Ícone-botão: `aria-label`. Modal: `role="dialog" aria-modal`. Toast: `role="status"`. Tabela ordenável: `aria-sort` no header ativo.
- Testar todo componente novo só com teclado antes de concluir (Tab, Enter, Esc, setas em selects).
