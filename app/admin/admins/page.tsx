import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { AdicionarAdminForm } from './adicionar-admin-form'
import { removerAdminAction } from '../_actions/admins'

export const metadata = { title: 'Administradores — Admin' }

export default async function AdminsPage() {
  const admin   = createAdminClient()
  const supabase = await createClient()

  const { data: { user: currentUser } } = await supabase.auth.getUser()

  const { data: adminRows } = await admin
    .from('plataforma_admins')
    .select('user_id, created_at')
    .order('created_at', { ascending: true })

  // Busca e-mails de todos os usuários em lote (evita N+1)
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const emailPor = new Map(users.map(u => [u.id, u.email ?? '—']))

  const admins = (adminRows ?? []).map(r => ({
    user_id:      r.user_id as string,
    email:        emailPor.get(r.user_id as string) ?? '—',
    created_at:   r.created_at as string,
    isCurrentUser: r.user_id === currentUser?.id,
  }))

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('pt-BR')
  }

  return (
    <div className="p-8">

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Administradores</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Usuários com acesso completo ao painel admin.
        </p>
      </div>

      {/* Lista de admins */}
      <div className="mb-10 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30">
            <tr>
              {['E-mail', 'Adicionado em', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {admins.map(a => (
              <tr key={a.user_id} className="bg-card transition-colors hover:bg-accent/20">
                <td className="px-4 py-3 text-foreground">
                  {a.email}
                  {a.isCurrentUser && (
                    <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      você
                    </span>
                  )}
                </td>
                <td className="monetary px-4 py-3 text-muted-foreground">{fmtDate(a.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  {/* Não pode remover a si mesmo nem o último admin */}
                  {!a.isCurrentUser && admins.length > 1 && (
                    <form action={removerAdminAction}>
                      <input type="hidden" name="user_id" value={a.user_id} />
                      <button
                        type="submit"
                        className="text-xs text-destructive transition hover:opacity-70"
                      >
                        Remover
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Adicionar novo admin */}
      <div className="max-w-md rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Adicionar administrador</h2>
        <AdicionarAdminForm />
      </div>

    </div>
  )
}
