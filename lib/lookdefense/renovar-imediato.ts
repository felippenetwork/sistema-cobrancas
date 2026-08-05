import { createAdminClient } from '@/lib/supabase/admin'

const LD_BASE = 'https://gesapioffice.com/api'

const LD_HEADERS = {
  'Content-Type':  'application/json',
  'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Referer':       'https://gesapioffice.com/',
  'Origin':        'https://gesapioffice.com',
  'Accept':        'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9',
}

async function ldLogin(username: string, password: string) {
  const res = await fetch(`${LD_BASE}/login`, {
    method:  'POST',
    headers: LD_HEADERS,
    body:    JSON.stringify({ username, password, code: '' }),
    cache:   'no-store',
  })
  if (!res.ok) throw new Error(`LookDefense login falhou (${res.status})`)
  const json = await res.json()
  if (!json.access_token || !json.crypt_pass) throw new Error('LookDefense: resposta de login inesperada')
  return { token: json.access_token as string, cryptPass: json.crypt_pass as string }
}

async function ldListarUsuarios(token: string, cryptPass: string): Promise<{ id: number; username: string }[]> {
  const url = new URL(`${LD_BASE}/users-iptv`)
  url.searchParams.set('reg_password', cryptPass)
  const res = await fetch(url.toString(), {
    headers: { ...LD_HEADERS, Authorization: `Bearer ${token}` },
    cache:   'no-store',
  })
  if (!res.ok) throw new Error(`LookDefense listar usuários falhou (${res.status})`)
  const json = await res.json()
  return Array.isArray(json) ? json : (json.data ?? [])
}

async function ldRenovar(token: string, cryptPass: string, userId: number): Promise<void> {
  const res = await fetch(`${LD_BASE}/users-iptv/${userId}`, {
    method:  'PUT',
    headers: { ...LD_HEADERS, Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ action: 1, credits: 1, reg_password: cryptPass }),
    cache:   'no-store',
  })
  if (!res.ok) throw new Error(`LookDefense renovar usuário ${userId} falhou (${res.status})`)
}

/**
 * Tenta renovar o plano IPTV no LookDefense imediatamente após confirmar pagamento.
 * Se falhar, mantém o registro em 'pendente' para o cron tentar novamente.
 * Retorna true se renovou com sucesso.
 */
export async function renovarLookDefenseImediato(
  contaId: string,
  baixaExternaId: string,
  loginExterno: string,
  tentativasAtuais: number,
): Promise<boolean> {
  const supabase = createAdminClient()
  const agora    = new Date().toISOString()

  // Credenciais LookDefense da conta
  const { data: cfg } = await supabase
    .from('configuracoes')
    .select('ld_username, ld_password')
    .eq('conta_id', contaId)
    .maybeSingle()

  if (!cfg?.ld_username || !cfg?.ld_password) {
    await supabase.from('baixas_externas').update({
      status:        'erro',
      erro:          'Credenciais LookDefense não configuradas em Configurações.',
      processado_em: agora,
    }).eq('id', baixaExternaId)
    return false
  }

  try {
    const { token, cryptPass } = await ldLogin(cfg.ld_username as string, cfg.ld_password as string)
    const usuarios = await ldListarUsuarios(token, cryptPass)
    const usuario  = usuarios.find(u => u.username === loginExterno)

    if (!usuario) {
      await supabase.from('baixas_externas').update({
        status:        'erro',
        erro:          `Usuário '${loginExterno}' não encontrado no painel LookDefense.`,
        tentativas:    tentativasAtuais + 1,
        processado_em: agora,
      }).eq('id', baixaExternaId)
      return false
    }

    await ldRenovar(token, cryptPass, usuario.id)

    await supabase.from('baixas_externas').update({
      status:        'processado',
      erro:          null,
      tentativas:    tentativasAtuais + 1,
      processado_em: agora,
    }).eq('id', baixaExternaId)

    return true
  } catch (err: any) {
    console.error('[renovarLookDefenseImediato]', err?.message)
    // Mantém 'pendente' para o cron tentar novamente
    await supabase.from('baixas_externas').update({
      tentativas:    tentativasAtuais + 1,
      erro:          err?.message ?? 'Erro desconhecido',
      processado_em: agora,
    }).eq('id', baixaExternaId)
    return false
  }
}
