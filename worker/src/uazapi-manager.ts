// UazapiManager — uazapi v2 REST API (supercloudstore.uazapi.com).
// Mesma interface pública do BaileysManager: o resto do worker não muda.
// Env: UAZAPI_URL, UAZAPI_ADMIN_TOKEN

import pino from 'pino'
import { sleep } from './format.js'
import type { SupabaseAdmin } from './supabase.js'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' })

const BASE_URL     = (process.env.UAZAPI_URL          ?? '').replace(/\/$/, '')
const GLOBAL_TOKEN = process.env.UAZAPI_ADMIN_TOKEN ?? process.env.UAZAPI_GLOBAL_TOKEN ?? ''

function instName(contaId: string): string {
  return `quita${contaId.replace(/-/g, '').slice(0, 10)}`
}

function extrairNumero(data: any): string | null {
  const tentativas = [
    data?.instance?.owner,
    data?.status?.jid?.user,
    data?.status?.owner,
    data?.status?.phone,
    data?.instance?.phone,
    data?.jid?.user,
  ]
  for (const v of tentativas) {
    if (v && typeof v === 'string') {
      return v.replace('@s.whatsapp.net', '').replace(/\D/g, '') || null
    }
    if (v && typeof v === 'number') return String(v)
  }
  return null
}

type InstanciaInfo = {
  state:  'connected' | 'disconnected' | 'connecting'
  phone:  string | null
  qr:     string | null
  nome:   string | null
  // true quando o estado acima é um "não sei" por causa de HTTP 429 (rate limit
  // da uazapi), não uma resposta real da API. Ver comentário na classe abaixo.
  rateLimited?: boolean
}

// 429 é rate limit transitório da uazapi — NUNCA deve virar "disconnected".
// Um falso negativo aqui (ver checarInstancia → reconectar/tentarReconectarAuto)
// apagaria e recriaria a instância, derrubando uma sessão que pode já estar
// conectada no celular só porque a CHECAGEM foi limitada, não o WhatsApp em si.
class UazapiRateLimitError extends Error {}

// Verifica estado via GET /instance/status — leve, sem reconexão ao WhatsApp.
// Usar apenas no loop de polling (steady-state). Não aciona /instance/connect.
async function verificarEstado(token: string): Promise<InstanciaInfo> {
  try {
    const data = await instanceApi(token, 'GET', '/instance/status')
    const phone = extrairNumero(data)
    if (phone) {
      return {
        state: 'connected',
        phone,
        nome: (data?.instance?.profileName as string) ?? (data?.instance?.name as string) ?? null,
        qr:   null,
      }
    }
    const qr = (data?.instance?.qrcode as string) ?? null
    return { state: qr ? 'connecting' : 'disconnected', phone: null, nome: null, qr }
  } catch (err: any) {
    if (err instanceof UazapiRateLimitError) throw err
    if (/404/.test(String(err?.message ?? ''))) return { state: 'disconnected', phone: null, nome: null, qr: null }
    throw err
  }
}

// Inicia conexão via POST /instance/connect — usar apenas ao conectar/reconectar,
// NUNCA no loop de polling pois gera "reconnect loop" detectado pelo WhatsApp como bot.
async function checarInstancia(token: string): Promise<InstanciaInfo> {
  try {
    const data = await instanceApi(token, 'POST', '/instance/connect')
    const inst = data?.instance ?? {}

    if (data?.connected === true) {
      return {
        state: 'connected',
        phone: extrairNumero(data),
        nome:  inst?.profileName ?? inst?.name ?? null,
        qr:    null,
      }
    }
    if (inst?.qrcode) {
      return { state: 'connecting', phone: null, nome: null, qr: inst.qrcode }
    }
    return { state: 'connecting', phone: null, nome: null, qr: null }
  } catch (err) {
    // 429: não sabemos o estado real. Reportar 'disconnected' aqui faria o
    // chamador (reconectar/tentarReconectarAuto) apagar e recriar a instância
    // por engano — sinaliza rateLimited e deixa quem chama decidir sem agir.
    if (err instanceof UazapiRateLimitError) {
      return { state: 'connecting', phone: null, nome: null, qr: null, rateLimited: true }
    }
    return { state: 'disconnected', phone: null, nome: null, qr: null }
  }
}

// Operações admin — requerem header admintoken
async function adminApi(method: string, path: string, body?: object): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'admintoken': GLOBAL_TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 429) throw new UazapiRateLimitError(`uazapi admin ${method} ${path} → 429`)
  const text = await res.text()
  if (!res.ok) throw new Error(`uazapi admin ${method} ${path} → ${res.status}: ${text}`)
  try { return JSON.parse(text) } catch { return text }
}

// Operações de instância — requerem header token (token por instância)
async function instanceApi(instanceToken: string, method: string, path: string, body?: object): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'token': instanceToken },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 429) throw new UazapiRateLimitError(`uazapi inst ${method} ${path} → 429`)
  const text = await res.text()
  if (!res.ok) throw new Error(`uazapi inst ${method} ${path} → ${res.status}: ${text}`)
  try { return JSON.parse(text) } catch { return text }
}

export class UazapiManager {
  private connected      = new Set<string>()           // contaIds com estado 'connected'
  private polling        = new Set<string>()           // contaIds com loop de polling ativo
  private rateLimitados   = new Set<string>()           // contaIds atualmente sinalizadas como rate-limited
  private instanceTokens = new Map<string, string>()   // contaId → instance token

  constructor(private supabase: SupabaseAdmin) {}

  // ── Startup: verifica quais instâncias ainda estão conectadas no uazapi ──────
  async restaurarSessoes() {
    // Busca TODAS as contas com linha em conexoes — não filtra por status no banco
    // porque o banco pode mostrar 'desconectado' mesmo que o uazapi ainda esteja ativo
    // (ex: worker reiniciou após circuit-breaker). A fonte de verdade é o uazapi.
    const { data: conexoes } = await this.supabase
      .from('conexoes').select('conta_id')

    if (!conexoes?.length) return

    let allInstances: any[] = []
    try {
      allInstances = await adminApi('GET', '/instance/all')
    } catch (err) {
      logger.error({ err }, 'uazapi: falha ao listar instâncias no startup')
      return
    }

    for (const row of conexoes) {
      const contaId = row.conta_id as string
      const name    = instName(contaId)
      const inst    = allInstances.find((i: any) => i.name === name)

      if (!inst) {
        await this.marcarDesconectado(contaId)
        continue
      }

      this.instanceTokens.set(contaId, inst.token as string)

      if (inst.status === 'connected') {
        this.connected.add(contaId)
        // Sincronizar DB — pode estar em 'conectando' se o worker reiniciou durante conexão
        try {
          const data   = await instanceApi(inst.token as string, 'GET', '/instance/status')
          const numero = extrairNumero(data)
          const nome   = (data?.instance?.profileName as string) ?? null
          await this.supabase.from('conexoes').upsert(
            { conta_id: contaId, status: 'conectado', qr_code: null, comando: null,
              numero_conectado: numero, device_name: nome, rate_limitado: false,
              ultima_conexao: new Date().toISOString(),
              uazapi_instance_token: inst.token as string },
            { onConflict: 'conta_id' },
          )
          this.rateLimitados.delete(contaId)
        } catch (err) { logger.warn({ contaId, err }, 'uazapi: restaurarSessoes — falha ao sincronizar DB') }
        this.iniciarPolling(contaId)
        logger.info({ contaId }, 'uazapi: sessão restaurada')
      } else {
        await this.marcarDesconectado(contaId)
      }
    }
  }

  // ── Conectar: ciclo limpo — deleta instância antiga, cria nova, gera QR ──────
  async conectar(contaId: string) {
    const name = instName(contaId)

    // 1. Deletar instância antiga (evita acúmulo de instâncias mortas no uazapi)
    try {
      await adminApi('DELETE', `/instance/${name}`)
      logger.info({ contaId, name }, 'uazapi: instância antiga deletada')
    } catch {
      // Não existia — sem problema
    }
    this.instanceTokens.delete(contaId)
    this.connected.delete(contaId)
    this.polling.delete(contaId)
    this.rateLimitados.delete(contaId)

    // 2. Criar nova instância
    let token: string
    try {
      const data = await adminApi('POST', '/instance/create', { name })
      token = data.token as string
      this.instanceTokens.set(contaId, token)
      logger.info({ contaId, name }, 'uazapi: nova instância criada')
    } catch (err) {
      logger.error({ contaId, err }, 'uazapi: falha ao criar instância')
      throw err
    }

    await this.supabase.from('conexoes').upsert(
      { conta_id: contaId, status: 'conectando', qr_code: null, comando: null,
        uazapi_instance_token: token, rate_limitado: false },
      { onConflict: 'conta_id' },
    )

    // 3. Iniciar conexão → gera QR code
    try {
      await instanceApi(token, 'POST', '/instance/connect')
    } catch (err) {
      logger.warn({ contaId, err }, 'uazapi: /instance/connect falhou')
    }

    await sleep(2_000)
    await this.buscarEGravarQR(contaId)
    this.iniciarPolling(contaId)
  }

  // ── Desconectar: ciclo limpo — deleta instância do uazapi e limpa tokens ──────
  async desconectar(contaId: string) {
    const name = instName(contaId)

    // Deletar instância do uazapi (não apenas desconectar)
    try {
      await adminApi('DELETE', `/instance/${name}`)
      logger.info({ contaId, name }, 'uazapi: instância deletada')
    } catch (err) {
      logger.warn({ contaId, err }, 'uazapi: falha ao deletar instância (não crítico)')
    }

    this.instanceTokens.delete(contaId)
    this.connected.delete(contaId)
    this.polling.delete(contaId)
    this.rateLimitados.delete(contaId)

    await this.supabase.from('conexoes').upsert(
      { conta_id: contaId, status: 'desconectado', qr_code: null, comando: null,
        numero_conectado: null, device_name: null, rate_limitado: false },
      { onConflict: 'conta_id' },
    )
  }

  // ── Reiniciar: sincroniza estado sem desconectar ──────────────────────────────
  async reconectar(contaId: string) {
    // Se token não está em memória (ex: worker reiniciou com conta em status desconectado
    // no banco mas instância ainda ativa no uazapi), recuperar via /instance/all antes
    // de checar o estado — caso contrário pegarEstado() retorna 'disconnected' sem verificar.
    if (!this.instanceTokens.has(contaId)) {
      try {
        const all  = await adminApi('GET', '/instance/all')
        const inst = (all as any[]).find((i: any) => i.name === instName(contaId))
        if (inst?.token) {
          this.instanceTokens.set(contaId, inst.token as string)
          logger.info({ contaId }, 'uazapi: token recuperado via /instance/all no reconectar')
        }
      } catch (err) {
        logger.warn({ contaId, err }, 'uazapi: falha ao recuperar token — tentando conectar()')
      }
    }

    // Checar estado real no uazapi antes de qualquer ação destrutiva
    let estado: InstanciaInfo = { state: 'disconnected', phone: null, nome: null, qr: null }
    try { estado = await this.pegarEstado(contaId) } catch (err) { logger.warn({ contaId, err }, 'uazapi: reconectar — falha ao checar estado') }

    if (estado.state === 'connected') {
      // Já conectado — apenas sincronizar banco, sem desconectar
      const token = this.instanceTokens.get(contaId)
      if (token) {
        try {
          const data   = await instanceApi(token, 'GET', '/instance/status')
          const numero = extrairNumero(data)
          const nome   = (data?.instance?.profileName as string) ?? null
          await this.supabase.from('conexoes').upsert(
            { conta_id: contaId, status: 'conectado', qr_code: null, comando: null,
              numero_conectado: numero, device_name: nome, rate_limitado: false,
              ultima_conexao: new Date().toISOString() },
            { onConflict: 'conta_id' },
          )
          this.rateLimitados.delete(contaId)
        } catch (err) { logger.warn({ contaId, err }, 'uazapi: reconectar — falha ao sincronizar DB') }
      }
      this.connected.add(contaId)
      this.iniciarPolling(contaId)
      logger.info({ contaId }, 'uazapi: reiniciar — já conectado, banco sincronizado')
      return
    }

    if (estado.rateLimited) {
      // uazapi está limitando as checagens agora — não sabemos o estado real.
      // NUNCA apagar/recriar a instância aqui: se a conta já estiver conectada
      // no celular, isso derrubaria a sessão por causa de um falso negativo.
      // Só sinaliza na tela; o próximo ciclo de polling (60s) resolve sozinho.
      logger.warn({ contaId }, 'uazapi: reconectar — rate limited, mantendo estado atual sem mexer na instância')
      await this.sinalizarRateLimit(contaId)
      try {
        await this.supabase.from('conexoes').update({ comando: null }).eq('conta_id', contaId)
      } catch (err) { logger.warn({ contaId, err }, 'uazapi: reconectar — falha ao limpar comando') }
      return
    }

    // Não conectado — iniciar nova conexão sem desconectar (preserva sessão se existir)
    this.connected.delete(contaId)
    this.polling.delete(contaId)
    await this.conectar(contaId)
  }

  // ── Enviar mensagem ───────────────────────────────────────────────────────────
  async enviarMensagem(
    contaId: string,
    para: string,
    texto: string,
    semDigitacao = false,
  ): Promise<void> {
    const token = this.instanceTokens.get(contaId)
    if (!token) throw new Error(`uazapi: sem token para conta ${contaId}`)

    if (!semDigitacao) {
      const ms = 7_000 + Math.floor(Math.random() * 2_000)  // 7–9s
      try {
        // Presença async — cancelada automaticamente quando a mensagem é enviada
        await instanceApi(token, 'POST', '/message/presence', {
          number: para, presence: 'composing', delay: ms,
        })
        await sleep(ms)
      } catch (err) {
        logger.warn({ contaId, err }, 'uazapi: falha no presence (não crítico)')
      }
    }

    await instanceApi(token, 'POST', '/send/text', { number: para, text: texto })
  }

  // ── Interface compartilhada ───────────────────────────────────────────────────
  hasSocket(contaId: string, _bypassWarmup = false): boolean {
    return this.connected.has(contaId)
  }

  contasConectadas(): number {
    return this.connected.size
  }

  // ── Privados ──────────────────────────────────────────────────────────────────

  private async pegarEstado(contaId: string): Promise<InstanciaInfo> {
    const token = this.instanceTokens.get(contaId)
    if (!token) return { state: 'disconnected', phone: null, nome: null, qr: null }
    try {
      return await checarInstancia(token)
    } catch (err: any) {
      if (/404/.test(String(err?.message ?? ''))) {
        this.instanceTokens.delete(contaId)
        return { state: 'disconnected', phone: null, nome: null, qr: null }
      }
      throw err
    }
  }

  private async buscarEGravarQR(contaId: string) {
    const token = this.instanceTokens.get(contaId)
    if (!token) return
    try {
      const info = await checarInstancia(token)
      if (info.qr) {
        await this.supabase.from('conexoes').upsert(
          { conta_id: contaId, qr_code: info.qr, status: 'conectando', rate_limitado: false },
          { onConflict: 'conta_id' },
        )
        this.rateLimitados.delete(contaId)
        logger.info({ contaId }, 'uazapi: QR gravado no banco')
      } else if (info.rateLimited) {
        await this.sinalizarRateLimit(contaId)
      }
    } catch (err) {
      logger.warn({ contaId, err }, 'uazapi: erro ao buscar QR')
    }
  }

  private async marcarDesconectado(contaId: string) {
    await this.supabase.from('conexoes').upsert(
      { conta_id: contaId, status: 'desconectado', qr_code: null, comando: null, rate_limitado: false },
      { onConflict: 'conta_id' },
    )
    this.rateLimitados.delete(contaId)
  }

  // Sinaliza na tela que a uazapi está limitando as checagens desta conta.
  // Idempotente em memória — evita reescrever o banco a cada ciclo de polling
  // enquanto o rate limit continuar ativo.
  private async sinalizarRateLimit(contaId: string) {
    if (this.rateLimitados.has(contaId)) return
    this.rateLimitados.add(contaId)
    try {
      await this.supabase.from('conexoes').update({ rate_limitado: true }).eq('conta_id', contaId)
    } catch (err) { logger.warn({ contaId, err }, 'uazapi: falha ao sinalizar rate limit') }
  }

  // Limpa a sinalização de rate limit assim que uma checagem volta a funcionar.
  private async limparRateLimit(contaId: string) {
    if (!this.rateLimitados.has(contaId)) return
    this.rateLimitados.delete(contaId)
    try {
      await this.supabase.from('conexoes').update({ rate_limitado: false }).eq('conta_id', contaId)
    } catch (err) { logger.warn({ contaId, err }, 'uazapi: falha ao limpar rate limit') }
  }

  // Varredura periódica: sincroniza estado real do uazapi com o banco.
  // Chamada a cada 5 min pelo index.ts. Só age sobre contas SEM polling ativo —
  // contas com polling gerenciam o próprio estado pelo loop de 10s.
  async sincronizarConexoes() {
    const { data: conexoes } = await this.supabase
      .from('conexoes').select('conta_id')

    if (!conexoes?.length) return

    let allInstances: any[] = []
    try {
      allInstances = await adminApi('GET', '/instance/all')
    } catch (err) {
      logger.error({ err }, 'uazapi: sincronizarConexoes — falha ao listar instâncias')
      return
    }

    for (const row of conexoes) {
      const contaId = row.conta_id as string

      // Conta com polling ativo: o loop de 10s já cuida do estado — não interferir
      if (this.polling.has(contaId)) continue

      const name = instName(contaId)
      const inst = allInstances.find((i: any) => i.name === name)

      if (!inst) {
        // Instância não existe no uazapi — garantir DB consistente
        if (this.connected.has(contaId)) {
          this.connected.delete(contaId)
          await this.marcarDesconectado(contaId)
        }
        continue
      }

      // Sempre atualizar token em memória (pode ter mudado após restart do uazapi)
      this.instanceTokens.set(contaId, inst.token as string)

      if (inst.status === 'connected') {
        // Conectado no uazapi mas polling não está rodando → restaurar
        this.connected.add(contaId)
        try {
          const data   = await instanceApi(inst.token as string, 'GET', '/instance/status')
          const numero = extrairNumero(data)
          const nome   = (data?.instance?.profileName as string) ?? null
          await this.supabase.from('conexoes').upsert(
            { conta_id: contaId, status: 'conectado', qr_code: null, comando: null,
              numero_conectado: numero, device_name: nome, rate_limitado: false,
              ultima_conexao: new Date().toISOString() },
            { onConflict: 'conta_id' },
          )
          this.rateLimitados.delete(contaId)
        } catch (err) { logger.warn({ contaId, err }, 'uazapi: sincronizarConexoes — falha ao sincronizar DB') }
        this.iniciarPolling(contaId)
        logger.info({ contaId }, 'uazapi: sincronizarConexoes — sessão restaurada, polling reiniciado')

      } else if (inst.status === 'connecting') {
        // Gerou QR mas ninguém escaneou — atualizar QR no banco e sinalizar ao usuário
        await this.buscarEGravarQR(contaId)
        try {
          await this.supabase.from('conexoes').upsert(
            { conta_id: contaId, status: 'conectando', comando: null },
            { onConflict: 'conta_id' },
          )
        } catch (err) { logger.warn({ contaId, err }, 'uazapi: sincronizarConexoes — falha ao atualizar status conectando') }
        this.iniciarPolling(contaId)
        logger.info({ contaId }, 'uazapi: sincronizarConexoes — QR atualizado')

      } else {
        // Desconectado no uazapi e sem polling → garantir DB consistente
        if (this.connected.has(contaId)) this.connected.delete(contaId)
        await this.marcarDesconectado(contaId)
        logger.info({ contaId }, 'uazapi: sincronizarConexoes — marcado desconectado')
      }
    }
  }

  // Tenta restaurar a sessão automaticamente após queda de conexão.
  // Retorna 'conectado' se OK, 'conectando' se gerou QR (precisa de scan),
  // 'incerto' se só encontrou rate limit (não mexe no banco, tenta de novo depois),
  // ou 'falhou' se esgotou tentativas com uma resposta real de desconectado.
  private async tentarReconectarAuto(
    contaId: string,
  ): Promise<'conectado' | 'conectando' | 'falhou' | 'incerto'> {
    const MAX_TENTATIVAS  = 3
    const DELAY_INICIAL   = 3_000   // deixar uazapi processar a queda antes de reconectar
    const DELAY_CONECTAR  = 8_000   // aguardar sessão estabelecer após /instance/connect
    const DELAY_TENTATIVA = 20_000  // pausa entre tentativas fracassadas

    await sleep(DELAY_INICIAL)

    let ultimaFoiRateLimit = false

    for (let i = 1; i <= MAX_TENTATIVAS; i++) {
      if (!this.polling.has(contaId)) return 'falhou' // desconectado manualmente durante tentativa

      const token = this.instanceTokens.get(contaId)
      if (!token) return 'falhou'

      logger.info({ contaId, tentativa: i }, 'uazapi: reconexão automática — tentativa')

      try {
        await instanceApi(token, 'POST', '/instance/connect')
      } catch (err) {
        logger.warn({ contaId, tentativa: i, err }, 'uazapi: /instance/connect falhou (não crítico)')
      }

      await sleep(DELAY_CONECTAR)
      if (!this.polling.has(contaId)) return 'falhou'

      let estado: InstanciaInfo = { state: 'disconnected', phone: null, nome: null, qr: null }
      try { estado = await this.pegarEstado(contaId) } catch (err) { logger.warn({ contaId, tentativa: i, err }, 'uazapi: tentarReconectarAuto — falha ao checar estado') }

      if (estado.state === 'connected') {
        this.connected.add(contaId)
        try {
          const data   = await instanceApi(token, 'GET', '/instance/status')
          const numero = extrairNumero(data)
          const nome   = (data?.instance?.profileName as string) ?? null
          await this.supabase.from('conexoes').upsert(
            { conta_id: contaId, status: 'conectado', qr_code: null, comando: null,
              numero_conectado: numero, device_name: nome, rate_limitado: false,
              ultima_conexao: new Date().toISOString() },
            { onConflict: 'conta_id' },
          )
          this.rateLimitados.delete(contaId)
        } catch (err) { logger.warn({ contaId, err }, 'uazapi: tentarReconectarAuto — falha ao sincronizar DB pós-reconexão') }
        logger.info({ contaId, tentativa: i }, 'uazapi: reconexão automática bem-sucedida')
        return 'conectado'
      }

      if (estado.rateLimited) {
        // Não sabemos o estado real — não conta como tentativa fracassada de verdade,
        // senão esgota as 3 tentativas e marca 'desconectado' só por causa do 429.
        logger.warn({ contaId, tentativa: i }, 'uazapi: tentarReconectarAuto — rate limited, tentando de novo mais tarde')
        ultimaFoiRateLimit = true
        await this.sinalizarRateLimit(contaId)
        if (i < MAX_TENTATIVAS) await sleep(DELAY_TENTATIVA)
        continue
      }

      ultimaFoiRateLimit = false

      if (estado.state === 'connecting') {
        // Sessão expirou — gerou novo QR, aguardar scan do usuário
        await this.buscarEGravarQR(contaId)
        try {
          await this.supabase.from('conexoes').upsert(
            { conta_id: contaId, status: 'conectando', comando: null, rate_limitado: false },
            { onConflict: 'conta_id' },
          )
          this.rateLimitados.delete(contaId)
        } catch (err) { logger.warn({ contaId, err }, 'uazapi: tentarReconectarAuto — falha ao atualizar status conectando') }
        logger.info({ contaId }, 'uazapi: reconexão automática gerou QR — aguardando scan do usuário')
        return 'conectando'
      }

      if (i < MAX_TENTATIVAS) {
        logger.info({ contaId, tentativa: i }, 'uazapi: ainda desconectado — aguardando próxima tentativa')
        await sleep(DELAY_TENTATIVA)
      }
    }

    if (ultimaFoiRateLimit) {
      logger.warn({ contaId }, 'uazapi: reconexão automática esgotou tentativas só por rate limit — mantendo estado atual')
      return 'incerto'
    }

    logger.warn({ contaId }, 'uazapi: reconexão automática esgotou todas as tentativas')
    return 'falhou'
  }

  // Polling de estado a cada 60s — usa GET /instance/status (sem reconexão).
  // Intervalo longo é intencional: POST /instance/connect a cada 10s causava
  // "reconnect loop" detectado pelo WhatsApp como bot e resultava em ban.
  private iniciarPolling(contaId: string) {
    if (this.polling.has(contaId)) return
    this.polling.add(contaId)

    const MAX_ERROS = 10
    let erros = 0

    const loop = async () => {
      while (this.polling.has(contaId)) {
        await sleep(60_000)
        try {
          const tok  = this.instanceTokens.get(contaId)
          const info = tok ? await verificarEstado(tok) : { state: 'disconnected' as const, phone: null, nome: null, qr: null }
          const state = info.state
          erros = 0  // reset no sucesso
          await this.limparRateLimit(contaId)  // checagem funcionou — qualquer sinalização antiga fica obsoleta

          if (state === 'connected' && !this.connected.has(contaId)) {
            this.connected.add(contaId)
            logger.info({ contaId, phone: info.phone }, 'uazapi: conectado!')
            try {
              await this.supabase.from('conexoes').upsert(
                { conta_id: contaId, status: 'conectado', qr_code: null, comando: null,
                  numero_conectado: info.phone, device_name: info.nome, rate_limitado: false,
                  ultima_conexao: new Date().toISOString() },
                { onConflict: 'conta_id' },
              )
            } catch (err) { logger.warn({ contaId, err }, 'uazapi: polling — falha ao sincronizar DB pós-conexão') }
          }

          if (state !== 'connected' && this.connected.has(contaId)) {
            this.connected.delete(contaId)
            logger.warn({ contaId }, 'uazapi: perdeu conexão — iniciando reconexão automática')
            const resultado = await this.tentarReconectarAuto(contaId)
            if (resultado === 'falhou') await this.marcarDesconectado(contaId)
            // 'incerto' (só rate limit): não mexe no banco, o próximo ciclo de 60s resolve.
          }

          if (state === 'connecting') {
            await this.buscarEGravarQR(contaId)
          }

        } catch (err) {
          if (err instanceof UazapiRateLimitError) {
            // Transitório — não conta como erro de conexão nem mexe em connected/DB status.
            logger.warn({ contaId }, 'uazapi: polling — rate limited, tentando de novo no próximo ciclo')
            await this.sinalizarRateLimit(contaId)
            continue
          }

          erros++
          logger.error({ contaId, err, erros }, 'uazapi: erro no polling')

          if (erros >= MAX_ERROS) {
            logger.error({ contaId }, 'uazapi: muitos erros consecutivos — parando polling')
            this.polling.delete(contaId)
            this.connected.delete(contaId)
            try { await this.marcarDesconectado(contaId) } catch (err) { logger.warn({ contaId, err }, 'uazapi: polling — falha ao marcar desconectado') }
            return
          }
        }
      }
    }

    loop()
  }
}
