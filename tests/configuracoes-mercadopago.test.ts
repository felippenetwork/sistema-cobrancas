// Actions de Configurações do Mercado Pago (Access Token + Webhook Secret, ambos cifrados) e do
// provedor de PIX. O que precisa ficar provado: nenhum dos dois é gravado em claro (nem sem chave de
// cifra), o Access Token só é guardado depois de o próprio Mercado Pago aceitá-lo, campo em branco
// mantém o valor já salvo (nunca apaga sem querer), e o provedor ativo só pode ser um provedor com
// AMBAS as credenciais completas (sem a Secret Key não dá para validar a assinatura do webhook).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './helpers/fake-supabase'
import { decifrarSegredo } from '@/lib/crypto/segredos'

const mocks = vi.hoisted(() => ({
  db: { atual: null as unknown },
  usuario: { atual: { id: 'user-1' } as { id: string } | null },
  fetch: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    ...(mocks.db.atual as object),
    auth: { getUser: async () => ({ data: { user: mocks.usuario.atual } }) },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { salvarMercadoPagoAction, salvarProvedorPixAction } from '@/app/(app)/configuracoes/_actions/configuracoes'

const CONTA = 'conta-1'
const TOKEN = 'APP_USR-1234567890-092126-abcdef0123456789-99887766'
const SECRET = 'a1b2c3d4e5f6a1b2c3d4e5f6'
const ESTADO = { error: null }

const respostaMp = (status: number) => ({ ok: status >= 200 && status < 300, status, text: async () => '{}' })

const form = (campos: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

function cenario(config: Record<string, unknown> | null = { conta_id: CONTA, mp_access_token: null, mp_webhook_secret: null, pix_provedor: 'efibank' }) {
  const db = new FakeDb({
    contas: [{ id: CONTA, owner_user_id: 'user-1' }],
    configuracoes: config ? [config] : [],
  })
  mocks.db.atual = db.cliente()
  return db
}

const linha = (db: FakeDb) => db.linhas('configuracoes')[0]

beforeEach(() => {
  process.env.CREDENCIAIS_KEY = Buffer.alloc(32, 9).toString('base64')
  mocks.usuario.atual = { id: 'user-1' }
  mocks.fetch.mockReset().mockResolvedValue(respostaMp(200))
  vi.stubGlobal('fetch', mocks.fetch)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.CREDENCIAIS_KEY
})

describe('salvarMercadoPagoAction — guardar o Access Token', () => {
  it('valida o token no Mercado Pago e guarda CIFRADO (o texto claro nunca vai para o banco)', async () => {
    const db = cenario()
    expect(await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: TOKEN }))).toEqual({ error: null, success: true })

    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/users/me')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)

    const guardado = linha(db).mp_access_token as string
    expect(guardado.startsWith('enc:v1:')).toBe(true)
    expect(guardado).not.toContain(TOKEN)
    expect(decifrarSegredo(guardado)).toBe(TOKEN)
  })

  it('espaços em volta do token colado são ignorados', async () => {
    const db = cenario()
    expect((await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: `  ${TOKEN}\n` }))).success).toBe(true)
    expect(decifrarSegredo(linha(db).mp_access_token as string)).toBe(TOKEN)
  })

  it('conta sem linha de configuração ainda: cria a linha já com o token cifrado', async () => {
    const db = cenario(null)
    expect((await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: TOKEN }))).success).toBe(true)
    expect(db.linhas('configuracoes')).toHaveLength(1)
    expect(decifrarSegredo(linha(db).mp_access_token as string)).toBe(TOKEN)
  })

  it('substitui um token já salvo', async () => {
    const db = cenario()
    await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: TOKEN }))
    const outro = 'APP_USR-9999999999-092126-ffffffffffffffff-11223344'
    await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: outro }))
    expect(decifrarSegredo(linha(db).mp_access_token as string)).toBe(outro)
  })

  it.each([
    ['vazio', ''],
    ['muito curto', 'APP_USR-123'],
    ['com prefixo "Bearer"', `Bearer ${TOKEN}`],
    ['com espaço no meio', 'APP_USR-1234567890 092126-abcdef0123456789'],
    ['sem o prefixo APP_USR-/TEST-', 'credencial-de-outro-formato-1234567890abcdefgh'],
  ])('formato inválido (%s): recusa sem chamar o Mercado Pago nem gravar', async (_nome, valor) => {
    const db = cenario()
    const r = await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: valor }))
    expect(r.error).toBeTruthy()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(linha(db).mp_access_token).toBeNull()
  })

  it('o Mercado Pago recusa o token (401): não grava', async () => {
    const db = cenario()
    mocks.fetch.mockResolvedValue(respostaMp(401))
    const r = await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: TOKEN }))
    expect(r.error).toMatch(/recusou/)
    expect(linha(db).mp_access_token).toBeNull()
  })

  it('o Mercado Pago responde 5xx: não grava e pede para tentar de novo', async () => {
    const db = cenario()
    mocks.fetch.mockResolvedValue(respostaMp(503))
    const r = await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: TOKEN }))
    expect(r.error).toMatch(/503/)
    expect(linha(db).mp_access_token).toBeNull()
  })

  it('Mercado Pago fora do ar (falha de rede): não grava', async () => {
    const db = cenario()
    mocks.fetch.mockRejectedValue(new Error('ENOTFOUND'))
    expect((await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: TOKEN }))).error).toMatch(/validar/)
    expect(linha(db).mp_access_token).toBeNull()
  })

  it('sem CREDENCIAIS_KEY no servidor: recusa e NÃO grava o token em claro', async () => {
    const db = cenario()
    delete process.env.CREDENCIAIS_KEY
    const r = await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: TOKEN }))
    expect(r.error).toBeTruthy()
    expect(linha(db).mp_access_token).toBeNull()
    expect(JSON.stringify(db.tabelas)).not.toContain(TOKEN)
  })

  it('erro ao gravar: devolve mensagem genérica (sem vazar o erro do banco)', async () => {
    const db = cenario()
    db.falhas.push({ tabela: 'configuracoes', operacao: 'upsert', vezes: 1 })
    const r = await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: TOKEN }))
    expect(r.error).toBeTruthy()
    expect(r.error).not.toMatch(/falha simulada|XX000/)
  })

  it('usuário sem sessão: recusa', async () => {
    const db = cenario()
    mocks.usuario.atual = null
    expect((await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: TOKEN }))).error).toBeTruthy()
    expect(linha(db).mp_access_token).toBeNull()
  })

  it('usuário que não é dono de nenhuma conta: recusa', async () => {
    const db = cenario()
    mocks.usuario.atual = { id: 'intruso' }
    expect((await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: TOKEN }))).error).toBeTruthy()
    expect(linha(db).mp_access_token).toBeNull()
  })
})

describe('salvarMercadoPagoAction — guardar o Webhook Secret', () => {
  it('guarda CIFRADO, sem chamar o Mercado Pago (não dá para validar a secret sem uma notificação de verdade)', async () => {
    const db = cenario()
    expect(await salvarMercadoPagoAction(ESTADO, form({ mp_webhook_secret: SECRET }))).toEqual({ error: null, success: true })
    expect(mocks.fetch).not.toHaveBeenCalled()

    const guardado = linha(db).mp_webhook_secret as string
    expect(guardado.startsWith('enc:v1:')).toBe(true)
    expect(guardado).not.toContain(SECRET)
    expect(decifrarSegredo(guardado)).toBe(SECRET)
  })

  it('secret vazia ou muito curta: recusa sem gravar', async () => {
    const db = cenario()
    const r = await salvarMercadoPagoAction(ESTADO, form({ mp_webhook_secret: 'abc' }))
    expect(r.error).toBeTruthy()
    expect(linha(db).mp_webhook_secret).toBeNull()
  })

  it('token E secret enviados juntos: os dois são salvos', async () => {
    const db = cenario()
    expect((await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: TOKEN, mp_webhook_secret: SECRET }))).success).toBe(true)
    expect(decifrarSegredo(linha(db).mp_access_token as string)).toBe(TOKEN)
    expect(decifrarSegredo(linha(db).mp_webhook_secret as string)).toBe(SECRET)
  })

  it('token inválido no mesmo envio: não salva NEM o secret (tudo ou nada)', async () => {
    const db = cenario()
    const r = await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: 'invalido', mp_webhook_secret: SECRET }))
    expect(r.error).toBeTruthy()
    expect(linha(db).mp_access_token).toBeNull()
    expect(linha(db).mp_webhook_secret).toBeNull()
  })

  it('campo em branco mantém o valor já salvo (só atualiza o token não mexe na secret, e vice-versa)', async () => {
    const db = cenario({ conta_id: CONTA, mp_access_token: null, mp_webhook_secret: 'enc:v1:secret-anterior', pix_provedor: 'efibank' })
    await salvarMercadoPagoAction(ESTADO, form({ mp_access_token: TOKEN }))
    expect(decifrarSegredo(linha(db).mp_access_token as string)).toBe(TOKEN)
    expect(linha(db).mp_webhook_secret).toBe('enc:v1:secret-anterior')
  })

  it('nem token nem secret enviados: recusa (nada para salvar)', async () => {
    cenario()
    expect((await salvarMercadoPagoAction(ESTADO, form({}))).error).toBeTruthy()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

describe('salvarMercadoPagoAction — remover as credenciais', () => {
  it('apaga token E secret sem consultar o Mercado Pago', async () => {
    const db = cenario({ conta_id: CONTA, mp_access_token: 'enc:v1:abc', mp_webhook_secret: 'enc:v1:def', pix_provedor: 'efibank' })
    expect(await salvarMercadoPagoAction(ESTADO, form({ remover: 'true' }))).toEqual({ error: null, success: true })
    expect(linha(db).mp_access_token).toBeNull()
    expect(linha(db).mp_webhook_secret).toBeNull()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('se o Mercado Pago era o provedor ativo, volta para a EfiBank (senão o Atendimento só daria erro)', async () => {
    const db = cenario({ conta_id: CONTA, mp_access_token: 'enc:v1:abc', mp_webhook_secret: 'enc:v1:def', pix_provedor: 'mercadopago' })
    await salvarMercadoPagoAction(ESTADO, form({ remover: 'true' }))
    expect(linha(db).pix_provedor).toBe('efibank')
  })

  it('se a EfiBank era o provedor ativo, continua nela', async () => {
    const db = cenario({ conta_id: CONTA, mp_access_token: 'enc:v1:abc', mp_webhook_secret: 'enc:v1:def', pix_provedor: 'efibank' })
    await salvarMercadoPagoAction(ESTADO, form({ remover: 'true' }))
    expect(linha(db).pix_provedor).toBe('efibank')
  })
})

describe('salvarProvedorPixAction — provedor ativo', () => {
  const efiCompleta = { efi_client_id: 'id', efi_client_secret: 'sec', efi_pix_key: 'chave', efi_cert_base64: 'cert' }
  const mpCompleta = { mp_access_token: 'enc:v1:abc', mp_webhook_secret: 'enc:v1:def' }

  it('Mercado Pago sem NENHUMA credencial: recusa e o provedor não muda', async () => {
    const db = cenario({ conta_id: CONTA, mp_access_token: null, mp_webhook_secret: null, pix_provedor: 'efibank', ...efiCompleta })
    const r = await salvarProvedorPixAction(ESTADO, form({ pix_provedor: 'mercadopago' }))
    expect(r.error).toMatch(/Mercado Pago/)
    expect(linha(db).pix_provedor).toBe('efibank')
  })

  it('Mercado Pago só com o Access Token (falta a Webhook Secret): recusa — sem ela não valida a assinatura do webhook', async () => {
    const db = cenario({ conta_id: CONTA, mp_access_token: 'enc:v1:abc', mp_webhook_secret: null, pix_provedor: 'efibank' })
    const r = await salvarProvedorPixAction(ESTADO, form({ pix_provedor: 'mercadopago' }))
    expect(r.error).toMatch(/Mercado Pago/)
    expect(linha(db).pix_provedor).toBe('efibank')
  })

  it('Mercado Pago só com a Webhook Secret (falta o Access Token): recusa', async () => {
    const db = cenario({ conta_id: CONTA, mp_access_token: null, mp_webhook_secret: 'enc:v1:def', pix_provedor: 'efibank' })
    const r = await salvarProvedorPixAction(ESTADO, form({ pix_provedor: 'mercadopago' }))
    expect(r.error).toMatch(/Mercado Pago/)
    expect(linha(db).pix_provedor).toBe('efibank')
  })

  it('Mercado Pago com Access Token E Webhook Secret: passa a ser o provedor ativo', async () => {
    const db = cenario({ conta_id: CONTA, pix_provedor: 'efibank', ...mpCompleta })
    expect(await salvarProvedorPixAction(ESTADO, form({ pix_provedor: 'mercadopago' }))).toEqual({ error: null, success: true })
    expect(linha(db).pix_provedor).toBe('mercadopago')
  })

  it('EfiBank com as quatro credenciais: volta a ser o provedor ativo', async () => {
    const db = cenario({ conta_id: CONTA, pix_provedor: 'mercadopago', ...mpCompleta, ...efiCompleta })
    expect((await salvarProvedorPixAction(ESTADO, form({ pix_provedor: 'efibank' }))).success).toBe(true)
    expect(linha(db).pix_provedor).toBe('efibank')
  })

  it('EfiBank com credenciais incompletas (falta o certificado): recusa', async () => {
    const db = cenario({ conta_id: CONTA, pix_provedor: 'mercadopago', ...mpCompleta, efi_client_id: 'id', efi_client_secret: 'sec', efi_pix_key: 'chave' })
    const r = await salvarProvedorPixAction(ESTADO, form({ pix_provedor: 'efibank' }))
    expect(r.error).toMatch(/EfiBank/)
    expect(linha(db).pix_provedor).toBe('mercadopago')
  })

  it.each(['pagseguro', '', 'MERCADOPAGO'])('provedor inválido "%s": recusa', async (valor) => {
    const db = cenario({ conta_id: CONTA, pix_provedor: 'efibank', ...mpCompleta })
    expect((await salvarProvedorPixAction(ESTADO, form({ pix_provedor: valor }))).error).toBeTruthy()
    expect(linha(db).pix_provedor).toBe('efibank')
  })

  it('usuário que não é dono de nenhuma conta: recusa', async () => {
    const db = cenario({ conta_id: CONTA, pix_provedor: 'efibank', ...mpCompleta })
    mocks.usuario.atual = { id: 'intruso' }
    expect((await salvarProvedorPixAction(ESTADO, form({ pix_provedor: 'mercadopago' }))).error).toBeTruthy()
    expect(linha(db).pix_provedor).toBe('efibank')
  })
})
