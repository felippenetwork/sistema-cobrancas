import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TemplatesClient } from './_components/templates-client'

export const dynamic = 'force-dynamic'

export default async function WaTemplatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let contaId: string | null = null
  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).maybeSingle()

  if (conta) {
    contaId = conta.id
  } else {
    const { data: membro } = await supabase
      .from('membros_conta').select('conta_id')
      .eq('user_id', user.id).eq('ativo', true).maybeSingle()
    contaId = membro?.conta_id ?? null
  }

  if (!contaId) redirect('/login')

  const { data: cfg } = await supabase
    .from('configuracoes')
    .select('meta_api_ativo, meta_access_token, meta_phone_number_id, meta_waba_id')
    .eq('conta_id', contaId)
    .maybeSingle()

  const metaConfigurada = !!(cfg?.meta_api_ativo && cfg?.meta_access_token && cfg?.meta_waba_id)
  const temWabaId = !!cfg?.meta_waba_id
  const temToken  = !!cfg?.meta_access_token

  return <TemplatesClient metaConfigurada={metaConfigurada} temWabaId={temWabaId} temToken={temToken} />
}
