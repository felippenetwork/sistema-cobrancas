import Link from 'next/link'
import { Plus, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { formatarCelular } from '@/lib/validations/celular'
import { excluirClienteAction } from './_actions/clientes'

export const metadata = { title: 'Clientes' }

const PER_PAGE = 50

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const { q, page: pageParam } = await searchParams
  const busca = q?.trim() ?? ''
  const page  = Math.max(1, parseInt(pageParam ?? '1') || 1)

  const supabase = await createClient()

  let query = supabase
    .from('clientes')
    .select('id, nome, sobrenome, celular, email')
    .is('deleted_at', null)
    .order('nome', { ascending: true })
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1)

  if (busca) {
    query = query.or(
      `nome.ilike.%${busca}%,sobrenome.ilike.%${busca}%,email.ilike.%${busca}%`,
    )
  }

  const { data: clientes } = await query

  // Contagem total para exibir vs limite e paginação
  const { count: total } = await supabase
    .from('clientes')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)

  const totalPages = Math.ceil((total ?? 0) / PER_PAGE)

  return (
    <div className="p-8">

      {/* Cabeçalho */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Clientes</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{total ?? 0} cadastrado{(total ?? 0) !== 1 ? 's' : ''}</p>
        </div>
        <Link
          href="/clientes/novo"
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Novo cliente
        </Link>
      </div>

      {/* Busca */}
      <form className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q"
            defaultValue={busca}
            placeholder="Buscar por nome ou e-mail..."
            className="w-full rounded-md border border-border bg-input py-2 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          Buscar
        </button>
        {busca && (
          <Link
            href="/clientes"
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
          >
            Limpar
          </Link>
        )}
      </form>

      {/* Tabela / vazio */}
      {!clientes?.length ? (
        <div className="rounded-lg border border-border bg-card py-20 text-center">
          <p className="text-sm text-muted-foreground">
            {busca ? 'Nenhum cliente encontrado para esta busca.' : 'Nenhum cliente cadastrado ainda.'}
          </p>
          {!busca && (
            <Link href="/clientes/novo" className="mt-3 block text-sm text-primary transition hover:opacity-80">
              Cadastrar primeiro cliente
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                {['Nome', 'Celular', 'E-mail', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clientes.map(c => (
                <tr key={c.id} className="bg-card transition-colors hover:bg-accent/20">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {(c as any).nome} {(c as any).sobrenome}
                  </td>
                  <td className="monetary px-4 py-3 text-muted-foreground">
                    {formatarCelular((c as any).celular)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{(c as any).email}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/clientes/${c.id}`}
                        className="text-xs text-primary transition hover:opacity-80"
                      >
                        Editar
                      </Link>
                      <form action={excluirClienteAction}>
                        <input type="hidden" name="cliente_id" value={c.id} />
                        <button
                          type="submit"
                          className="text-xs text-destructive transition hover:opacity-70"
                        >
                          Excluir
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>Página {page} de {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/clientes?${new URLSearchParams({ ...(busca && { q: busca }), page: String(page - 1) })}`}
                className="rounded-md border border-border px-3 py-1.5 transition hover:text-foreground"
              >
                Anterior
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/clientes?${new URLSearchParams({ ...(busca && { q: busca }), page: String(page + 1) })}`}
                className="rounded-md border border-border px-3 py-1.5 transition hover:text-foreground"
              >
                Próxima
              </Link>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
