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

export async function GET(req: Request) {
  try {
    const { supabase, contaId } = await getConta()

    const { data: cfg } = await supabase
      .from('configuracoes')
      .select('meta_access_token, meta_waba_id, meta_phone_number_id')
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!cfg?.meta_access_token) {
      return NextResponse.json({ error: 'Token de acesso Meta não configurado. Acesse Configurações → WhatsApp Business API.' }, { status: 400 })
    }

    if (!cfg?.meta_waba_id) {
      return NextResponse.json({
        error: 'WABA ID não configurado. Acesse Configurações → WhatsApp Business API e preencha o campo "WhatsApp Business Account ID" (diferente do Phone Number ID).',
        code: 'WABA_ID_MISSING',
      }, { status: 400 })
    }

    // Filtro de status opcional — ?status=APPROVED (padrão: todos)
    const { searchParams } = new URL(req.url)
    const statusFilter = searchParams.get('status')

    const url = new URL(`https://graph.facebook.com/v20.0/${cfg.meta_waba_id}/message_templates`)
    url.searchParams.set('fields', 'name,status,category,language,components')
    url.searchParams.set('limit', '200')
    if (statusFilter) url.searchParams.set('status', statusFilter)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${cfg.meta_access_token}` },
      cache: 'no-store',
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const msg = (err as any)?.error?.message ?? `Meta erro ${res.status}`
      // Erro específico: ID errado (Phone Number ID no lugar do WABA ID)
      if (msg.includes('nonexisting field') || msg.includes('message_templates')) {
        return NextResponse.json({
          error: `WABA ID inválido. O ID configurado (${cfg.meta_waba_id}) parece ser um Phone Number ID, não um WhatsApp Business Account ID. Corrija em Configurações → WhatsApp Business API.`,
          code: 'WABA_ID_INVALID',
        }, { status: 400 })
      }
      return NextResponse.json({ error: msg }, { status: res.status })
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

    return NextResponse.json({ templates, total: templates.length })

  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro desconhecido.' },
      { status: 500 },
    )
  }
}
