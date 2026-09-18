---
name: revisao-portugues
description: Revisor de português brasileiro sênior — ortografia, gramática, concordância, crase, pontuação e consistência de tom em TODO texto voltado ao usuário final ou ao cliente do usuário. Use SEMPRE que escrever ou revisar texto de interface (labels, botões, mensagens de erro, empty states), e-mail transacional, mensagem/template de WhatsApp, landing page, ou qualquer copy nova — mesmo uma frase curta. Erro de português num produto financeiro é lido como falta de seriedade, não como detalhe.
---

# Revisão de Português — Cobranx

Produto financeiro sério não erra português. Um "a nível de", um "pra frente" numa mensagem de cobrança, um "houveram" no rodapé — cada um desses é um sinal de amadorismo que custa credibilidade, exatamente como um botão quebrado ou um cálculo errado. Diferente de bug de código, erro de português não aparece no `tsc --noEmit`: só a revisão pega.

## Quando esta skill entra

Todo texto que um humano vai LER nesta ordem de prioridade (erro custa mais caro do topo pra baixo):
1. Mensagem de cobrança (WhatsApp/e-mail) — vai para o cliente do cliente, é a cara do negócio dele.
2. Landing page e página de preços — decide se alguém compra.
3. E-mail transacional (boas-vindas, confirmação, recuperação de senha).
4. Interface do produto (labels, botões, toasts, empty states, erros).
5. Documentação interna, comentário de código, commit — importa menos, mas concordância básica ainda vale.

## Revisão obrigatória antes de entregar qualquer texto novo

1. **Ler em voz alta (mentalmente, mas frase por frase).** Erro de concordância quase sempre soa errado antes de parecer errado escrito.
2. **Checar os erros mais comuns do português brasileiro escrito rápido** (lista abaixo) — não confiar em "parece certo".
3. **Reler o texto isolado do código.** Copy dentro de JSX se esconde entre chaves e aspas — extrair mentalmente só a frase e julgar como frase, não como string.
4. **Comparar o tom com o resto do produto** (ver skill `copywriting-conversao` para o guia de voz) — mesmo sem erro gramatical, um texto fora do tom quebra a consistência que transmite confiança.

## Os erros que mais aparecem em texto gerado rápido (checar sempre)

### Concordância
- Verbal: sujeito composto pede plural ("O cliente e a cobrança **foram** atualizados", não "foi"). Sujeito com "a maioria/parte de" concorda com o núcleo ou com o coletivo — checar caso a caso, nunca no automático.
- Nominal: "a cobrança está **pronta**" (não "pronto"); "as duas **primeiras** parcelas" (não "primeira").
- **"Haver" no sentido de existir é impessoal — nunca flexiona no plural:** "**Houve** 3 pagamentos" (nunca "houveram"). "Fazem" nesse mesmo sentido de tempo também é impessoal: "**Faz** 2 dias" (nunca "fazem 2 dias").

### Crase
- Só existe antes de palavra feminina que aceitaria "a" (artigo) + "a" (preposição): "Enviar **à** cliente" só se "cliente" for tratada no feminino explícito no contexto; "Enviar **para o** cliente" evita a dúvida inteira — na prática, prefira reescrever para evitar crase ambígua em copy de produto.
- Nunca antes de verbo, nunca antes de palavra masculina: "a partir de amanhã" (nunca "à partir de").

### Pares que trocam sentido
- **Mal / Mau:** "mal" é advérbio ou oposto de "bem" ("a cobrança foi **mal** paga" — ok, mas incomum); "mau" é adjetivo, oposto de "bom" ("um **mau** pagador"). Em copy de produto financeiro, evitar "mau pagador" mesmo correto — é copy hostil (ver skill `copywriting-conversao`).
- **Porque / por que / por quê / porquê:** junto e sem acento = resposta/causa ("não pagou **porque** esqueceu"); separado sem acento = pergunta direta ou equivalente a "pelo qual" ("**por que** o pagamento falhou?"); separado com acento = fim de frase interrogativa ("não sei **por quê**"); junto com acento = substantivo ("o **porquê** do atraso").
- **Onde / aonde:** "onde" é lugar fixo ("**onde** está a fatura"); "aonde" implica movimento/destino ("**aonde** o link leva").
- **Este/esse/aquele:** "este" para o que está perto de quem fala ou vem a seguir no texto; "esse" para o que está perto de quem ouve ou já foi mencionado. Em copy, "esse" costuma soar mais natural ("**Essa** cobrança vence amanhã").
- **Seu/sua ambíguo:** português permite "seu" referir-se a "de você" OU "dele/dela" — em mensagem automática para o cliente final, isso pode confundir quem lê ("**seu** saldo" — do remetente ou do destinatário?). Preferir explicitar quando a mensagem for automática e sem contexto de conversa: "o saldo da sua conta" deixa claro que é do destinatário.
- **Seção / sessão / cessão:** "seção" é parte de um texto/loja; "sessão" é período de tempo/reunião; "cessão" é ato de ceder. Erro comum e nunca pego por corretor automático porque as três existem.

### Pontuação e formatação
- Vírgula não separa sujeito do verbo: "O cliente que não pagou, receberá um lembrete" está errado — "que não pagou" é restritivo, sem vírgula.
- Reticências (`...`) só quando o sentido pede suspensão real — nunca como enfeite no fim de frase de UI ("Carregando..." é aceitável como convenção de loading, mas "Sua cobrança foi criada..." não).
- Aspas retas (`"`) em código, aspas curvas (`" "`) em texto renderizado quando o design pedir tipografia cuidada.

### Formalidade e registro
- Produto financeiro fala com o dono da conta (quem cobra) em tom direto e profissional, sem gírias ("beleza", "valeu"), mas também sem formalidade empolada ("outrossim", "faz-se necessário").
- Mensagem para o cliente final (quem deve) é ainda mais neutra e respeitosa — nunca informal a ponto de soar como cobrança de agiota, nunca hostil ("Você não pagou!" vira "Identificamos que o pagamento de [valor] ainda não foi confirmado").
- Consistência de tratamento: escolher "você" em todo o produto (não misturar com "tu" ou formas de tratamento indireto como "o cliente deverá") e manter em toda a base de textos.

## Nomes próprios e termos fixos do produto (nunca variar)

Conferir sempre contra o que já existe no código/skills antes de escrever um novo texto — nome de marca, nome de plano, nome de status errado por variação de escrita quebra a sensação de sistema cuidado:
- Marca do produto: **Cobranx** (nunca "Cobrança X", "CobranX" ou variação).
- Status: usar exatamente os rótulos definidos na skill `design-system` (Pago, Vencido, A vencer...) — nunca sinônimo criado na hora ("Atrasado" em vez de "Vencido").

## Revisão específica por tipo de texto

- **Mensagem de cobrança/WhatsApp:** zero erro tolerável — é a mensagem mais lida e mais escrutinada pelo cliente final. Reler simulando ser o destinatário: soa profissional ou soa cobrança de calote?
- **E-mail transacional:** assunto e corpo revisados juntos — assunto errado quebra a confiança antes de abrir o e-mail.
- **UI (botões, labels, toasts):** textos curtos escondem erro fácil ("Cancelar notificaçao" sem til passa despercebido em review rápido) — revisar palavra por palavra em textos de 1-3 palavras, não só em frases longas.
- **Landing page:** maior volume de texto, maior risco — revisar em blocos (hero, features, preços, footer) separadamente, não tudo de uma vez.

## Checklist antes de entregar qualquer texto novo

- [ ] Li a frase isolada do código, como um leitor leria?
- [ ] Concordância verbal e nominal conferidas (incluindo "haver"/"fazer" impessoais)?
- [ ] Crase revisada — e evitada por reescrita quando ambígua?
- [ ] Nenhum dos pares confundíveis (mal/mau, porque/por que, onde/aonde, este/esse, seção/sessão) usado errado?
- [ ] Tom consistente com o resto do produto (nem gíria, nem formalidade empolada)?
- [ ] Nome de marca, plano e status exatamente como já estabelecido em outro lugar do produto?
- [ ] Texto de UI curto revisado palavra por palavra, não só por leitura corrida?
