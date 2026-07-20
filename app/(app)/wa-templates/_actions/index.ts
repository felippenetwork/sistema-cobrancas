'use server'

import { revalidatePath } from 'next/cache'
import { getConta } from '@/lib/conta'

type Result = { error: string | null }

export async function criarModeloAction(
  _prev: Result,
  formData: FormData,
): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    const nome      = (formData.get('nome')      as string)?.trim()
    const categoria = (formData.get('categoria') as string) ?? 'UTILITY'
    const idioma    = (formData.get('idioma')    as string) ?? 'pt_BR'
    const corpo     = (formData.get('corpo')     as string)?.trim()
    const cabecalho = (formData.get('cabecalho') as string)?.trim() || null
    const rodape    = (formData.get('rodape')    as string)?.trim() || null

    if (!nome)  return { error: 'Informe o nome do template.' }
    if (!corpo) return { error: 'O corpo da mensagem é obrigatório.' }
    if (!['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(categoria)) {
      return { error: 'Categoria inválida.' }
    }

    // Extrair variáveis {{1}}, {{2}}, ... do corpo
    const vars = [...corpo.matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1])
    const variaveisUnicas = [...new Set(vars)].sort()

    const { error } = await supabase.from('modelos_wa').insert({
      conta_id:   contaId,
      nome,
      categoria: categoria as 'UTILITY' | 'MARKETING' | 'AUTHENTICATION',
      idioma,
      corpo,
      cabecalho,
      rodape,
      variaveis: variaveisUnicas.length ? variaveisUnicas : null,
      status:    'rascunho',
    })

    if (error) return { error: error.message }

    revalidatePath('/wa-templates')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function atualizarModeloAction(
  modeloId: string,
  campos: { nome?: string; corpo?: string; cabecalho?: string | null; rodape?: string | null; categoria?: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION' },
): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    const { error } = await supabase
      .from('modelos_wa')
      .update({ ...campos, atualizado_em: new Date().toISOString() })
      .eq('id', modeloId)
      .eq('conta_id', contaId)
      .eq('status', 'rascunho') // apenas rascunho pode ser editado

    if (error) return { error: error.message }

    revalidatePath('/wa-templates')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function submeterAprovacaoAction(modeloId: string): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    // Busca o modelo e as credenciais Meta em paralelo
    const [{ data: modelo }, { data: cfg }] = await Promise.all([
      supabase
        .from('modelos_wa')
        .select('nome, categoria, idioma, corpo, cabecalho, rodape, status')
        .eq('id', modeloId)
        .eq('conta_id', contaId)
        .maybeSingle(),
      supabase
        .from('configuracoes')
        .select('meta_access_token, meta_waba_id')
        .eq('conta_id', contaId)
        .maybeSingle(),
    ])

    if (!modelo) return { error: 'Template não encontrado.' }
    if (modelo.status !== 'rascunho') return { error: 'Apenas rascunhos podem ser submetidos.' }

    if (!cfg?.meta_access_token || !cfg?.meta_waba_id) {
      return { error: 'Configure as credenciais da Meta API em Configurações → WhatsApp Business API antes de submeter.' }
    }

    // Monta os componentes do template
    const components: object[] = []

    if (modelo.cabecalho) {
      components.push({ type: 'HEADER', format: 'TEXT', text: modelo.cabecalho })
    }

    // Extrai variáveis para gerar exemplos obrigatórios
    const vars = [...(modelo.corpo as string).matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1])
    const unicasOrdenadas = [...new Set(vars)].sort()
    const exemplos = unicasOrdenadas.map(() => 'exemplo')

    const bodyComp: Record<string, unknown> = { type: 'BODY', text: modelo.corpo }
    if (exemplos.length > 0) {
      bodyComp.example = { body_text: [exemplos] }
    }
    components.push(bodyComp)

    if (modelo.rodape) {
      components.push({ type: 'FOOTER', text: modelo.rodape })
    }

    // Chama a Meta Graph API
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${cfg.meta_waba_id}/message_templates`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.meta_access_token}`,
        },
        body: JSON.stringify({
          name:       (modelo.nome as string).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
          language:   modelo.idioma ?? 'pt_BR',
          category:   modelo.categoria,
          components,
        }),
      },
    )

    const json = await res.json().catch(() => ({}))

    if (!res.ok) {
      const msg = json?.error?.error_user_msg ?? json?.error?.message ?? `Erro Meta API: ${res.status}`
      return { error: msg }
    }

    const metaTemplateId = json?.id ?? null

    // Atualiza o modelo com o ID retornado pela Meta
    const { error: updErr } = await supabase
      .from('modelos_wa')
      .update({
        status:           'em_analise',
        meta_template_id: metaTemplateId,
        atualizado_em:    new Date().toISOString(),
      })
      .eq('id', modeloId)
      .eq('conta_id', contaId)

    if (updErr) return { error: updErr.message }

    revalidatePath('/wa-templates')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function excluirModeloAction(modeloId: string): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    const { error } = await supabase
      .from('modelos_wa')
      .delete()
      .eq('id', modeloId)
      .eq('conta_id', contaId)
      .eq('status', 'rascunho') // apenas rascunhos podem ser excluídos

    if (error) return { error: error.message }

    revalidatePath('/wa-templates')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
