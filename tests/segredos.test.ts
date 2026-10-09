// Cifra de credenciais de integração guardadas no banco (SEG-A5). O que precisa ficar provado:
// o segredo nunca vai em claro, dado adulterado ou chave errada NÃO decifram, e sem chave
// configurada nada é cifrado nem lido (nunca cai para texto claro).
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cifrarSegredo, decifrarSegredo } from '@/lib/crypto/segredos'

const chaveNova = () => randomBytes(32).toString('base64')
const SEGREDO = 'APP_USR-1234567890-092126-abcdef0123456789-99887766'

beforeEach(() => { process.env.CREDENCIAIS_KEY = chaveNova() })
afterEach(() => { delete process.env.CREDENCIAIS_KEY })

describe('cifra de segredos', () => {
  it('cifra e decifra devolvendo exatamente o texto original', () => {
    expect(decifrarSegredo(cifrarSegredo(SEGREDO))).toBe(SEGREDO)
  })

  it('o valor guardado leva o prefixo de versão e não contém o segredo em claro', () => {
    const guardado = cifrarSegredo(SEGREDO)
    expect(guardado.startsWith('enc:v1:')).toBe(true)
    expect(guardado).not.toContain(SEGREDO)
    expect(Buffer.from(guardado.slice('enc:v1:'.length), 'base64').toString('utf8')).not.toContain('APP_USR')
  })

  it('cifrar duas vezes o mesmo segredo dá resultados diferentes (IV aleatório)', () => {
    expect(cifrarSegredo(SEGREDO)).not.toBe(cifrarSegredo(SEGREDO))
  })

  it('valor adulterado é recusado (o GCM autentica o conteúdo)', () => {
    const guardado = cifrarSegredo(SEGREDO)
    const bruto = Buffer.from(guardado.slice('enc:v1:'.length), 'base64')
    bruto[bruto.length - 1] ^= 0x01
    expect(() => decifrarSegredo('enc:v1:' + bruto.toString('base64'))).toThrow(/decifrar/)
  })

  it('chave diferente da usada para cifrar não decifra', () => {
    const guardado = cifrarSegredo(SEGREDO)
    process.env.CREDENCIAIS_KEY = chaveNova()
    expect(() => decifrarSegredo(guardado)).toThrow(/decifrar/)
  })

  it('sem CREDENCIAIS_KEY: nem cifra nem decifra (nunca cai para texto claro)', () => {
    const guardado = cifrarSegredo(SEGREDO)
    delete process.env.CREDENCIAIS_KEY
    expect(() => cifrarSegredo(SEGREDO)).toThrow(/CREDENCIAIS_KEY/)
    expect(() => decifrarSegredo(guardado)).toThrow(/CREDENCIAIS_KEY/)
  })

  it('chave com tamanho errado é recusada', () => {
    process.env.CREDENCIAIS_KEY = randomBytes(16).toString('base64')
    expect(() => cifrarSegredo(SEGREDO)).toThrow(/32 bytes/)
  })

  it('texto claro (sem o prefixo) é recusado na leitura', () => {
    expect(() => decifrarSegredo(SEGREDO)).toThrow(/formato cifrado/)
  })

  it('valor truncado é recusado', () => {
    expect(() => decifrarSegredo('enc:v1:' + Buffer.from('curto').toString('base64'))).toThrow(/truncado|corrompido/)
  })
})
