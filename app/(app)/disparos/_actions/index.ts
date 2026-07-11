'use server'

import { revalidatePath } from 'next/cache'
import { getConta } from '@/lib/conta'

type Result = { error: string | null }

export async function criarCampanhaAction(
  _prev: { error: string | null; id?: string },
  formData: FormData,
): Promise<{ error: string | null; id?: string }> {
  try {
    const { supabase, contaId } = await getConta()

    const nome     = (formData.get('nome')      as string)?.trim()
    const modeloId = (formData.get('modelo_id') as string) || null

    if (!nome) return { error: 'Informe o nome da campanha.' }

    const { data, error } = await supabase
      .from('campanhas_wa')
      .insert({ conta_id: contaId, nome, modelo_id: modeloId, status: 'rascunho' })
      .select('id')
      .single()

    if (error) return { error: error.message }

    revalidatePath('/disparos')
    return { error: null, id: data.id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function adicionarDestinatariosAction(
  campanhaId: string,
  celulares: string[],
): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    // Valida que a campanha pertence à conta
    const { data: campanha } = await supabase
      .from('campanhas_wa')
      .select('id, status')
      .eq('id', campanhaId)
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!campanha) return { error: 'Campanha não encontrada.' }
    if (campanha.status !== 'rascunho') return { error: 'Só é possível editar campanhas em rascunho.' }

    // Busca clientes por celular para vincular cliente_id
    const celularesUnicos = [...new Set(celulares.map(c => c.replace(/\D/g, '').trim()).filter(Boolean))]

    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, celular')
      .eq('conta_id', contaId)
      .in('celular', celularesUnicos)

    const clienteMap = new Map(clientes?.map(c => [c.celular, c.id]) ?? [])

    const destinatarios = celularesUnicos.map(celular => ({
      campanha_id: campanhaId,
      conta_id:    contaId,
      celular,
      cliente_id:  clienteMap.get(celular) ?? null,
      status:      'pendente' as const,
    }))

    const { error: insErr } = await supabase
      .from('campanha_destinatarios')
      .insert(destinatarios)

    if (insErr) return { error: insErr.message }

    // Atualiza contador
    await supabase
      .from('campanhas_wa')
      .update({ total_destinatarios: celularesUnicos.length })
      .eq('id', campanhaId)

    revalidatePath('/disparos')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function enviarCampanhaAction(campanhaId: string): Promise<{
  error: string | null
  enviados?: number
  falhas?: number
}> {
  try {
    const { supabase, contaId } = await getConta()

    // Valida campanha e modelo
    const { data: campanha } = await supabase
      .from('campanhas_wa')
      .select('id, status, modelo_id, modelos_wa(corpo, cabecalho, status)')
      .eq('id', campanhaId)
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!campanha) return { error: 'Campanha não encontrada.' }
    if (!['rascunho', 'agendada'].includes(campanha.status)) {
      return { error: 'Campanha já foi enviada ou está em andamento.' }
    }

    const modelo = (campanha as any).modelos_wa
    if (!modelo) return { error: 'Selecione um template antes de enviar.' }

    // Busca conexão uazapiGO
    const { data: conexao } = await supabase
      .from('conexoes')
      .select('uazapi_instance_token, status')
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!conexao?.uazapi_instance_token || conexao.status !== 'conectado') {
      return { error: 'WhatsApp não está conectado. Verifique a conexão.' }
    }

    const uazapiUrl = process.env.UAZAPI_URL?.replace(/\/$/, '')
    if (!uazapiUrl) return { error: 'Configuração UAZAPI_URL ausente.' }

    // Busca destinatários pendentes (máximo 100 por execução)
    const { data: destinatarios } = await supabase
      .from('campanha_destinatarios')
      .select('id, celular, variaveis')
      .eq('campanha_id', campanhaId)
      .eq('conta_id', contaId)
      .eq('status', 'pendente')
      .limit(100)

    if (!destinatarios?.length) return { error: 'Nenhum destinatário pendente.' }

    // Marca campanha como enviando
    await supabase
      .from('campanhas_wa')
      .update({ status: 'enviando', iniciado_em: new Date().toISOString() })
      .eq('id', campanhaId)

    let enviados = 0
    let falhas   = 0

    for (const dest of destinatarios) {
      // Interpola variáveis no corpo do template: {{1}} → variaveis[0]
      let texto = modelo.corpo as string
      const vars = (dest.variaveis as string[] | null) ?? []
      vars.forEach((v, i) => {
        texto = texto.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), v)
      })

      try {
        const res = await fetch(`${uazapiUrl}/send/text`, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            token: conexao.uazapi_instance_token,
          },
          body: JSON.stringify({ number: dest.celular, text: texto }),
        })

        if (res.ok) {
          const json = await res.json().catch(() => ({}))
          await supabase
            .from('campanha_destinatarios')
            .update({ status: 'enviado', wa_id: json?.id ?? null, enviado_em: new Date().toISOString() })
            .eq('id', dest.id)
          enviados++
        } else {
          const err = await res.text().catch(() => String(res.status))
          await supabase
            .from('campanha_destinatarios')
            .update({ status: 'falhou', erro: err })
            .eq('id', dest.id)
          falhas++
        }
      } catch (e) {
        await supabase
          .from('campanha_destinatarios')
          .update({ status: 'falhou', erro: String(e) })
          .eq('id', dest.id)
        falhas++
      }

      // Intervalo de 1s entre envios para evitar ban
      await new Promise(r => setTimeout(r, 1_000))
    }

    // Verifica se todos foram processados
    const { count: pendentes } = await supabase
      .from('campanha_destinatarios')
      .select('id', { count: 'exact', head: true })
      .eq('campanha_id', campanhaId)
      .eq('status', 'pendente')

    const concluida = (pendentes ?? 0) === 0

    await supabase
      .from('campanhas_wa')
      .update({
        status:        concluida ? 'concluida' : 'enviando',
        total_enviados: enviados,
        total_falhas:   falhas,
        concluido_em:   concluida ? new Date().toISOString() : null,
      })
      .eq('id', campanhaId)

    revalidatePath('/disparos')
    return { error: null, enviados, falhas }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function cancelarCampanhaAction(campanhaId: string): Promise<Result> {
  try {
    const { supabase, contaId } = await getConta()

    const { error } = await supabase
      .from('campanhas_wa')
      .update({ status: 'cancelada' })
      .eq('id', campanhaId)
      .eq('conta_id', contaId)
      .in('status', ['rascunho', 'agendada'])

    if (error) return { error: error.message }

    revalidatePath('/disparos')
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
