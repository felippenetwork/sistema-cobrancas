// Impede SSG: as páginas de auth usam createBrowserClient que requer env vars
// disponíveis somente em runtime (não durante o build sem .env.local).
export const dynamic = 'force-dynamic'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
