// Template HTML base para e-mails de cobrança.
// Regras (notificacoes-fila §2, §8):
//   • Todo e-mail DEVE ter link de unsubscribe no rodapé.
//   • Variáveis (#VALOR#, #NOME# etc.) são substituídas pelo worker antes de chamar esta função.
//
// Esta função recebe o conteúdo já processado e envolve no HTML base.

/** Gera o HTML completo do e-mail a partir do conteúdo já com variáveis substituídas. */
export function gerarEmailHTML({
  assunto,
  conteudo,
  fromName,
  unsubscribeUrl,
}: {
  assunto:        string
  conteudo:       string       // pode conter \n (convertido para <br>)
  fromName:       string
  unsubscribeUrl: string
}): string {
  const corpoHTML = conteudo
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')

  return /* html */ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${assunto}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #F4F5F7; font-family: Arial, Helvetica, sans-serif; }
    .wrap { max-width: 560px; margin: 24px auto; background: #ffffff;
            border-radius: 8px; overflow: hidden;
            border: 1px solid #E2E8F0; }
    .header { background: #0B0F17; padding: 20px 28px; }
    .header-name { color: #E6EAF2; font-size: 16px; font-weight: 600; }
    .body { padding: 28px; color: #1A202C; font-size: 15px; line-height: 1.65; }
    .footer { padding: 16px 28px; background: #F7FAFC; border-top: 1px solid #E2E8F0;
              font-size: 12px; color: #718096; }
    .footer a { color: #718096; text-decoration: underline; }
    @media (max-width: 600px) {
      .wrap { margin: 0; border-radius: 0; border: none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="header-name">${fromName}</div>
    </div>
    <div class="body">${corpoHTML}</div>
    <div class="footer">
      <p>Este e-mail foi enviado por <strong>${fromName}</strong>.</p>
      <p style="margin-top:8px;">
        Para não receber mais e-mails desta empresa,
        <a href="${unsubscribeUrl}">clique aqui para se descadastrar</a>.
      </p>
    </div>
  </div>
</body>
</html>`
}

// ── Utilitários de local_part ────────────────────────────────────────────────

/**
 * Sanitiza o local_part do remetente:
 * lowercase, remove acentos, mantém apenas [a-z0-9.-], sem pontos duplos
 * nem ponto/hífen no início ou fim.
 */
export function sanitizarLocalPart(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // remove diacríticos
    .replace(/[^a-z0-9.-]/g, '')        // apenas chars válidos
    .replace(/\.{2,}/g, '.')             // sem pontos duplos
    .replace(/^[.-]+|[.-]+$/g, '')       // sem . ou - no início/fim
}

/** Substitui as variáveis do template pelo valor real. */
export function substituirVariaveis(
  template: string,
  vars: {
    valor:       string
    nomecompleto: string
    nome:        string
    pix:         string
    saudacao:    string
    vencimento:  string
  },
): string {
  return template
    .replace(/#VALOR#/g,        vars.valor)
    .replace(/#NOMECOMPLETO#/g, vars.nomecompleto)
    .replace(/#NOME#/g,         vars.nome)
    .replace(/#PIX#/g,          vars.pix)
    .replace(/#SAUDACAO#/g,     vars.saudacao)
    .replace(/#VENCIMENTO#/g,   vars.vencimento)
}
