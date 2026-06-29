// Resolução e substituição de variáveis de template.
// Variáveis (notificacoes-fila §3): #VALOR# #NOMECOMPLETO# #NOME# #PIX# #SAUDACAO# #VENCIMENTO#

import { formatBRL, formatData } from './format.js'
import type { SupabaseAdmin } from './supabase.js'

export function substituirVariaveis(
  template: string,
  vars: { valor: string; nomecompleto: string; nome: string; pix: string; saudacao: string; vencimento: string },
): string {
  return template
    .replace(/#VALOR#/g,         vars.valor)
    .replace(/#NOMECOMPLETO#/g,  vars.nomecompleto)
    .replace(/#NOME#/g,          vars.nome)
    .replace(/#PIX#/g,           vars.pix)
    .replace(/#SAUDACAO#/g,      vars.saudacao)
    .replace(/#VENCIMENTO#/g,    vars.vencimento)
}

// Resolve apenas variáveis que NÃO dependem de parcela (uso: mensagens agendadas).
// Substitui #NOME#, #NOMECOMPLETO#, #SAUDACAO#. Demais tokens ficam literais.
export async function resolverVariaveisLeves(
  supabase: SupabaseAdmin,
  { contaId, clienteId, template }: { contaId: string; clienteId: string; template: string },
): Promise<string> {
  const [{ data: cliente }, { data: saudacoes }] = await Promise.all([
    supabase.from('clientes').select('nome, sobrenome').eq('id', clienteId).single(),
    supabase.from('saudacoes').select('texto').eq('conta_id', contaId),
  ])

  const textos   = (saudacoes ?? []).map((s: any) => s.texto as string)
  const saudacao = textos.length ? textos[Math.floor(Math.random() * textos.length)] : 'Olá!'
  const nome     = (cliente as any)?.nome ?? ''
  const sobrenome = (cliente as any)?.sobrenome ?? ''

  return template
    .replace(/#NOMECOMPLETO#/g, `${nome} ${sobrenome}`.trim())
    .replace(/#NOME#/g,         nome)
    .replace(/#SAUDACAO#/g,     saudacao)
}

export async function resolverVariaveis(
  supabase: SupabaseAdmin,
  { contaId, parcelaId, clienteId, template, cobrancaId }: {
    contaId: string; parcelaId: string; clienteId: string; template: string; cobrancaId?: string | null
  },
): Promise<string> {
  // Busca o meio de pagamento: específico da cobrança (se informado) ou o padrão da conta
  async function buscarPix() {
    if (cobrancaId) {
      const { data: cob } = await supabase
        .from('cobrancas').select('meio_pagamento_id').eq('id', cobrancaId).maybeSingle()
      const meioid = (cob as any)?.meio_pagamento_id
      if (meioid) {
        const { data: meio } = await supabase
          .from('meios_pagamento').select('mensagem').eq('id', meioid).maybeSingle()
        if ((meio as any)?.mensagem) return meio
      }
    }
    // fallback: padrão da conta
    const { data } = await supabase
      .from('meios_pagamento').select('mensagem').eq('conta_id', contaId).eq('is_padrao', true).maybeSingle()
    return data
  }

  const [
    { data: parcela },
    { data: cliente },
    { data: saudacoes },
    pix,
  ] = await Promise.all([
    supabase.from('parcelas').select('valor, data_vencimento').eq('id', parcelaId).single(),
    supabase.from('clientes').select('nome, sobrenome').eq('id', clienteId).single(),
    supabase.from('saudacoes').select('texto').eq('conta_id', contaId),
    buscarPix(),
  ])

  const textos   = (saudacoes ?? []).map((s: any) => s.texto as string)
  const saudacao = textos.length ? textos[Math.floor(Math.random() * textos.length)] : 'Olá!'

  return substituirVariaveis(template, {
    valor:        formatBRL(parseFloat((parcela as any)?.valor ?? '0')),
    nomecompleto: `${(cliente as any)?.nome ?? ''} ${(cliente as any)?.sobrenome ?? ''}`.trim(),
    nome:         (cliente as any)?.nome ?? '',
    pix:          (pix as any)?.mensagem ?? '(Pix não configurado)',
    saudacao,
    vencimento:   formatData((parcela as any)?.data_vencimento),
  })
}
