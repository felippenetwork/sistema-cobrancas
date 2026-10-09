import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Cifra credenciais de integração antes de gravar no banco (SEG-A5). AES-256-GCM com a chave FORA
// do banco (CREDENCIAIS_KEY: 32 bytes em base64 — `openssl rand -base64 32`). O prefixo versiona o
// formato e separa valor cifrado de texto claro legado.
const PREFIXO = 'enc:v1:'
const IV_BYTES = 12
const TAG_BYTES = 16

function chave(): Buffer {
  const bruta = process.env.CREDENCIAIS_KEY
  if (!bruta) throw new Error('CREDENCIAIS_KEY não configurada no servidor.')
  const key = Buffer.from(bruta, 'base64')
  if (key.length !== 32) throw new Error('CREDENCIAIS_KEY inválida: precisa ter 32 bytes em base64.')
  return key
}

export function cifrarSegredo(texto: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', chave(), iv)
  const cifrado = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
  return PREFIXO + Buffer.concat([iv, cipher.getAuthTag(), cifrado]).toString('base64')
}

export function decifrarSegredo(valor: string): string {
  if (!valor.startsWith(PREFIXO)) throw new Error('Segredo não está no formato cifrado esperado.')
  const bruto = Buffer.from(valor.slice(PREFIXO.length), 'base64')
  if (bruto.length <= IV_BYTES + TAG_BYTES) throw new Error('Segredo cifrado truncado ou corrompido.')

  const decipher = createDecipheriv('aes-256-gcm', chave(), bruto.subarray(0, IV_BYTES))
  decipher.setAuthTag(bruto.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
  try {
    return Buffer.concat([decipher.update(bruto.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Não foi possível decifrar o segredo (chave diferente da usada para cifrar, ou dado corrompido).')
  }
}
