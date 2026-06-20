import { createBrowserClient } from '@supabase/ssr'

// Instância browser: usa anon key + sessão do usuário (sujeita a RLS).
// Nunca usar service role no browser.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
