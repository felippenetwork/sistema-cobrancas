'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, ShieldCheck, Settings, CreditCard } from 'lucide-react'
import { adminSignOutAction } from '../_actions/auth'
import { SairButton } from '@/app/_components/sair-button'

const LINKS = [
  { href: '/admin/contas',      label: 'Contas',           icon: <Users       className="h-4 w-4 text-muted-foreground" /> },
  { href: '/admin/assinaturas', label: 'Assinaturas',      icon: <CreditCard  className="h-4 w-4 text-muted-foreground" /> },
  { href: '/admin/admins',      label: 'Administradores',  icon: <ShieldCheck className="h-4 w-4 text-muted-foreground" /> },
  { href: '/admin/plataforma',  label: 'Plataforma',       icon: <Settings    className="h-4 w-4 text-muted-foreground" /> },
]

export default function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">

      {/* Marca */}
      <div className="border-b border-border px-5 py-5">
        <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Cobranx</p>
        <p className="mt-0.5 text-sm font-semibold text-foreground">Admin</p>
      </div>

      {/* Navegação */}
      <nav className="flex-1 space-y-0.5 px-3 py-4">
        <p className="mb-2 px-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Gestão
        </p>
        {LINKS.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent ${
              pathname.startsWith(href) ? 'bg-accent font-medium text-foreground' : 'text-foreground'
            }`}
          >
            {icon}
            {label}
          </Link>
        ))}
      </nav>

      {/* Sair com confirmação (PRD §6.11) */}
      <div className="border-t border-border px-3 py-3">
        <SairButton signOutAction={adminSignOutAction} />
      </div>

    </aside>
  )
}
