---
name: pronto-para-vender
description: Checklist de maturidade comercial do Cobranx — tudo que um SaaS precisa ter, além de código funcionando, para ser vendido com credibilidade e sem risco legal ao Felippe: páginas legais (Termos, Privacidade), cancelamento de assinatura autoatendimento, identidade em e-mails/domínio, SEO básico, páginas de erro com marca, favicon, e nota fiscal. Use quando o pedido for "está pronto para lançar/vender?", ao revisar o produto antes de divulgar, ou ao criar qualquer página/fluxo institucional (não é dashboard interno). Não substitui `design-system` (como fica) nem `seguranca-cobranx` (proteção técnica) — cobre o que falta para além do produto funcionar.
---

# Pronto para Vender — maturidade comercial do Cobranx

Um SaaS "pronto para vender" não é só "o código funciona". É a soma de três coisas que o cliente avalia nos primeiros 2 minutos, mesmo sem saber nomear: **parece sério** (design + copy — skills `design-system` e `copywriting-conversao`), **é seguro** (skill `seguranca-cobranx`) e **é legítimo** (esta skill: tem CNPJ visível, tem termos, dá para cancelar sozinho, não parece que vai sumir com o dinheiro). Faltar qualquer uma das três derruba a confiança nas outras duas.

## 1. Páginas legais (obrigatório, não opcional, mesmo para MVP)

O Cobranx processa dado pessoal de terceiros (o devedor, que nunca deu consentimento diretamente ao Cobranx) e cobra assinatura recorrente — dois motivos concretos, não burocráticos, para isso existir antes do primeiro cliente pagante:

- **Termos de Uso — não existe ainda (`app/termos` não existe).** Precisa cobrir: o que o Cobranx é, o que o cliente pode/não pode fazer com ele (ex.: proibido usar para spam/cobrança de dívida ilegítima), como funciona o cancelamento, limitação de responsabilidade sobre o WhatsApp (o Cobranx não é o WhatsApp/Meta, e um ban de número não é garantido contra apesar da régua anti-ban). Prioridade alta — falta total, não só desatualização.
- **Política de Privacidade — já existe em `app/privacidade/page.tsx`** e o conteúdo é razoável (dados coletados, LGPD, retenção de 90 dias, contato). **Mas está fora do padrão visual**: usa `style={}` inline com tema claro (fundo branco, `#222`/`#666`), não os tokens do `design-system` (tema dark) nem Tailwind — reestilizar ao tocar essa página é trabalho de design, não de conteúdo. Verificar também se o texto ainda reflete a realidade (ex.: menciona só "WhatsApp Business API (Meta)" — atualizar para citar também uazapi e os provedores de pagamento reais, EfiBank e Mercado Pago, já que a política promete listar "prestadores de serviços essenciais").
- **`[CONFIRMAR com o Felippe]`** Precisa de contrato/Termos de Uso assinado com o dono da conta explicitando que ELE é o responsável pelo conteúdo das mensagens enviadas via Cobranx (o Cobranx é a ferramenta, não quem decide cobrar)? Recomendável para produtos de cobrança — reduz exposição jurídica do Cobranx se um cliente usar a ferramenta de forma abusiva.
- Link para os dois documentos: rodapé de toda página institucional + tela de cadastro (ver skill `design-system` §7, seção "Cadastro").
- Nunca copiar termos de outro SaaS palavra por palavra — além de ilegal (direito autoral), o texto de outro produto não reflete a realidade do Cobranx (ex.: menção a "cartão de crédito armazenado" quando o Cobranx nunca toca dado de cartão).

## 2. Identificação da empresa (exigência legal simples, sinal de confiança)

- CNPJ (ou CPF, se MEI/pessoa física) e razão social visíveis no rodapé institucional — ausência disso é o sinal nº 1 de "site não confiável" para quem vai pagar recorrência.
- Canal de contato/suporte real e monitorado (e-mail próprio do domínio, não um Gmail pessoal) — reforça a skill `copywriting-conversao` sobre e-mail transacional vir de remetente identificável.
- Endereço ou cidade/UF de operação, mesmo que resumido.

## 3. Cancelamento de assinatura autoatendimento

- O dono da conta consegue cancelar a própria assinatura de dentro do produto, sem precisar pedir por e-mail/WhatsApp. Fluxo escondido ou que exige contato manual é dark pattern reconhecido — e já é crime em algumas jurisdições cobrar por serviço sem oferecer cancelamento tão fácil quanto a contratação (CDC, princípio da boa-fé e da informação clara).
- Ao cancelar: confirmação clara do que acontece (quando o acesso para, se os dados continuam disponíveis para exportação — ver ciclo de vida de conta suspensa/excluída na skill `isolamento-de-contas`).
- `[A DEFINIR]` Existe fluxo de "downgrade" ou só cancelamento total? Ver skill `regras-financeiras` §10.

## 4. E-mails transacionais com identidade real

- Remetente com domínio próprio (`naoresponda@cobranx.site` ou equivalente, não um Gmail genérico) — cai menos em spam e passa credibilidade.
- Template visual mínimo consistente com a marca (logo, cor primária do `design-system`), não texto puro sem formatação.
- SPF/DKIM/DMARC configurados no domínio de envio (Resend já ajuda nisso, mas confirmar configuração de DNS) — e-mail que cai em spam nunca converte nem confirma pagamento a tempo.

## 5. SEO e presença básica (para quem chega pela busca ou por link)

- `<title>` e meta description específicos por página (nunca o default do framework).
- Open Graph (`og:title`, `og:description`, `og:image`) — link do Cobranx compartilhado no WhatsApp/LinkedIn tem que mostrar um card decente, não um retângulo cinza.
- Favicon de marca (não o ícone padrão do Next.js) — detalhe pequeno, mas ausência dele é o tipo de coisa que grita "não terminado".
- `sitemap.xml` e `robots.txt` básicos se houver intenção de tráfego orgânico.

## 6. Páginas de erro com marca

- 404 e erro genérico (`error.tsx` do Next) com a mesma identidade visual do resto do produto (skill `design-system`) e um caminho de volta (link pro dashboard ou pra home) — página de erro crua do framework é a evidência mais rápida de "projeto amador" para quem cai nela.

## 7. Prova de confiabilidade financeira (sem mentir — ver `design-system` §6)

- Se ainda não há clientes/depoimentos reais suficientes para prova social, a landing NÃO inventa números — usa outras âncoras de confiança legítimas: explicação clara de como o dado é protegido, transparência sobre não guardar dado de cartão, link ativo para os Termos/Privacidade, e a segurança "real" da skill `seguranca-cobranx` sendo visivelmente aplicada (HTTPS, headers) mesmo que não anunciada com selo.
- Assim que houver clientes reais dispostos a depor, migrar para prova social real — nunca pular essa etapa inventando.

## 8. Nota fiscal / recibo da assinatura

- `[CONFIRMAR com o Felippe]` O Mercado Pago Preapproval emite recibo automaticamente, ou o Cobranx precisa emitir nota fiscal de serviço para quem assina o plano? Depende do regime tributário do Felippe (MEI/Simples) — isso não é decisão técnica, é decisão contábil/legal que precisa vir de fora desta conversa antes de cobrar em produção com volume.

## Checklist consolidado — antes de divulgar o produto para vender

- [ ] Termos de Uso e Política de Privacidade publicados e linkados no cadastro + rodapé?
- [ ] CNPJ/razão social e contato real visíveis no rodapé institucional?
- [ ] Cancelamento de assinatura funciona de dentro do produto, sem contato manual?
- [ ] E-mails transacionais saem de domínio próprio, com template de marca e SPF/DKIM/DMARC configurados?
- [ ] Meta tags, Open Graph, favicon e páginas 404/erro com identidade do Cobranx?
- [ ] Nenhuma prova social ou número inventado na landing (skill `design-system` §6)?
- [ ] Emissão de nota fiscal/recibo da assinatura resolvida com o Felippe (não assumida)?
- [ ] Copy da landing e do onboarding passou pelas skills `copywriting-conversao` e `revisao-portugues`?
