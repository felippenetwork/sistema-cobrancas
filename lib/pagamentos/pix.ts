import { createAdminClient } from '@/lib/supabase/admin'
import { criarCobrancaPix } from '@/lib/efibank/pix'
import { criarCobrancaPixMercadoPago } from '@/lib/mercadopago/pix'
import type { PixGerado, PixProvedor } from './tipos'

// Ponto único de geração de PIX da cobrança do cliente final: usa o provedor ativo da conta
// (configuracoes.pix_provedor, default 'efibank'). O VALOR nunca vem do client — é o da parcela,
// lido aqui com o conta_id da sessão; assim ninguém gera PIX de R$ 1 para uma parcela de R$ 150,
// nem PIX de parcela de outra conta ou já paga.
export async function criarCobrancaPixDaConta(
  contaId:    string,
  parcelaId:  string,
  descricao?: string,
): Promise<PixGerado | { erro: string }> {
  const supabase = createAdminClient()

  const { data: parcela, error: parcelaErr } = await supabase
    .from('parcelas')
    .select('valor, status')
    .eq('id', parcelaId)
    .eq('conta_id', contaId)
    .maybeSingle()

  if (parcelaErr) {
    console.error('[criarCobrancaPixDaConta] leitura da parcela falhou', { contaId, parcelaId, parcelaErr })
    return { erro: 'Não foi possível consultar a parcela. Tente novamente.' }
  }
  if (!parcela) return { erro: 'Parcela não encontrada.' }
  if (parcela.status === 'paga') return { erro: 'Esta parcela já está paga.' }

  const { data: cfg, error: cfgErr } = await supabase
    .from('configuracoes')
    .select('pix_provedor')
    .eq('conta_id', contaId)
    .maybeSingle()

  if (cfgErr) {
    console.error('[criarCobrancaPixDaConta] leitura da configuração falhou', { contaId, cfgErr })
    return { erro: 'Não foi possível ler a configuração de PIX. Tente novamente.' }
  }

  const provedor: PixProvedor = cfg?.pix_provedor === 'mercadopago' ? 'mercadopago' : 'efibank'
  const valor = Number(parcela.valor)

  return provedor === 'mercadopago'
    ? criarCobrancaPixMercadoPago(contaId, parcelaId, valor, descricao)
    : criarCobrancaPix(contaId, parcelaId, valor, descricao)
}
