import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Instância servidor: usa anon key + cookies da sessão (sujeita a RLS).
// Para bypassar RLS (workers, admin server actions), usar SUPABASE_SERVICE_KEY
// diretamente com createClient de @supabase/supabase-js — nunca aqui.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Ignorado em Server Components — o middleware cuida do refresh.
          }
        },
      },
    },
  )
}
