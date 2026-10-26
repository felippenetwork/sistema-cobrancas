import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ChatbotClient } from './_components/chatbot-client'

export const dynamic = 'force-dynamic'

export default async function ChatbotPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: conta } = await supabase.from('contas').select('id').eq('owner_user_id', user.id).maybeSingle()
  if (!conta) redirect('/login')
  const contaId = conta.id

  const [fluxos, conversas, conexao] = await Promise.all([
    supabase.from('bot_fluxos')
      .select('id, nome, ativo, etapas, gatilho_palavras, gatilho_etiquetas_nomes, excluir_etiquetas_nomes, atualizado_em')
      .eq('conta_id', contaId).order('criado_em', { ascending: true }),
    supabase.from('bot_conversas')
      .select('id, celular, nome, status, etapa_id, atualizado_em, bot_fluxos(nome)')
      .eq('conta_id', contaId).order('atualizado_em', { ascending: false }).limit(200),
    supabase.from('conexoes').select('status, webhook_segredo').eq('conta_id', contaId).maybeSingle(),
  ])
  const erro = fluxos.error ?? conversas.error ?? conexao.error
  if (erro) {
    console.error('[chatbot] leitura da página falhou', { contaId, erro })
    throw new Error('Não foi possível carregar o chatbot.')
  }

  return (
    <ChatbotClient
      conectado={conexao.data?.status === 'conectado'}
      recebimentoLigado={!!conexao.data?.webhook_segredo}
      fluxos={(fluxos.data ?? []).map(f => ({
        id: f.id, nome: f.nome, ativo: f.ativo,
        etapas: Array.isArray(f.etapas) ? f.etapas.length : 0,
        palavras: f.gatilho_palavras, etiquetas: f.gatilho_etiquetas_nomes, excluidas: f.excluir_etiquetas_nomes,
      }))}
      conversas={(conversas.data ?? []).map(c => ({
        id: c.id, celular: c.celular, nome: c.nome, status: c.status, atualizado_em: c.atualizado_em,
        emEtapa: !!c.etapa_id,
        fluxo: (c.bot_fluxos as { nome: string } | null)?.nome ?? null,
      }))}
    />
  )
}
