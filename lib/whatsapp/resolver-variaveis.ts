// Resolução de variáveis de template WhatsApp (#VALOR# #NOMECOMPLETO# #NOME# #PIX# #SAUDACAO# #VENCIMENTO#)
// compartilhada pelas rotas server-side do Next.js (cron uazapi, forçar envio no Log).
// O worker da VPS mantém cópia própria em worker/src/variaveis.ts — processo Node separado.

import type { SupabaseClient } from '@supabase/supabase-js'
import { formatBRL, formatData } from '@/lib/utils/format'
import { substituirVariaveis } from '@/lib/utils/variaveis'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>

// Resolve apenas variáveis que NÃO dependem de parcela (uso: mensagens agendadas avulsas).
export async function resolverVariaveisLeves(
  supabase: AnySupabase,
  { contaId, clienteId, template }: { contaId: string; clienteId: string; template: string },
): Promise<string> {
  const [{ data: cliente }, { data: saudacoes }] = await Promise.all([
    supabase.from('clientes').select('nome, sobrenome').eq('id', clienteId).single(),
    supabase.from('saudacoes').select('texto').eq('conta_id', contaId),
  ])

  const textos   = (saudacoes ?? []).map((s: { texto: string }) => s.texto)
  const saudacao = textos.length ? textos[Math.floor(Math.random() * textos.length)] : 'Olá!'
  const nome      = cliente?.nome ?? ''
  const sobrenome = cliente?.sobrenome ?? ''

  return template
    .replace(/#NOMECOMPLETO#/g, `${nome} ${sobrenome}`.trim())
    .replace(/#NOME#/g,         nome)
    .replace(/#SAUDACAO#/g,     saudacao)
}

export async function resolverVariaveis(
  supabase: AnySupabase,
  { contaId, parcelaId, clienteId, template, cobrancaId }: {
    contaId: string; parcelaId: string; clienteId: string; template: string; cobrancaId?: string | null
  },
): Promise<string> {
  // Meio de pagamento: específico da cobrança (se informado) ou o padrão da conta
  async function buscarPix() {
    if (cobrancaId) {
      const { data: cob } = await supabase
        .from('cobrancas').select('meio_pagamento_id').eq('id', cobrancaId).maybeSingle()
      const meioId = cob?.meio_pagamento_id
      if (meioId) {
        const { data: meio } = await supabase
          .from('meios_pagamento').select('mensagem').eq('id', meioId).maybeSingle()
        if (meio?.mensagem) return meio
      }
    }
    const { data } = await supabase
      .from('meios_pagamento').select('mensagem').eq('conta_id', contaId).eq('is_padrao', true).maybeSingle()
    return data
  }

  const [{ data: parcela }, { data: cliente }, { data: saudacoes }, pix] = await Promise.all([
    supabase.from('parcelas').select('valor, data_vencimento').eq('id', parcelaId).single(),
    supabase.from('clientes').select('nome, sobrenome').eq('id', clienteId).single(),
    supabase.from('saudacoes').select('texto').eq('conta_id', contaId),
    buscarPix(),
  ])

  const textos   = (saudacoes ?? []).map((s: { texto: string }) => s.texto)
  const saudacao = textos.length ? textos[Math.floor(Math.random() * textos.length)] : 'Olá!'

  return substituirVariaveis(template, {
    valor:        formatBRL(parcela?.valor ?? 0),
    nomecompleto: `${cliente?.nome ?? ''} ${cliente?.sobrenome ?? ''}`.trim(),
    nome:         cliente?.nome ?? '',
    pix:          pix?.mensagem ?? '(Pix não configurado)',
    saudacao,
    vencimento:   formatData(parcela?.data_vencimento),
  })
}
