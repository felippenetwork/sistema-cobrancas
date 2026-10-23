// Extração de contatos de grupo/comunidade (lib/disparo/extracao.ts), com grupos no formato real
// da uazapi (confirmado em 2026-10-23) e dados sintéticos.
import { describe, expect, it } from 'vitest'
import { extrairContatos, paraLinhas, primeiroNome, resumirGrupos } from '@/lib/disparo/extracao'
import type { UazapiGrupo } from '@/lib/uazapi'

const pn = (n: string) => `55219999${n}@s.whatsapp.net`
const tel = (n: string) => `55219999${n}`

function grupo(jid: string, nome: string, perfis: { n: string | null; name?: string }[], extra: Partial<UazapiGrupo> = {}): UazapiGrupo {
  return {
    JID: jid, Name: nome, ParticipantCount: perfis.length, IsParent: false, LinkedParentJID: '', IsAnnounce: false,
    Participants: perfis.map((p, i) => ({ JID: `${i}@lid`, PhoneNumber: p.n ? pn(p.n) : '', DisplayName: '' })),
    participant_profiles: perfis.map((p, i) => ({ jid: `${i}@lid`, pn: p.n ? pn(p.n) : '', lid: `${i}@lid`, name: p.name })),
    ...extra,
  }
}

const GRUPOS: UazapiGrupo[] = [
  grupo('g1@g.us', 'Vendas', [{ n: '0001', name: 'Maria Souza' }, { n: '0002' }, { n: null, name: 'Oculto' }, { n: '0099', name: 'Eu mesmo' }]),
  grupo('com@g.us', 'Comunidade Bairro', [{ n: '0003' }], { IsParent: true }),
  grupo('sub1@g.us', 'Avisos', [{ n: '0004', name: '🔥João Silva' }, { n: '0001', name: 'Maria Souza' }], { LinkedParentJID: 'com@g.us', IsAnnounce: true }),
  grupo('sub2@g.us', 'Conversa', [{ n: '0005', name: 'Ana' }], { LinkedParentJID: 'com@g.us' }),
]

describe('lista de grupos para escolher', () => {
  it('comunidades primeiro, somando os membros dos subgrupos (sem repetir número)', () => {
    const [primeiro] = resumirGrupos(GRUPOS)
    expect(primeiro).toMatchObject({ jid: 'com@g.us', tipo: 'comunidade', comTelefone: 4 }) // 0003, 0004, 0001, 0005
  })

  it('subgrupo mostra a comunidade a que pertence; grupo conta quem não tem telefone visível', () => {
    const resumo = resumirGrupos(GRUPOS)
    expect(resumo.find(g => g.jid === 'sub1@g.us')?.comunidade).toBe('Comunidade Bairro')
    expect(resumo.find(g => g.jid === 'g1@g.us')).toMatchObject({ total: 4, comTelefone: 3 })
  })
})

describe('extração de um grupo', () => {
  const vazia = new Map<string, string>()

  it('pega telefone e primeiro nome do WhatsApp, sem o próprio número e sem quem tem número oculto', () => {
    const r = extrairContatos(GRUPOS, 'g1@g.us', vazia, 'whatsapp', tel('0099'))
    expect(r.contatos).toEqual([
      { celular: tel('0001'), nome: 'Maria' },
      { celular: tel('0002'), nome: null },
    ])
    expect(r.semTelefone).toBe(1)
  })

  it('preferência "whatsapp": usa o nome da agenda só quando o do WhatsApp falta', () => {
    const agenda = new Map([[tel('0001'), 'Mariazinha'], [tel('0002'), 'Pedro Cliente']])
    const r = extrairContatos(GRUPOS, 'g1@g.us', agenda, 'whatsapp', null)
    expect(r.contatos.find(c => c.celular === tel('0001'))?.nome).toBe('Maria')
    expect(r.contatos.find(c => c.celular === tel('0002'))?.nome).toBe('Pedro')
  })

  it('preferência "agenda": o nome salvo vence o do WhatsApp', () => {
    const agenda = new Map([[tel('0001'), 'Mariazinha']])
    const r = extrairContatos(GRUPOS, 'g1@g.us', agenda, 'agenda', null)
    expect(r.contatos.find(c => c.celular === tel('0001'))?.nome).toBe('Mariazinha')
  })

  it('comunidade junta todos os subgrupos, um contato por número', () => {
    const r = extrairContatos(GRUPOS, 'com@g.us', vazia, 'whatsapp', null)
    expect(r.contatos.map(c => c.celular).sort()).toEqual([tel('0001'), tel('0003'), tel('0004'), tel('0005')])
    expect(r.contatos.find(c => c.celular === tel('0004'))?.nome).toBe('João')
  })

  it('grupo inexistente não devolve ninguém', () => {
    expect(extrairContatos(GRUPOS, 'nao@g.us', vazia, 'whatsapp', null).contatos).toEqual([])
  })
})

describe('nomes', () => {
  it('primeiro nome tira emoji e símbolo das pontas; sem letra nenhuma → sem nome', () => {
    expect(primeiroNome('🔥João Silva')).toBe('João')
    expect(primeiroNome('  ~Ana~ ')).toBe('Ana')
    expect(primeiroNome('12345 ✨')).toBeNull()
    expect(primeiroNome(null)).toBeNull()
  })

  it('gera linhas que a lista do disparo entende', () => {
    expect(paraLinhas([{ celular: tel('0001'), nome: 'Maria' }, { celular: tel('0002'), nome: null }]))
      .toBe(`Maria; ${tel('0001')}\n${tel('0002')}`)
  })
})
