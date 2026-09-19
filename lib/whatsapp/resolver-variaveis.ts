// Resolução de variáveis de template WhatsApp (#VALOR# #NOMECOMPLETO# #NOME# #PIX# #SAUDACAO# #VENCIMENTO#)
// compartilhada pelas rotas server-side do Next.js (cron uazapi, forçar envio no Log).
// O worker da VPS mantém cópia própria em worker/src/variaveis.ts (código morto).
//
// Falha de banco NUNCA vira texto: antes, se a consulta da parcela falhasse, o valor caía
// em `R$ 0,00` e a mensagem seguia para o cliente com o valor errado. Agora lança
// VariaveisIndisponiveisError e quem chama decide (tentar depois ou cancelar).

import type { SupabaseClient } from '@supabase/supabase-js'
import { formatBRL, formatData } from '@/lib/utils/format'
import { substituirVariaveis } from '@/lib/utils/variaveis'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>

export type MotivoVariaveisIndisponiveis = 'erro_banco' | 'nao_encontrado'

export class VariaveisIndisponiveisError extends Error {
  constructor(readonly motivo: MotivoVariaveisIndisponiveis, detalhe: string) {
    super(`Não foi possível montar a mensagem (${motivo}): ${detalhe}`)
    this.name = 'VariaveisIndisponiveisError'
  }
}

type Consulta<T> = { data: T | null; error: { message: string } | null }

function exigir<T>(resultado: Consulta<T>, recurso: string): T {
  if (resultado.error) throw new VariaveisIndisponiveisError('erro_banco', `${recurso}: ${resultado.error.message}`)
  if (!resultado.data) throw new VariaveisIndisponiveisError('nao_encontrado', recurso)
  return resultado.data
}

function escolherSaudacao(saudacoes: Consulta<{ texto: string }[]>): string {
  // Saudação é cosmética: se falhar, cai na padrão em vez de impedir o envio.
  if (saudacoes.error) console.error('[resolver-variaveis] saudações indisponíveis, usando padrão', saudacoes.error.message)
  const textos = (saudacoes.data ?? []).map(s => s.texto)
  return textos.length ? textos[Math.floor(Math.random() * textos.length)] : 'Olá!'
}

// Resolve apenas variáveis que NÃO dependem de parcela (uso: mensagens agendadas avulsas).
export async function resolverVariaveisLeves(
  supabase: AnySupabase,
  { contaId, clienteId, template }: { contaId: string; clienteId: string; template: string },
): Promise<string> {
  const [cliente, saudacoes] = await Promise.all([
    supabase.from('clientes').select('nome, sobrenome').eq('id', clienteId).eq('conta_id', contaId).maybeSingle(),
    supabase.from('saudacoes').select('texto').eq('conta_id', contaId),
  ])

  const { nome, sobrenome } = exigir<{ nome: string | null; sobrenome: string | null }>(cliente, 'cliente')

  return template
    .replace(/#NOMECOMPLETO#/g, `${nome ?? ''} ${sobrenome ?? ''}`.trim())
    .replace(/#NOME#/g,         nome ?? '')
    .replace(/#SAUDACAO#/g,     escolherSaudacao(saudacoes))
}

export async function resolverVariaveis(
  supabase: AnySupabase,
  { contaId, parcelaId, clienteId, template, cobrancaId }: {
    contaId: string; parcelaId: string; clienteId: string; template: string; cobrancaId?: string | null
  },
): Promise<string> {
  // Meio de pagamento: específico da cobrança (se informado) ou o padrão da conta.
  // Só consulta quando o template usa #PIX# — não há por que falhar por um dado que não será usado.
  async function buscarPix(): Promise<string | null> {
    if (!template.includes('#PIX#')) return null

    if (cobrancaId) {
      const cob = await supabase.from('cobrancas').select('meio_pagamento_id')
        .eq('id', cobrancaId).eq('conta_id', contaId).maybeSingle()
      if (cob.error) throw new VariaveisIndisponiveisError('erro_banco', `cobrança: ${cob.error.message}`)
      const meioId = cob.data?.meio_pagamento_id
      if (meioId) {
        const meio = await supabase.from('meios_pagamento').select('mensagem')
          .eq('id', meioId).eq('conta_id', contaId).maybeSingle()
        if (meio.error) throw new VariaveisIndisponiveisError('erro_banco', `meio de pagamento: ${meio.error.message}`)
        if (meio.data?.mensagem) return meio.data.mensagem
      }
    }
    const padrao = await supabase.from('meios_pagamento').select('mensagem')
      .eq('conta_id', contaId).eq('is_padrao', true).maybeSingle()
    if (padrao.error) throw new VariaveisIndisponiveisError('erro_banco', `meio de pagamento padrão: ${padrao.error.message}`)
    return padrao.data?.mensagem ?? null
  }

  const [parcela, cliente, saudacoes, pix] = await Promise.all([
    supabase.from('parcelas').select('valor, data_vencimento').eq('id', parcelaId).eq('conta_id', contaId).maybeSingle(),
    supabase.from('clientes').select('nome, sobrenome').eq('id', clienteId).eq('conta_id', contaId).maybeSingle(),
    supabase.from('saudacoes').select('texto').eq('conta_id', contaId),
    buscarPix(),
  ])

  const dadosParcela = exigir<{ valor: number; data_vencimento: string }>(parcela, 'parcela')
  const dadosCliente = exigir<{ nome: string | null; sobrenome: string | null }>(cliente, 'cliente')

  return substituirVariaveis(template, {
    valor:        formatBRL(dadosParcela.valor),
    nomecompleto: `${dadosCliente.nome ?? ''} ${dadosCliente.sobrenome ?? ''}`.trim(),
    nome:         dadosCliente.nome ?? '',
    pix:          pix ?? '(Pix não configurado)',
    saudacao:     escolherSaudacao(saudacoes),
    vencimento:   formatData(dadosParcela.data_vencimento),
  })
}
