// Regras puras do disparo progressivo (/disparos, modo "progressivo") e da montagem do texto
// das campanhas. Sem banco e sem rede: tudo aqui é testado em tests/disparo-progressivo.test.ts.
//
// Progressivo: no dia 1 sai `inicio` mensagem(ns), no dia 2 sai inicio+1… até `maximo`; depois
// volta para `inicio` e recomeça o ciclo. Os envios de cada dia caem em horários aleatórios
// DENTRO da janela escolhida, espalhados (nunca um atrás do outro) — imitar uma pessoa reduz o
// risco de bloqueio do número.

/** "Digitando…" antes de cada envio progressivo — pedido do Felippe (2026-10-23): 20s fixos. */
export const DIGITACAO_PROGRESSIVO_MS = 20_000

/** Distância mínima entre dois envios do mesmo dia (abaixo disso o dia leva menos envios). */
export const ESPACO_MINIMO_MS = 3 * 60_000

/** Quantos envios cabem no dia `dia` (0 = primeiro dia) do ciclo inicio → maximo → inicio… */
export function quotaDoDia(dia: number, inicio: number, maximo: number): number {
  const tamanhoCiclo = maximo - inicio + 1
  return inicio + (dia % tamanhoCiclo)
}

/**
 * Sorteia `quantidade` horários entre `de` e `ate`: divide o intervalo em fatias iguais e
 * escolhe um ponto aleatório no miolo de cada fatia (10% de margem em cada borda), então dois
 * envios nunca ficam colados. Se o intervalo não comporta `quantidade` envios com
 * ESPACO_MINIMO_MS entre eles, devolve menos — o resto fica para o dia seguinte.
 */
export function sortearHorarios(quantidade: number, de: Date, ate: Date, rnd: () => number = Math.random): Date[] {
  const total = ate.getTime() - de.getTime()
  if (quantidade <= 0 || total <= 0) return []
  const cabe = Math.max(1, Math.floor(total / ESPACO_MINIMO_MS))
  const n = Math.min(quantidade, cabe)
  const fatia = total / n
  return Array.from({ length: n }, (_, i) => {
    const inicioFatia = de.getTime() + i * fatia
    return new Date(Math.round(inicioFatia + fatia * (0.1 + 0.8 * rnd())))
  })
}

// ── Datas em São Paulo (UTC-3 fixo, sem horário de verão desde 2019) ─────────

/** "YYYY-MM-DD" do dia em São Paulo. */
export function dataSP(agora: Date = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

/** Instante (UTC) correspondente a `hora` ("HH:MM" ou "HH:MM:SS") do dia `data` em São Paulo. */
export function instanteSP(data: string, hora: string): Date {
  const [hh, mm] = hora.split(':')
  return new Date(`${data}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00-03:00`)
}

/** "HH:MM" → minutos do dia. */
export function minutosDoDia(hora: string): number {
  const [hh, mm] = hora.split(':').map(Number)
  return hh * 60 + mm
}

// ── Lista colada pelo usuário ─────────────────────────────────────────────────

export type ContatoLista = { celular: string; nome: string | null }

/** Só dígitos, com DDI 55 quando vier só DDD+número (10 ou 11 dígitos). Inválido → null. */
export function normalizarCelular(bruto: string): string | null {
  let n = bruto.replace(/\D/g, '')
  if (n.length === 10 || n.length === 11) n = `55${n}`
  return n.length >= 12 && n.length <= 15 ? n : null
}

/**
 * Uma linha por contato, número e nome em qualquer ordem e separados por ; , tab, | ou espaço
 * ("Maria; 21 99999-0000", "5521999990000 João Silva", só o número). Números repetidos ficam só
 * na primeira aparição. Devolve também as linhas que não tinham um número válido.
 */
export function interpretarLista(texto: string): { contatos: ContatoLista[]; invalidas: string[] } {
  const contatos: ContatoLista[] = []
  const invalidas: string[] = []
  const vistos = new Set<string>()

  for (const linhaBruta of texto.split(/\r?\n/)) {
    const linha = linhaBruta.trim()
    if (!linha) continue
    const trechoNumero = linha.match(/[+(]?\d[\d\s().-]{7,}\d/)
    const celular = trechoNumero ? normalizarCelular(trechoNumero[0]) : null
    if (!celular) { invalidas.push(linha); continue }
    if (vistos.has(celular)) continue
    vistos.add(celular)

    const nome = linha.replace(trechoNumero![0], ' ').replace(/[;,|\t]+/g, ' ').replace(/\s+/g, ' ').trim()
    contatos.push({ celular, nome: nome ? nome.slice(0, 80) : null })
  }
  return { contatos, invalidas }
}

// ── Texto da mensagem ─────────────────────────────────────────────────────────

/**
 * Texto do contato de posição `indice`: alterna entre a mensagem e as variações (rodízio, para
 * não repetir o mesmo texto em sequência) e troca {{nome}} pelo nome do contato — some com ele
 * (e com o espaço que sobrar antes da pontuação) quando o contato não tem nome.
 */
export function montarTexto(mensagem: string, variacoes: string[], indice: number, nome: string | null): string {
  const textos = [mensagem, ...variacoes].filter(t => t.trim())
  const base = textos.length ? textos[Math.abs(indice) % textos.length] : ''
  return base
    .replace(/\{\{\s*nome\s*\}\}/gi, nome?.trim() || '')
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
