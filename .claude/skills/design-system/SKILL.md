---
name: design-system
description: Sistema de design do produto (SaaS de cobrança, tema dark fintech). Use SEMPRE que for criar, alterar ou estilizar qualquer tela, componente ou elemento de UI deste projeto — dashboard, tabelas, formulários, cards, modais, botões, navegação, estados de status financeiro. Define paleta, tipografia, espaçamento, componentes (shadcn/ui + Tailwind) e regras de aparência. Consulte antes de escrever qualquer JSX/TSX ou CSS.
---

# Design System — Quita (cobrança / fintech)

> Marca de trabalho: **Quita**. Tom: **dark, sóbrio, corporativo (banco/fintech)** — transmite confiança e seriedade com dinheiro. Para trocar o nome do produto, altere só onde estiver "Quita".

## 0. Stack de UI obrigatória
- **Tailwind CSS** + **shadcn/ui** como base de componentes. **Não** criar componentes do zero quando o shadcn/ui já tem (Button, Card, Table, Dialog, Input, Select, Badge, Toast/Sonner, DropdownMenu, Tabs, Sheet, Skeleton).
- Ícones: **lucide-react**. Um estilo só, tamanho consistente (16–20px em UI, 24px em destaque).
- Fonte: **Inter** (Google Fonts ou `next/font`). Valores monetários sempre com `tabular-nums`.
- **Nunca** usar emoji como ícone de UI. **Nunca** usar `localStorage` em artifacts (irrelevante em produção, mas vale a regra de manter estado em React).

## 1. Princípios (o que faz parecer profissional)
1. **Hierarquia por contraste, não por enfeite.** O número importa (valor a receber, total em aberto) é o maior elemento da tela; o resto é quieto.
2. **Densidade calma.** Dashboard de fintech tem muito dado — organize em cards e tabelas com respiro generoso (não espremer). Espaçamento consistente > decoração.
3. **Cor com significado.** A cor primária é navegação/ação. Verde/âmbar/vermelho são **exclusivos de status financeiro**. Não pintar botão genérico de verde.
4. **Zero "cara de template".** Sem gradiente arco-íris, sem sombra exagerada, sem borda colorida grossa. Sobriedade é o estilo.
5. **Estados sempre tratados:** loading (skeleton), vazio (com ação), erro (com causa + como resolver). Tela nunca fica "em branco sem explicação".

## 2. Design tokens (CSS variables — colar em globals.css / Tailwind theme)

Tema **dark** como padrão. Definir como CSS variables e mapear no `tailwind.config`.

```css
:root {
  /* Fundo e superfícies (slate azulado, camadas) */
  --bg:            #0B0F17;  /* fundo da página           */
  --surface:       #121826;  /* cards, sidebar             */
  --surface-2:     #1A2233;  /* inputs, linhas alternadas  */
  --border:        #243047;  /* bordas sutis               */

  /* Texto */
  --text:          #E6EAF2;  /* principal                  */
  --text-muted:    #9AA6BD;  /* labels, secundário         */
  --text-subtle:   #64718C;  /* placeholder, captions      */

  /* Primária — azul confiança (ação, foco, links) */
  --primary:       #3B82F6;
  --primary-hover: #2F73E0;
  --primary-fg:    #FFFFFF;

  /* Semânticas — SOMENTE status financeiro */
  --success:       #10B981;  /* PAGO / recebido            */
  --warning:       #F59E0B;  /* A VENCER / em aberto       */
  --danger:        #EF4444;  /* VENCIDO                    */
  --success-bg:    #10B98122;
  --warning-bg:    #F59E0B22;
  --danger-bg:     #EF444422;
}
```

Regra: **toda cor no código sai de um token.** Proibido hex solto fora deste bloco. Isso garante consistência e permite tema claro no futuro só trocando as variables.

## 3. Tipografia
- Família única: **Inter**. (Opcional: numerais display com `font-variant-numeric: tabular-nums` em toda célula de valor.)
- Escala (rem): `text-xs 12 / sm 14 / base 15 / lg 18 / xl 22 / 2xl 28 / 3xl 36`.
- **Valores monetários** (R$): peso 600, `tabular-nums`, nunca quebram linha. O KPI principal da Dashboard em `text-3xl`/`text-2xl`.
- Labels de campo e cabeçalho de tabela: `text-xs`, `--text-muted`, `uppercase tracking-wide` (sóbrio, estilo painel financeiro).
- Sentence case em botões e títulos ("Cadastrar cobrança", não "CADASTRAR COBRANÇA"). Exceção: labels de coluna pequenas em uppercase.

## 4. Espaçamento e layout
- Grid base **4px**. Usar escala Tailwind (2, 3, 4, 6, 8...). Padding de card: 20–24px. Gap entre cards: 16–24px.
- **Raio:** `rounded-lg` (8px) em cards/inputs/botões. Consistente. Nada de raio gigante "pílula" exceto em badges de status.
- **Sombra:** mínima. Profundidade vem da cor da superfície (`--surface` sobre `--bg`), não de sombra pesada. No máximo `shadow-sm`.
- **Layout do app:** sidebar fixa à esquerda (navegação) + topbar (seletor de mês / status de conexão) + área de conteúdo. Em mobile, sidebar vira Sheet (drawer).

## 5. Componentes — convenções

### Cards de KPI (Dashboard)
- Ícone pequeno + label muted em cima, número grande embaixo.
- Valor monetário em destaque. Tendência/contexto em `text-muted` se houver.
- Não colorir o card inteiro; cor só no ícone ou num detalhe.

### Status financeiro (Badge) — padrão fixo
| Situação | Cor | Texto |
|---|---|---|
| Pago | `--success` sobre `--success-bg` | "Pago" |
| Em dia / a vencer | `--warning` sobre `--warning-bg` | "Vence em Xd" / "Vence hoje" |
| Vencido | `--danger` sobre `--danger-bg` | "Vencido Xd" |
Badge com `rounded-full`, `text-xs`, peso 600. **Sempre** texto + cor (nunca só cor — acessibilidade).

### Tabelas (Clientes, Cobranças, Log)
- Cabeçalho `--text-muted` uppercase xs. Linhas com hover sutil (`--surface-2`). Zebra opcional discreta.
- Valores à direita, `tabular-nums`. Ações (editar, baixa, WhatsApp) como ícones-botão no fim da linha, com `aria-label`.
- Vazio: linha única centralizada com mensagem + botão de ação ("Nenhuma cobrança neste mês. Cadastrar cobrança").

### Botões
- Primário: `--primary` (ações principais: Salvar, Avançar, Cadastrar).
- Secundário/outline: borda `--border`, fundo transparente (Voltar, Cancelar).
- Destrutivo: `--danger` (Excluir) — sempre com confirmação (Dialog).
- **Baixa de pagamento** ("Pago"): pode usar `--success` por ser ação financeira positiva — é a exceção autorizada ao uso de verde em botão.

### Formulários
- Label em cima, `text-sm`. Input com `--surface-2`, borda `--border`, foco com ring `--primary`.
- Erro de validação: borda + texto `--danger`, mensagem clara dizendo o que corrigir (ex.: "CPF inválido", "Este celular já está cadastrado").
- Campos obrigatórios marcados. Botão de submit desabilitado enquanto inválido.

### Modais (Dialog)
- Confirmações destrutivas (excluir, sair da conta) e edições rápidas (alterar vencimento/valor).
- Título claro + descrição do efeito + ação primária à direita.

### Navegação (Sidebar)
- Seções agrupadas (GERAL, CLIENTES, FINANCEIRO, CONFIG), igual a referência. Item ativo com fundo `--surface-2` + barra/realce `--primary`.
- Ícone lucide + label. Item "Sair" destacado no rodapé.

### Status de conexão (alerta)
- WhatsApp caído / e-mail com problema: faixa fixa no topo do conteúdo com cor `--danger`/`--warning`, texto direto ("WhatsApp desconectado — reconectar") + ação. Visível, não escondido.

## 6. Escrita (copy) na interface
- Voz ativa, sentence case, sem jargão técnico. O usuário "gerencia cobranças", não "registros".
- Botão diz o que faz: "Dar baixa", "Enviar cobrança", "Salvar alterações" — e o toast confirma no mesmo verbo ("Baixa registrada").
- Erros não pedem desculpa nem são vagos: dizem o que houve e como resolver.
- Vazio é convite à ação, não decoração.

## 7. Acessibilidade (piso de qualidade — não negociável)
- Contraste mínimo AA (texto sobre fundo). Os tokens já respeitam.
- Foco de teclado visível em tudo (ring `--primary`).
- Status nunca comunicado só por cor — sempre acompanha texto/ícone.
- `aria-label` em botões só-ícone. Respeitar `prefers-reduced-motion`.
- Responsivo até mobile (as telas de referência são mobile-first).

## 8. Antipadrões — NÃO fazer
- ❌ Hex solto no código (sempre token).
- ❌ Verde/vermelho em elemento não-financeiro.
- ❌ Gradiente colorido, sombra pesada, borda grossa colorida, emoji como ícone.
- ❌ Tela de loading/erro/vazio sem tratamento.
- ❌ Valor monetário sem `tabular-nums` ou quebrando linha.
- ❌ Caps lock em botões/títulos (só em micro-labels de tabela).
- ❌ "Cara de template" — se o resultado parece o SaaS genérico padrão, revisar.
