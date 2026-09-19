// Supabase em memória para testes de rotas/serviços que usam o client admin.
// Reproduz o que importa para provar comportamento: filtros, UPDATE condicional
// (o "claim atômico" só afeta a linha se o filtro de status ainda bater) e
// injeção de falhas — nada de rede, nada de banco real.

type Linha = Record<string, any>
type Operacao = 'select' | 'update' | 'insert'
type Filtro =
  | { tipo: 'eq' | 'neq' | 'lte' | 'is'; col: string; val: unknown }
  | { tipo: 'in'; col: string; val: unknown[] }
  | { tipo: 'not-is'; col: string; val: unknown }

export type Consulta = {
  tabela: string
  operacao: Operacao
  patch?: Linha
  filtros: Filtro[]
}

export type FalhaInjetada = {
  tabela: string
  operacao: Operacao
  /** Só falha quando esta função retorna true (ex.: patch.status === 'enviado'). */
  quando?: (consulta: Consulta) => boolean
  /** Quantas vezes falhar antes de voltar a funcionar. */
  vezes: number
}

export class FakeDb {
  readonly tabelas: Record<string, Linha[]>
  readonly consultas: Consulta[] = []
  falhas: FalhaInjetada[] = []
  private seq = 0

  constructor(tabelas: Record<string, Linha[]> = {}) {
    this.tabelas = tabelas
  }

  linhas(tabela: string): Linha[] {
    return (this.tabelas[tabela] ??= [])
  }

  /** Updates executados numa tabela, na ordem — útil para checar tentativas/retries. */
  updates(tabela: string): Consulta[] {
    return this.consultas.filter(c => c.tabela === tabela && c.operacao === 'update')
  }

  cliente() {
    return { from: (tabela: string) => this.construtor(tabela) }
  }

  private construtor(tabela: string) {
    const consulta: Consulta = { tabela, operacao: 'select', filtros: [] }
    let inserir: Linha[] = []
    let retornaLinhas = false
    let ordem: { col: string; asc: boolean } | undefined
    let limite: number | undefined

    const executar = async (unica: boolean): Promise<{ data: any; error: any }> => {
      this.consultas.push({ ...consulta, filtros: [...consulta.filtros] })

      const falha = this.falhas.find(f =>
        f.vezes > 0 && f.tabela === tabela && f.operacao === consulta.operacao && (!f.quando || f.quando(consulta)),
      )
      if (falha) {
        falha.vezes--
        return { data: null, error: { message: 'falha simulada', code: 'XX000' } }
      }

      const casa = (linha: Linha) => consulta.filtros.every(f => {
        const v = linha[f.col]
        switch (f.tipo) {
          case 'eq':     return v === f.val
          case 'neq':    return v !== f.val
          case 'lte':    return v != null && (v as any) <= (f.val as any)
          case 'is':     return f.val === null ? v == null : v === f.val
          case 'in':     return f.val.includes(v)
          case 'not-is': return f.val === null ? v != null : v !== f.val
        }
      })

      let resultado: Linha[]
      if (consulta.operacao === 'insert') {
        resultado = inserir.map(l => ({ id: `fake-${++this.seq}`, ...l }))
        this.linhas(tabela).push(...resultado)
      } else if (consulta.operacao === 'update') {
        resultado = this.linhas(tabela).filter(casa)
        resultado.forEach(l => Object.assign(l, consulta.patch))
      } else {
        resultado = this.linhas(tabela).filter(casa)
        if (ordem) {
          const { col, asc } = ordem
          resultado = [...resultado].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
        }
      }
      if (limite !== undefined) resultado = resultado.slice(0, limite)

      const devolve = consulta.operacao === 'select' || retornaLinhas
      if (!devolve) return { data: null, error: null }
      if (unica) {
        if (resultado.length > 1) return { data: null, error: { message: 'mais de uma linha', code: 'PGRST116' } }
        return { data: resultado[0] ?? null, error: null }
      }
      return { data: resultado, error: null }
    }

    const api: any = {
      select() { if (consulta.operacao !== 'select') retornaLinhas = true; return api },
      update(patch: Linha) { consulta.operacao = 'update'; consulta.patch = patch; return api },
      insert(linhas: Linha | Linha[]) { consulta.operacao = 'insert'; inserir = Array.isArray(linhas) ? linhas : [linhas]; return api },
      eq(col: string, val: unknown) { consulta.filtros.push({ tipo: 'eq', col, val }); return api },
      neq(col: string, val: unknown) { consulta.filtros.push({ tipo: 'neq', col, val }); return api },
      lte(col: string, val: unknown) { consulta.filtros.push({ tipo: 'lte', col, val }); return api },
      is(col: string, val: unknown) { consulta.filtros.push({ tipo: 'is', col, val }); return api },
      in(col: string, val: unknown[]) { consulta.filtros.push({ tipo: 'in', col, val }); return api },
      not(col: string, op: string, val: unknown) {
        if (op !== 'is') throw new Error(`FakeDb: not(${op}) não suportado`)
        consulta.filtros.push({ tipo: 'not-is', col, val })
        return api
      },
      order(col: string, opts?: { ascending?: boolean }) { ordem = { col, asc: opts?.ascending !== false }; return api },
      limit(n: number) { limite = n; return api },
      maybeSingle: () => executar(true),
      single: () => executar(true),
      then: (ok: (v: any) => unknown, err?: (e: unknown) => unknown) => executar(false).then(ok, err),
    }
    return api
  }
}
