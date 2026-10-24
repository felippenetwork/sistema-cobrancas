// Lista do disparo vinda de arquivo (lib/disparo/arquivo-contatos.ts). Dados sintéticos.
import { describe, expect, it } from 'vitest'
import { contatosDeVcf, linhasDeTabela, tabelaDeCsv } from '@/lib/disparo/arquivo-contatos'
import { interpretarLista } from '@/lib/disparo/progressivo'

describe('linhasDeTabela (planilha / CSV)', () => {
  it('com cabeçalho usa as colunas de nome e telefone, mesmo fora de ordem e com colunas extras', () => {
    const r = linhasDeTabela([
      ['E-mail', 'Telefone', 'Nome', 'Cidade'],
      ['maria@exemplo.com', '(21) 99999-0001', 'Maria Souza', 'Rio'],
      ['joao@exemplo.com', 21999990002, 'João', 'Niterói'],
    ])
    expect(r).toEqual({ linhas: ['Maria Souza; 5521999990001', 'João; 5521999990002'], semNumero: 0 })
  })

  it('não confunde CPF de outra coluna com o celular quando há cabeçalho', () => {
    const r = linhasDeTabela([['CPF', 'Nome', 'Celular'], ['12345678901', 'Ana', '21 99999-0003']])
    expect(r.linhas).toEqual(['Ana; 5521999990003'])
  })

  it('exportação do Google: pula a coluna de rótulo do telefone e junta nome e sobrenome', () => {
    const r = linhasDeTabela([
      ['First Name', 'Middle Name', 'Last Name', 'Phone 1 - Label', 'Phone 1 - Value'],
      ['Carla', '', 'Dias', 'Mobile', '+55 21 99999-0004 ::: +55 21 3333-0000'],
    ])
    expect(r.linhas).toEqual(['Carla Dias; 5521999990004'])
  })

  it('sem cabeçalho: número é a primeira célula com celular, nome a primeira com cara de nome', () => {
    const r = linhasDeTabela([
      ['5521999990005', 'Bruno'],
      ['bruno2@exemplo.com', 'Bia', '21999990006'],
      [21999990007],
    ])
    expect(r.linhas).toEqual(['Bruno; 5521999990005', 'Bia; 5521999990006', '5521999990007'])
  })

  it('conta as linhas sem número válido e ignora linhas vazias', () => {
    const r = linhasDeTabela([['Nome', 'Telefone'], ['Sem número', '123'], ['', ''], ['Ok', '21999990008']])
    expect(r).toEqual({ linhas: ['Ok; 5521999990008'], semNumero: 1 })
  })

  it('o resultado é lido pela mesma regra da lista colada à mão', () => {
    const { linhas } = linhasDeTabela([['Nome', 'Celular'], ['Maria; da Silva', '21 99999-0009']])
    expect(interpretarLista(linhas.join('\n')).contatos).toEqual([{ celular: '5521999990009', nome: 'Maria da Silva' }])
  })
})

describe('tabelaDeCsv', () => {
  it('descobre o separador (; do Excel em português) e respeita aspas', () => {
    expect(tabelaDeCsv('Nome;Telefone\r\n"Souza; Maria";21999990001\r\n')).toEqual([
      ['Nome', 'Telefone'], ['Souza; Maria', '21999990001'],
    ])
  })

  it('CSV com vírgula e aspas duplicadas dentro do campo', () => {
    expect(tabelaDeCsv('name,phone\n"Ana ""Aninha""",21999990002')).toEqual([
      ['name', 'phone'], ['Ana "Aninha"', '21999990002'],
    ])
  })
})

describe('contatosDeVcf (agenda do celular)', () => {
  it('lê FN e o primeiro telefone válido de cada contato', () => {
    const vcf = [
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:Maria Souza', 'TEL;TYPE=CELL:+55 21 99999-0001', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:3.0', 'N:Silva;João;;;', 'TEL:123', 'item1.TEL:21999990002', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:Sem telefone', 'END:VCARD',
    ].join('\r\n')
    expect(contatosDeVcf(vcf)).toEqual({ linhas: ['Maria Souza; 5521999990001', 'João Silva; 5521999990002'], semNumero: 1 })
  })

  it('decodifica nome em quoted-printable (Android antigo) e linhas dobradas', () => {
    const vcf = 'BEGIN:VCARD\nVERSION:2.1\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jo=C3=A3o\nTEL;CELL:2199999\n 0003\nEND:VCARD'
    expect(contatosDeVcf(vcf).linhas).toEqual(['João; 5521999990003'])
  })
})
