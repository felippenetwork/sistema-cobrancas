---
name: copywriting-conversao
description: Redator publicitário sênior especializado em SaaS e produtos financeiros — copy que vende sem soar genérico ou "gerado por IA": headline de landing page, página de preços, e-mail transacional, microcopy de onboarding e mensagem de cobrança ao cliente final. Use SEMPRE que escrever ou revisar qualquer texto voltado a converter (landing, pricing, e-mail de venda) ou a comunicar (e-mail transacional, mensagem WhatsApp, microcopy de produto). Trabalha em conjunto com `design-system` (onde o texto aparece) e `revisao-portugues` (se o texto está correto) — esta skill decide o que dizer e como convencer.
---

# Copywriting e Conversão — Cobranx

Todo texto de venda genérico soa igual: "A melhor solução para o seu negócio", "Simplifique sua gestão", "Transforme a forma como você trabalha". Ninguém lê essas frases duas vezes porque elas não dizem nada específico. Copy que vende fala do problema real de quem cobra clientes por WhatsApp e do resultado concreto — não do produto em abstrato.

## Princípio central: específico vence genérico, sempre

- Nunca "gerencie suas cobranças com facilidade" → sempre "pare de perder tempo cobrando manualmente no WhatsApp — o Cobranx lembra o cliente por você, no horário certo, sem parecer spam".
- Todo benefício vem com o mecanismo concreto por trás ("nunca mais esqueça de cobrar" É verdade porque "a régua dispara sozinha 5, 3, 2, 1 dia antes e no vencimento" — a segunda frase prova a primeira).
- Número real vale mais que adjetivo: "reduza a inadimplência" é vago; "clientes que usam régua automática recebem X% mais rápido" (só usar se for um dado real e verificável — ver skill `design-system` §6 sobre prova social).
- Nunca prometer o que o produto não faz hoje: se a baixa é manual (ver skill `regras-financeiras`), a copy não promete "conciliação automática".

## Voz e tom (consistente em todo o produto)

- **Direto, profissional, sem gíria e sem jargão técnico.** O usuário do Cobranx é dono de pequeno negócio cobrando clientes — não é um time de engenharia. "Cobranças" e "clientes", nunca "registros" e "entidades".
- **Confiante sem ser hiperbólico.** "O jeito mais simples de nunca mais esquecer uma cobrança" é confiante; "A ferramenta REVOLUCIONÁRIA que vai MUDAR seu negócio PARA SEMPRE" é ruído que o leitor já aprendeu a ignorar.
- **Ativa, nunca passiva.** "Enviamos o lembrete automaticamente" (não "o lembrete é enviado automaticamente").
- Consultar a skill `revisao-portugues` para tom de tratamento (você) e formalidade — copy de venda pode ser um pouco mais quente que copy de produto, mas nunca informal a ponto de soar amador.

## Landing page e página de preços

Ver skill `design-system` §6 para as regras visuais (hero, features, footer, prova social real). Regras de TEXTO especificamente:

- **Headline do hero:** uma frase que nomeia quem é o cliente ideal e o resultado que ele quer — fórmula útil: "[Resultado específico] sem [dor específica que ele já sente]". Ex.: "Cobre seus clientes pelo WhatsApp sem parecer chato nem esquecer ninguém" bate muito mais forte que "A melhor plataforma de cobrança do Brasil".
- **Subheadline:** explica O MECANISMO em uma frase — como o produto entrega a promessa do headline.
- **CTA (botão de ação):** verbo + resultado, nunca genérico. "Criar minha conta grátis" > "Começar agora" > "Saiba mais" (o pior CTA possível — não diz o que acontece ao clicar).
- **Seção de features:** cada bloco segue "o que é → o que isso resolve", nunca só o nome da feature. "Régua de cobrança automática — o cliente recebe lembrete no dia certo, você para de mandar mensagem manual toda manhã."
- **Página de preços:** valor de cada plano justificado por quem ele serve ("Para quem está começando" / "Para quem já tem uma carteira de clientes"), nunca só número e lista de features idêntica entre planos com um item riscado.
- **Objeções antecipadas:** uma seção curta de FAQ ou texto que responde a dúvida real antes que o visitante saia pra procurar em outro lugar ("Meu número de WhatsApp corre risco de ser banido?" — responder com a régua anti-ban real da skill `whatsapp-uazapi`, não "não se preocupe").

## E-mails transacionais

Cada e-mail tem UM objetivo — nunca misturar "bem-vindo" com "veja essas outras features".

- **Boas-vindas:** confirma o que a pessoa acabou de fazer + próximo passo único e claro ("Conecte seu WhatsApp para começar a cobrar automaticamente" com botão direto para `/conexao`).
- **Confirmação de pagamento (assinatura ou PIX do cliente final):** confirma valor, data e o que isso desbloqueia/resolve — nunca só "Pagamento recebido, obrigado".
- **Recuperação de senha:** direto ao ponto, sem venda dentro do e-mail de segurança ("Clique para redefinir sua senha. Se não foi você, ignore este e-mail.").
- **Assunto do e-mail:** específico, nunca clickbait. "Sua cobrança de R$ 450,00 venceu ontem" bate mais que "Atenção: pendência!".
- Assinatura/rodapé com nome real da empresa remetente (dado da conta, ver skill `pronto-para-vender`) — e-mail sem identificação clara de quem envia parece spam.

## Mensagens de cobrança ao cliente final (WhatsApp/e-mail)

Este é o texto mais delicado do produto: fala em nome do dono da conta para o cliente dele. Ver variáveis disponíveis na skill `notificacoes-fila`.

- **Antes do vencimento:** tom de lembrete útil, não de cobrança. "Oi #NOME#! Passando para lembrar que sua mensalidade de #VALOR# vence dia #VENCIMENTO#."
- **No vencimento/vencida:** direto mas respeitoso, nunca acusatório. "Identificamos que o pagamento de #VALOR#, com vencimento em #VENCIMENTO#, ainda está em aberto." — nunca "Você está devendo" ou "Pague agora ou...".
- **Confirmação de pagamento:** tom de agradecimento simples, fecha o ciclo. "Recebemos seu pagamento de #VALOR#. Obrigado!"
- Nunca emoji em excesso (zero a um, se fizer sentido ao tom da conta — ver proibição de emoji em UI na skill `design-system`, mas mensagem de WhatsApp pode ter um humano por trás, então a régua aqui é "com moderação", não "proibido").
- Template é ponto de personalização da conta (o dono pode editar) — a skill garante o PADRÃO de fábrica bom, não impede customização.

## Microcopy de produto (onboarding, vazio, confirmação)

- **Onboarding:** cada passo diz o benefício de completá-lo, não só a ação. "Conecte seu WhatsApp — é como você vai enviar as cobranças automaticamente" > "Conectar WhatsApp".
- **Empty state:** convite específico à primeira ação, nunca genérico. "Nenhuma cobrança criada ainda. Crie a primeira e comece a receber no automático." > "Nenhum dado encontrado."
- **Confirmação de ação:** confirma o que mudou, no mesmo verbo do botão que disparou a ação (ver skill `design-system` §8).

## Erros de copy que soam a "gerado por IA" (evitar sempre)

"Desbloqueie todo o potencial", "leve seu negócio para o próximo nível", "solução completa e definitiva", "revolucione" (qualquer superlativo sem prova), pergunta retórica vazia no meio do texto ("Já pensou em nunca mais perder uma cobrança?"), lista de 3 bullets idênticos em estrutura e tamanho, qualquer frase que poderia estar em qualquer produto SaaS do mundo trocando só o nome da marca — se a frase serve pra vender café e pra vender o Cobranx sem mudar uma palavra, ela é genérica demais e não vende nada.

## Checklist antes de publicar qualquer copy nova

- [ ] O texto é específico do Cobranx/cobrança-por-WhatsApp, ou serviria pra qualquer SaaS trocando o nome?
- [ ] Todo benefício vem com o mecanismo real por trás (nada prometido que o produto não faz)?
- [ ] CTA diz o resultado da ação, não um verbo vago?
- [ ] Tom consistente com o resto do produto (nem informal demais, nem hiperbólico)?
- [ ] Mensagem ao cliente final é respeitosa, nunca acusatória?
- [ ] Passou pela skill `revisao-portugues` antes de publicar?
- [ ] Prova social ou número citado é real e verificável (skill `design-system` §6)?
