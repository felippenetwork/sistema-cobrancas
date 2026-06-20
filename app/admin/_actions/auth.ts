'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function adminSignOutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/admin/login')
}
