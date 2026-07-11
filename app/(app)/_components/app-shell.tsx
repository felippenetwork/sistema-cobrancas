'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, MessageSquare, Users, FileText, Menu } from 'lucide-react'
import { AppSidebar } from './app-sidebar'

const BOTTOM_NAV = [
  { href: '/dashboard',   label: 'Início',      Icon: LayoutDashboard },
  { href: '/atendimento', label: 'Atendimento', Icon: MessageSquare },
  { href: '/clientes',    label: 'Clientes',    Icon: Users },
  { href: '/cobrancas',   label: 'Cobranças',   Icon: FileText },
]

export function AppShell({
  children,
  nomeEmpresa,
}: {
  children: React.ReactNode
  nomeEmpresa: string
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  return (
    <div className="flex min-h-screen bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <AppSidebar
        nomeEmpresa={nomeEmpresa}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Conteúdo principal — padding inferior só no mobile para a bottom nav */}
        <main className="flex-1 overflow-auto pb-16 md:pb-0">
          {children}
        </main>

        {/* ── Bottom navigation — mobile only ── */}
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-border bg-card md:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {BOTTOM_NAV.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                className={[
                  'flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground',
                ].join(' ')}
              >
                <Icon className={['h-5 w-5 transition-transform', active ? 'scale-110' : ''].join(' ')} />
                {label}
              </Link>
            )
          })}

          {/* Mais — abre o sidebar completo */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium text-muted-foreground transition-colors"
          >
            <Menu className="h-5 w-5" />
            Mais
          </button>
        </nav>
      </div>
    </div>
  )
}
