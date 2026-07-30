// Retorna os templates aprovados da Meta para a conta autenticada.
// Usa meta_waba_id + meta_access_token salvos em configuracoes.

import { NextResponse } from 'next/server'
import { getConta } from '@/lib/conta'

export type MetaTemplate = {
  id: string
  name: string
  status: string
  category: string
  language: string
  body: string      // texto do componente BODY (para preview)
}

export async function GET() {
  try {
    const { supabase, contaId } = await getConta()

    const { data: cfg } = await supabase
      .from('configuracoes')
      .select('meta_access_token, meta_waba_id')
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!cfg?.meta_access_token || !cfg?.meta_waba_id) {
      return NextResponse.json({ error: 'Meta API não configurada (token ou WABA ID ausente).' }, { status: 400 })
    }

    const url = new URL(`https://graph.facebook.com/v20.0/${cfg.meta_waba_id}/message_templates`)
    url.searchParams.set('fields', 'name,status,category,language,components')
    url.searchParams.set('status', 'APPROVED')
    url.searchParams.set('limit', '100')

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${cfg.meta_access_token}` },
      next:    { revalidate: 60 },  // cache 60s
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: (err as any)?.error?.message ?? `Meta erro ${res.status}` },
        { status: res.status },
      )
    }

    const json = await res.json()
    const templates: MetaTemplate[] = ((json.data ?? []) as any[]).map(t => ({
      id:       t.id,
      name:     t.name,
      status:   t.status,
      category: t.category,
      language: t.language,
      body:     (t.components ?? []).find((c: any) => c.type === 'BODY')?.text ?? '',
    }))

    return NextResponse.json({ templates })

  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro desconhecido.' },
      { status: 500 },
    )
  }
}
