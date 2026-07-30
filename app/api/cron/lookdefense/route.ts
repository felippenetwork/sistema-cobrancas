// Cron: processa a fila baixas_externas para renovação automática de planos IPTV no LookDefense.
// Chamado diariamente pela Vercel (ou cron-job.org para maior frequência).

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 300

const LD_BASE = 'https://gesapioffice.com/api'

interface LdLoginResponse {
  access_token: string
  crypt_pass:   string
}

interface LdUser {
  id:       number
  username: string
}

async function ldLogin(username: string, password: string): Promise<LdLoginResponse> {
  const res = await fetch(`${LD_BASE}/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username, password, code: '' }),
    cache:   'no-store',
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`LookDefense login falhou (${res.status}): ${txt}`)
  }
  const json = await res.json()
  if (!json.access_token || !json.crypt_pass) {
    throw new Error('LookDefense login: resposta inesperada — sem access_token ou crypt_pass')
  }
  return { access_token: json.access_token, crypt_pass: json.crypt_pass }
}

async function ldListarUsuarios(token: string, cryptPass: string): Promise<LdUser[]> {
  const url = new URL(`${LD_BASE}/users-iptv`)
  url.searchParams.set('reg_password', cryptPass)
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache:   'no-store',
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`LookDefense listar usuários falhou (${res.status}): ${txt}`)
  }
  const json = await res.json()
  // A API retorna { data: [...] } ou diretamente um array
  return Array.isArray(json) ? json : (json.data ?? [])
}

async function ldRenovar(token: string, cryptPass: string, userId: number): Promise<void> {
  const res = await fetch(`${LD_BASE}/users-iptv/${userId}`, {
    method:  'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 1, credits: 1, reg_password: cryptPass }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`LookDefense renovar usuário ${userId} falhou (${res.status}): ${txt}`)
  }
}

export async function GET(req: NextRequest) {
  // Autenticação do cron
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // Buscar todas as baixas pendentes com tipo lookdefense
  const { data: baixas, error: errBaixas } = await supabase
    .from('baixas_externas')
    .select('id, conta_id, login_externo, tipo_integracao, tentativas')
    .eq('status', 'pendente')
    .in('tipo_integracao', ['lookdefense_iptv', 'lookdefense_p2p'])
    .lt('tentativas', 3)
    .order('criado_em', { ascending: true })
    .limit(100)

  if (errBaixas) {
    return NextResponse.json({ error: errBaixas.message }, { status: 500 })
  }

  if (!baixas || baixas.length === 0) {
    return NextResponse.json({ processadas: 0, mensagem: 'Nenhuma baixa pendente.' })
  }

  // Agrupar por conta_id para fazer apenas 1 login por conta
  const porConta = new Map<string, typeof baixas>()
  for (const b of baixas) {
    const lista = porConta.get(b.conta_id) ?? []
    lista.push(b)
    porConta.set(b.conta_id, lista)
  }

  let totalProcessadas = 0
  let totalErros        = 0

  for (const [contaId, itens] of porConta) {
    // Buscar credenciais desta conta
    const { data: cfg } = await supabase
      .from('configuracoes')
      .select('ld_username, ld_password')
      .eq('conta_id', contaId)
      .maybeSingle()

    if (!cfg?.ld_username || !cfg?.ld_password) {
      // Marcar todos da conta como erro de configuração
      const ids = itens.map(i => i.id)
      await supabase
        .from('baixas_externas')
        .update({
          status:        'erro',
          erro:          'Credenciais LookDefense não configuradas em Configurações.',
          processado_em: new Date().toISOString(),
        })
        .in('id', ids)
      totalErros += ids.length
      continue
    }

    let token:     string
    let cryptPass: string
    let usuarios:  LdUser[]

    try {
      ;({ access_token: token, crypt_pass: cryptPass } = await ldLogin(cfg.ld_username, cfg.ld_password))
      usuarios = await ldListarUsuarios(token, cryptPass)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const ids = itens.map(i => i.id)
      await supabase
        .from('baixas_externas')
        .update({
          tentativas:    itens[0].tentativas + 1,
          erro:          msg,
          processado_em: new Date().toISOString(),
        })
        .in('id', ids)
      totalErros += ids.length
      continue
    }

    // Processar cada baixa desta conta
    for (const baixa of itens) {
      const usuarioLd = usuarios.find(u => u.username === baixa.login_externo)

      if (!usuarioLd) {
        await supabase
          .from('baixas_externas')
          .update({
            status:        'erro',
            erro:          `Usuário '${baixa.login_externo}' não encontrado no painel LookDefense.`,
            tentativas:    baixa.tentativas + 1,
            processado_em: new Date().toISOString(),
          })
          .eq('id', baixa.id)
        totalErros++
        continue
      }

      try {
        await ldRenovar(token, cryptPass, usuarioLd.id)
        await supabase
          .from('baixas_externas')
          .update({
            status:        'processado',
            erro:          null,
            tentativas:    baixa.tentativas + 1,
            processado_em: new Date().toISOString(),
          })
          .eq('id', baixa.id)
        totalProcessadas++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await supabase
          .from('baixas_externas')
          .update({
            tentativas:    baixa.tentativas + 1,
            erro:          msg,
            processado_em: new Date().toISOString(),
          })
          .eq('id', baixa.id)
        totalErros++
      }
    }
  }

  return NextResponse.json({ processadas: totalProcessadas, erros: totalErros })
}
