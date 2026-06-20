import { createClient } from '@supabase/supabase-js'

// Cliente com service_role — bypassa RLS inteiramente.
// Usar SOMENTE em Server Actions e Route Handlers no servidor.
// NUNCA importar em arquivos com 'use client'. NUNCA em NEXT_PUBLIC_*.
export function createAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY ausente.')

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
