import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { passosDoModelo } from '@/lib/disparo/passos'
import { lerAcoes } from '@/lib/disparo/acoes'
import { TemplatesClient } from './_components/templates-client'

export const dynamic = 'force-dynamic'

export default async function WaTemplatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).maybeSingle()

  if (!conta) redirect('/login')
  const contaId = conta.id

  const { data: modelos, error } = await supabase
    .from('modelos_wa')
    .select('id, nome, corpo, passos, criado_em, acoes')
    .eq('conta_id', contaId)
    .order('criado_em', { ascending: false })
  if (error) {
    console.error('[modelos] leitura falhou', { contaId, error })
    throw new Error('Não foi possível carregar os modelos.')
  }

  // Modelo antigo (só texto) aparece como uma caixinha de texto.
  return (
    <TemplatesClient
      modelos={(modelos ?? []).map(m => ({
        id: m.id, nome: m.nome, criado_em: m.criado_em, passos: passosDoModelo(m) ?? [],
        acoes: lerAcoes(m.acoes),
      }))}
    />
  )
}
