import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Rotas públicas para tenants
const TENANT_PUBLIC = ['/login', '/reset-senha', '/nova-senha', '/auth/', '/plano-expirado', '/sem-conta', '/descadastrar/']

function isTenantPublic(p: string) {
  return TENANT_PUBLIC.some(r => p.startsWith(r))
}

export async function middleware(request: NextRequest) {
  // IMPORTANTE: não adicionar lógica de negócio entre getUser() e o return.
  // O padrão Supabase SSR exige que as cookies de sessão sejam propagadas aqui.
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as Record<string, unknown>),
          )
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // ── Rotas admin (/admin/*) ──────────────────────────────────────────────
  // Fluxo completamente separado do tenant: login próprio, guard próprio.
  if (pathname.startsWith('/admin')) {
    if (!user && pathname !== '/admin/login') {
      const url = request.nextUrl.clone()
      url.pathname = '/admin/login'
      return NextResponse.redirect(url)
    }
    if (user && pathname === '/admin/login') {
      const url = request.nextUrl.clone()
      url.pathname = '/admin'
      return NextResponse.redirect(url)
    }
    return response
  }

  // ── Rotas tenant ────────────────────────────────────────────────────────
  if (!user && !isTenantPublic(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  if (user && pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Verificar status da conta — redireciona se suspensa ou expirada
  if (user && !isTenantPublic(pathname)) {
    const { data: conta } = await supabase
      .from('contas')
      .select('status')
      .eq('owner_user_id', user.id)
      .maybeSingle()

    if (conta && conta.status !== 'ativa') {
      const url = request.nextUrl.clone()
      url.pathname = '/plano-expirado'
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: [
    // Exclui assets estáticos, imagens e rotas de webhook (chamadas por serviços externos sem auth)
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
