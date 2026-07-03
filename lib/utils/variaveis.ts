// Substituição de variáveis de template compartilhada pelo app (Next.js).
// O worker mantém sua própria cópia em worker/src/variaveis.ts porque é um
// processo Node.js separado que não pode importar daqui (paths, ESM, tipos distintos).
// Ao adicionar nova variável: atualizar ambos os arquivos.

export function substituirVariaveis(
  template: string,
  vars: { valor: string; nomecompleto: string; nome: string; pix: string; saudacao: string; vencimento: string },
): string {
  return template
    .replace(/#VALOR#/g,        vars.valor)
    .replace(/#NOMECOMPLETO#/g, vars.nomecompleto)
    .replace(/#NOME#/g,         vars.nome)
    .replace(/#PIX#/g,          vars.pix)
    .replace(/#SAUDACAO#/g,     vars.saudacao)
    .replace(/#VENCIMENTO#/g,   vars.vencimento)
}
