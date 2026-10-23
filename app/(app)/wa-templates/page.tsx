import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
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

  const { data: modelos } = await supabase
    .from('modelos_wa')
    .select('id, nome, corpo, criado_em')
    .eq('conta_id', contaId)
    .order('criado_em', { ascending: false })

  return <TemplatesClient modelos={modelos ?? []} />
}
