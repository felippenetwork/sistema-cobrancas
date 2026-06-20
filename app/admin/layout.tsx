import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminSidebar from './_components/admin-sidebar'

// Guard: verifica autenticação E papel de admin antes de renderizar.
// Todos os dados de negócio acessados nas rotas filhas usam createAdminClient()
// (service role, bypassa RLS) — nunca o cliente anon do tenant.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Não autenticado: o middleware já redirecionou qualquer rota protegida para
  // /admin/login. Se chegamos aqui sem sessão é porque SOMOS a página de login.
  // Renderiza children diretamente — sem redirect, sem loop.
  if (!user) return <>{children}</>

  // Autenticado: verifica papel de admin via RLS (policy padm_all + is_admin()).
  const { data: adminRow } = await supabase
    .from('plataforma_admins')
    .select('user_id')
    .maybeSingle()

  if (!adminRow) {
    // Usuário autenticado mas sem papel admin → app do tenant
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
