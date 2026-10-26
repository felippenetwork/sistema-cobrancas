import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { schemaEtapas } from '@/lib/chatbot/fluxo'
import { FluxoEditor, type FluxoInicial } from '../_components/fluxo-editor'

export const dynamic = 'force-dynamic'

export default async function FluxoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: conta } = await supabase.from('contas').select('id').eq('owner_user_id', user.id).maybeSingle()
  if (!conta) redirect('/login')

  if (id === 'novo') return <FluxoEditor fluxoId={null} inicial={null} />
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()

  const { data: f, error } = await supabase
    .from('bot_fluxos')
    .select('id, nome, ativo, etapas, gatilho_palavras, gatilho_etiquetas, gatilho_etiquetas_nomes, excluir_etiquetas, excluir_etiquetas_nomes, palavras_humano, msg_nao_entendi, msg_humano, aviso_numero')
    .eq('id', id).eq('conta_id', conta.id).maybeSingle()
  if (error) {
    console.error('[chatbot] leitura do fluxo falhou', { contaId: conta.id, id, error })
    throw new Error('Não foi possível carregar o fluxo.')
  }
  if (!f) notFound()

  const etapas = schemaEtapas.safeParse(f.etapas)
  const par = (ids: string[], nomes: string[]) => ids.map((x, i) => ({ id: x, nome: nomes[i] ?? x }))
  const inicial: FluxoInicial = {
    nome: f.nome, ativo: f.ativo, etapas: etapas.success ? etapas.data : [],
    gatilhoPalavras: f.gatilho_palavras,
    gatilhoEtiquetas: par(f.gatilho_etiquetas, f.gatilho_etiquetas_nomes),
    excluirEtiquetas: par(f.excluir_etiquetas, f.excluir_etiquetas_nomes),
    palavrasHumano: f.palavras_humano, msgNaoEntendi: f.msg_nao_entendi, msgHumano: f.msg_humano,
    avisoNumero: f.aviso_numero ?? '',
  }
  return <FluxoEditor fluxoId={f.id} inicial={inicial} />
}
