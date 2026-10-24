// Lista do disparo vinda de arquivo (/disparos, progressivo): planilha (.xlsx), CSV, vCard (.vcf,
// exportado da agenda do celular) ou .txt. Tudo vira linhas "Nome; número" — o mesmo formato que
// a pessoa cola à mão e que interpretarLista() lê. Puro, sem DOM: testado em
// tests/disparo-arquivo-contatos.test.ts. A leitura do .xlsx em si (read-excel-file) fica no
// componente, que só passa as linhas da planilha para linhasDeTabela().
import { normalizarCelular } from './progressivo'

/** Valor de uma célula: texto ou número importam; data, booleano e vazio são ignorados. */
export type Celula = unknown

export type ResultadoArquivo = { linhas: string[]; semNumero: number }

const TRECHO_NUMERO = /[+(]?\d[\d\s().-]{7,}\d/
const CABECALHO_NOME = /nome|name|cliente/i
const CABECALHO_TELEFONE = /cel|tel|fone|phone|whats|n[uú]mero|mobile/i

/** Primeiro número de celular válido dentro do texto ("+55 21 99999-0001 ::: …" → 5521999990001). */
function celularDe(valor: Celula): string | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null
  const texto = typeof valor === 'number' ? String(Math.trunc(valor)) : valor
  const trecho = texto.match(TRECHO_NUMERO)
  return trecho ? normalizarCelular(trecho[0]) : null
}

function textoDe(valor: Celula): string {
  return typeof valor === 'string' ? valor.replace(/[;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() : ''
}

/** Célula que parece nome: tem letra, não é e-mail nem número. */
function pareceNome(valor: Celula): boolean {
  const t = textoDe(valor)
  return /\p{L}/u.test(t) && !t.includes('@') && !celularDe(t)
}

/**
 * Linhas de uma planilha/CSV → "Nome; número". Com cabeçalho (primeira linha sem número e com
 * "nome"/"telefone"/"celular"…), usa as colunas certas — em exportações com várias colunas de
 * telefone (a do Google traz "Phone 1 - Label" e "Phone 1 - Value") vale a primeira que tiver um
 * número válido. Sem cabeçalho: o número é a primeira célula com celular válido e o nome, a
 * primeira com cara de nome.
 */
export function linhasDeTabela(tabela: readonly (readonly Celula[])[]): ResultadoArquivo {
  const linhasValidas = tabela.filter(l => l.some(c => textoDe(c) || typeof c === 'number'))
  if (!linhasValidas.length) return { linhas: [], semNumero: 0 }

  const primeira = linhasValidas[0]
  const temCabecalho = !primeira.some(c => celularDe(c))
    && primeira.some(c => CABECALHO_NOME.test(textoDe(c)) || CABECALHO_TELEFONE.test(textoDe(c)))
  const titulos = temCabecalho ? primeira.map(textoDe) : []
  const colunasTelefone = titulos.flatMap((t, i) => (CABECALHO_TELEFONE.test(t) ? [i] : []))
  // "Nome" exato ganha de "Nome da empresa"; senão o primeiro título com nome.
  const colunaNome = titulos.findIndex(t => /^(nome|name)$/i.test(t)) >= 0
    ? titulos.findIndex(t => /^(nome|name)$/i.test(t))
    : titulos.findIndex(t => CABECALHO_NOME.test(t) && !CABECALHO_TELEFONE.test(t))
  // Exportação do Google separa "First Name" e "Last Name": junta os dois.
  const colunaSobrenome = titulos.findIndex(t => /^(last name|sobrenome)$/i.test(t))

  const linhas: string[] = []
  let semNumero = 0
  for (const linha of temCabecalho ? linhasValidas.slice(1) : linhasValidas) {
    const celular = colunasTelefone.map(i => celularDe(linha[i])).find(Boolean) ?? linha.map(celularDe).find(Boolean)
    if (!celular) { semNumero++; continue }
    let nome = colunaNome >= 0 ? textoDe(linha[colunaNome]) : textoDe(linha.find(pareceNome))
    if (colunaNome >= 0 && colunaSobrenome >= 0 && /first name/i.test(titulos[colunaNome])) {
      nome = `${nome} ${textoDe(linha[colunaSobrenome])}`.trim()
    }
    linhas.push(nome ? `${nome}; ${celular}` : celular)
  }
  return { linhas, semNumero }
}

/** Separa um CSV respeitando aspas; o separador (; , tab |) é o mais frequente nas primeiras linhas. */
export function tabelaDeCsv(texto: string): string[][] {
  const amostra = texto.split(/\r?\n/).slice(0, 5).join('\n')
  const separador = [';', ',', '\t', '|']
    .map(s => ({ s, n: amostra.split(s).length }))
    .sort((a, b) => b.n - a.n)[0].s

  const tabela: string[][] = []
  let linha: string[] = []
  let celula = ''
  let aspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { celula += '"'; i++ }
      else if (c === '"') aspas = false
      else celula += c
    } else if (c === '"' && !celula) aspas = true
    else if (c === separador) { linha.push(celula); celula = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      linha.push(celula); tabela.push(linha); linha = []; celula = ''
    } else celula += c
  }
  if (celula || linha.length) { linha.push(celula); tabela.push(linha) }
  return tabela
}

function decodificarQuotedPrintable(valor: string): string {
  const bytes: number[] = []
  const limpo = valor.replace(/=\r?\n/g, '')
  for (let i = 0; i < limpo.length; i++) {
    if (limpo[i] === '=' && /^[0-9A-F]{2}$/i.test(limpo.slice(i + 1, i + 3))) {
      bytes.push(parseInt(limpo.slice(i + 1, i + 3), 16)); i += 2
    } else bytes.push(limpo.charCodeAt(i))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** vCard (agenda exportada do celular): FN (ou N) e o primeiro TEL válido de cada contato. */
export function contatosDeVcf(texto: string): ResultadoArquivo {
  // Linhas dobradas do vCard (continuação começa com espaço) voltam a ser uma só.
  const desdobrado = texto.replace(/\r?\n[ \t]/g, '')
  const linhas: string[] = []
  let semNumero = 0
  for (const bloco of desdobrado.split(/BEGIN:VCARD/i).slice(1)) {
    let nome = ''
    let nomeEstruturado = ''
    let celular: string | null = null
    for (const linha of bloco.split(/\r?\n/)) {
      const doisPontos = linha.indexOf(':')
      if (doisPontos < 0) continue
      const chave = linha.slice(0, doisPontos)
      let valor = linha.slice(doisPontos + 1)
      if (/ENCODING=QUOTED-PRINTABLE/i.test(chave)) valor = decodificarQuotedPrintable(valor)
      const campo = chave.split(';')[0].replace(/^item\d+\./i, '').toUpperCase()
      if (campo === 'FN') nome = valor.trim()
      else if (campo === 'N') nomeEstruturado = valor.split(';').slice(0, 2).reverse().join(' ').trim()
      else if (campo === 'TEL' && !celular) celular = celularDe(valor)
    }
    if (!celular) { semNumero++; continue }
    const final = textoDe(nome || nomeEstruturado)
    linhas.push(final ? `${final}; ${celular}` : celular)
  }
  return { linhas, semNumero }
}
