'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { sanitizarLocalPart } from '@/lib/email/template'
import { cifrarSegredo } from '@/lib/crypto/segredos'
import { mpRequest } from '@/lib/mercadopago/client'
import { PIX_PROVEDORES } from '@/lib/pagamentos/tipos'
import { revalidatePath } from 'next/cache'

export type ActionState = { error: string | null; success?: boolean }

async function getConta() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: conta } = await supabase
    .from('contas').select('id').eq('owner_user_id', user.id).single()
  if (!conta) throw new Error('Conta não encontrada.')
  return { supabase, contaId: conta.id as string }
}

// ── Salvar credenciais EfiBanK PIX ──────────────────────────────────────────
export async function salvarEfiBankAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    const clientId     = (formData.get('efi_client_id')     as string)?.trim() || null
    const clientSecret = (formData.get('efi_client_secret') as string)?.trim() || null
    const pixKey       = (formData.get('efi_pix_key')       as string)?.trim() || null
    const certBase64   = (formData.get('efi_cert_base64')   as string)?.trim() || null
    const sandbox      = formData.get('efi_sandbox') === 'true'

    const { error } = await supabase.from('configuracoes').upsert(
      {
        conta_id:          contaId,
        efi_client_id:     clientId,
        efi_client_secret: clientSecret,
        efi_pix_key:       pixKey,
        efi_cert_base64:   certBase64,
        efi_sandbox:       sandbox,
      },
      { onConflict: 'conta_id' },
    )

    if (error) return { error: error.message }
    revalidatePath('/configuracoes')
    return { error: null, success: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// ── Mercado Pago (PIX do cliente final): Access Token + Webhook Secret, ambos cifrados ──
// A Orders API (lib/mercadopago/pix.ts) não aceita notification_url por requisição — o Mercado
// Pago só chama a URL fixa configurada no painel do PRÓPRIO app da conta. Por isso o dono também
// cola a Secret Key gerada lá (usada para validar a assinatura do webhook), além do Access Token.
const schemaTokenMp   = z.string().trim().min(20).max(300).regex(/^(APP_USR|TEST)-[A-Za-z0-9_-]+$/)
const schemaSecretoMp = z.string().trim().min(10).max(300)

export async function salvarMercadoPagoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    if (formData.get('remover') === 'true') {
      const { error } = await supabase.from('configuracoes')
        .update({ mp_access_token: null, mp_webhook_secret: null }).eq('conta_id', contaId)
      if (error) {
        console.error('[salvarMercadoPago] remover', { contaId, error })
        return { error: 'Não foi possível remover as credenciais. Tente novamente.' }
      }
      // Provedor ativo sem credencial só geraria erro no Atendimento: volta para a EfiBank.
      const { error: provErr } = await supabase
        .from('configuracoes').update({ pix_provedor: 'efibank' }).eq('conta_id', contaId).eq('pix_provedor', 'mercadopago')
      if (provErr) console.error('[salvarMercadoPago] voltar provedor', { contaId, provErr })
      revalidatePath('/configuracoes')
      return { error: null, success: true }
    }

    // Campo em branco = mantém o valor já salvo (o input é password e nunca é preenchido de volta).
    const tokenBruto  = (formData.get('mp_access_token') as string | null)?.trim() || null
    const secretoBruto = (formData.get('mp_webhook_secret') as string | null)?.trim() || null
    if (!tokenBruto && !secretoBruto) return { error: 'Informe o Access Token e/ou a Secret Key do webhook.' }

    const patch: { conta_id: string; mp_access_token?: string; mp_webhook_secret?: string } = { conta_id: contaId }

    if (tokenBruto) {
      const parsed = schemaTokenMp.safeParse(tokenBruto)
      if (!parsed.success) {
        return { error: 'Access Token inválido. Cole o token de produção completo da sua conta Mercado Pago (começa com APP_USR-).' }
      }

      // Confere o token no próprio Mercado Pago antes de guardar: pega erro de colagem na hora.
      let validacao
      try {
        validacao = await mpRequest('/users/me', { method: 'GET', token: parsed.data })
      } catch (err) {
        console.error('[salvarMercadoPago] validação de rede', { contaId, motivo: err instanceof Error ? err.message : String(err) })
        return { error: 'Não foi possível validar o token agora (Mercado Pago indisponível). Tente novamente.' }
      }
      if (validacao.status === 401 || validacao.status === 403) {
        return { error: 'O Mercado Pago recusou este Access Token. Confira se copiou o token de produção completo.' }
      }
      if (!validacao.ok) {
        return { error: `Não foi possível validar o token (Mercado Pago respondeu ${validacao.status}). Tente novamente.` }
      }

      try {
        patch.mp_access_token = cifrarSegredo(parsed.data)
      } catch (err) {
        console.error('[salvarMercadoPago] cifra token', { contaId, motivo: err instanceof Error ? err.message : String(err) })
        return { error: 'O servidor não está configurado para guardar credenciais com segurança. Avise o suporte.' }
      }
    }

    if (secretoBruto) {
      const parsed = schemaSecretoMp.safeParse(secretoBruto)
      if (!parsed.success) return { error: 'Secret Key do webhook inválida.' }
      try {
        patch.mp_webhook_secret = cifrarSegredo(parsed.data)
      } catch (err) {
        console.error('[salvarMercadoPago] cifra secret', { contaId, motivo: err instanceof Error ? err.message : String(err) })
        return { error: 'O servidor não está configurado para guardar credenciais com segurança. Avise o suporte.' }
      }
    }

    const { error } = await supabase.from('configuracoes').upsert(patch, { onConflict: 'conta_id' })
    if (error) {
      console.error('[salvarMercadoPago] gravar', { contaId, error })
      return { error: 'Não foi possível salvar. Tente novamente.' }
    }

    revalidatePath('/configuracoes')
    return { error: null, success: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function salvarProvedorPixAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    const parsed = z.enum(PIX_PROVEDORES).safeParse(formData.get('pix_provedor'))
    if (!parsed.success) return { error: 'Provedor de PIX inválido.' }
    const provedor = parsed.data

    const { data: cfg, error: cfgErr } = await supabase
      .from('configuracoes')
      .select('efi_client_id, efi_client_secret, efi_pix_key, efi_cert_base64, mp_access_token, mp_webhook_secret')
      .eq('conta_id', contaId)
      .maybeSingle()
    if (cfgErr) {
      console.error('[salvarProvedorPix] leitura', { contaId, cfgErr })
      return { error: 'Não foi possível ler a configuração. Tente novamente.' }
    }

    const configurado = provedor === 'mercadopago'
      ? !!(cfg?.mp_access_token && cfg.mp_webhook_secret)
      : !!(cfg?.efi_client_id && cfg.efi_client_secret && cfg.efi_pix_key && cfg.efi_cert_base64)
    if (!configurado) {
      return { error: `Configure primeiro as credenciais do ${provedor === 'mercadopago' ? 'Mercado Pago' : 'EfiBank'}.` }
    }

    const { error } = await supabase
      .from('configuracoes')
      .upsert({ conta_id: contaId, pix_provedor: provedor }, { onConflict: 'conta_id' })
    if (error) {
      console.error('[salvarProvedorPix] gravar', { contaId, error })
      return { error: 'Não foi possível salvar o provedor. Tente novamente.' }
    }

    revalidatePath('/configuracoes')
    return { error: null, success: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// ── Salvar dados da empresa + remetente de e-mail ────────────────────────────
export async function salvarConfiguracoesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { supabase, contaId } = await getConta()

    // Dados da empresa
    const nomeComercial = (formData.get('nome_comercial') as string).trim()
    const cpfCnpj       = (formData.get('cpf_cnpj')       as string).trim()
    const endereco      = (formData.get('endereco')        as string).trim()
    const contato       = (formData.get('contato')         as string).trim()

    const { error: cfgErr, count: cfgCount } = await supabase.from('configuracoes').upsert(
      { conta_id: contaId, nome_comercial: nomeComercial || null, cpf_cnpj: cpfCnpj || null,
        endereco: endereco || null, contato: contato || null },
      { onConflict: 'conta_id', count: 'exact' },
    )
    if (cfgErr) return { error: `Erro ao salvar empresa: ${cfgErr.message}` }
    if (cfgCount === 0) return { error: 'Sem permissão para salvar dados da empresa. Verifique sua conta.' }

    // Remetente de e-mail (opcional — só salva se local_part informado)
    const localPartRaw = (formData.get('local_part') as string).trim()
    const fromName     = (formData.get('from_name')  as string).trim()

    if (localPartRaw) {
      const localPart = sanitizarLocalPart(localPartRaw)

      if (!localPart) {
        return { error: 'Nome do remetente inválido após sanitização. Use letras, números, ponto e hífen.' }
      }

      const { error: remErr } = await supabase.from('email_remetente').upsert(
        { conta_id: contaId, local_part: localPart, from_name: fromName || null, modo: 'compartilhado' },
        { onConflict: 'conta_id' },
      )

      if (remErr?.code === '23505') {
        return { error: 'Este nome de remetente não está disponível. Tente outro.' }
      }
      if (remErr) return { error: remErr.message }
    }

  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }

  revalidatePath('/configuracoes')
  return { error: null, success: true }
}
