'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, FileText, Wallet, Smartphone, Bell, CreditCard, ScrollText, Settings } from 'lucide-react'
import { signOutAction } from '../_actions/auth'
import { SairButton } from '@/app/_components/sair-button'

type NavItem = { href: string; label: string; icon: React.ReactNode }

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard',  icon: <LayoutDashboard className="h-4 w-4" /> },
]

const NAV_COBRANCAS: NavItem[] = [
  { href: '/clientes',  label: 'Clientes',  icon: <Users       className="h-4 w-4" /> },
  { href: '/cobrancas', label: 'Cobranças', icon: <FileText    className="h-4 w-4" /> },
  { href: '/caixa',     label: 'Caixa',     icon: <Wallet      className="h-4 w-4" /> },
  { href: '/notificacao',    label: 'Notificação',   icon: <Bell        className="h-4 w-4" /> },
  { href: '/tipo-pagamento', label: 'Tipo Pag.',    icon: <CreditCard  className="h-4 w-4" /> },
  { href: '/log',            label: 'Log',           icon: <ScrollText  className="h-4 w-4" /> },
  { href: '/conexao',        label: 'Conexão WA',   icon: <Smartphone  className="h-4 w-4" /> },
  { href: '/configuracoes',  label: 'Configurações', icon: <Settings    className="h-4 w-4" /> },
]

export function AppSidebar({ nomeEmpresa }: { nomeEmpresa: string }) {
  const pathname = usePathname()

  function cls(href: string) {
    const active = pathname === href || pathname.startsWith(href + '/')
    return [
      'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors',
      active
        ? 'bg-accent font-medium text-foreground'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    ].join(' ')
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">

      {/* Marca */}
      <div className="border-b border-border px-5 py-5">
        <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Cobranx</p>
        <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{nomeEmpresa}</p>
      </div>

      {/* Navegação */}
      <nav className="flex-1 space-y-0.5 px-3 py-4">

        <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Geral
        </p>
        {NAV.map(item => (
          <Link key={item.href} href={item.href} className={cls(item.href)}>
            {item.icon}
            {item.label}
          </Link>
        ))}

        <p className="mb-1 mt-4 px-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Cobranças
        </p>
        {NAV_COBRANCAS.map(item => (
          <Link key={item.href} href={item.href} className={cls(item.href)}>
            {item.icon}
            {item.label}
          </Link>
        ))}

      </nav>

      {/* Sair com confirmação (PRD §6.11) */}
      <div className="border-t border-border px-3 py-3">
        <SairButton signOutAction={signOutAction} />
      </div>

    </aside>
  )
}
