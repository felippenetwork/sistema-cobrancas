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
    .from('contas')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (conta) {
    contaId = conta.id
  } else {
    const { data: membro } = await supabase
      .from('membros_conta')
      .select('conta_id')
      .eq('user_id', user.id)
      .eq('ativo', true)
      .maybeSingle()
    contaId = membro?.conta_id ?? null
  }

  if (!contaId) redirect('/login')

  const [{ data: modelos }, { data: cfg }] = await Promise.all([
    supabase
      .from('modelos_wa')
      .select('id, nome, categoria, idioma, corpo, cabecalho, rodape, status, meta_template_id, criado_em, atualizado_em')
      .eq('conta_id', contaId)
      .order('criado_em', { ascending: false }),
    supabase
      .from('configuracoes')
      .select('meta_api_ativo, meta_access_token, meta_phone_number_id')
      .eq('conta_id', contaId)
      .maybeSingle(),
  ])

  const metaConfigurada = !!(cfg?.meta_api_ativo && cfg?.meta_access_token && cfg?.meta_phone_number_id)

  return <TemplatesClient modelos={modelos ?? []} metaConfigurada={metaConfigurada} />
}
