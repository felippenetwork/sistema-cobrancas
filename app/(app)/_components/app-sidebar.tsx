'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, FileText, Wallet, Smartphone, Bell, CreditCard, ScrollText, Settings, X, CalendarClock, MessageSquare, UserCheck, Send, FilePlus } from 'lucide-react'
import { signOutAction } from '../_actions/auth'
import { SairButton } from '@/app/_components/sair-button'

type NavItem = { href: string; label: string; icon: React.ReactNode }

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
]

const NAV_COBRANCAS: NavItem[] = [
  { href: '/clientes',       label: 'Clientes',      icon: <Users      className="h-4 w-4" /> },
  { href: '/cobrancas',      label: 'Cobranças',     icon: <FileText   className="h-4 w-4" /> },
  { href: '/caixa',          label: 'Caixa',         icon: <Wallet     className="h-4 w-4" /> },
  { href: '/notificacao',    label: 'Notificação',   icon: <Bell          className="h-4 w-4" /> },
  { href: '/agendamentos',   label: 'Agendamentos',  icon: <CalendarClock className="h-4 w-4" /> },
  { href: '/tipo-pagamento', label: 'Tipo Pag.',     icon: <CreditCard className="h-4 w-4" /> },
  { href: '/log',            label: 'Log',           icon: <ScrollText className="h-4 w-4" /> },
  { href: '/atendimento',    label: 'Atendimento',   icon: <MessageSquare className="h-4 w-4" /> },
  { href: '/equipe',         label: 'Equipe',        icon: <UserCheck  className="h-4 w-4" /> },
  { href: '/wa-templates',   label: 'Templates WA',  icon: <FilePlus   className="h-4 w-4" /> },
  { href: '/disparos',       label: 'Disparos',      icon: <Send       className="h-4 w-4" /> },
  { href: '/conexao',        label: 'Conexão WA',   icon: <Smartphone className="h-4 w-4" /> },
  { href: '/configuracoes',  label: 'Configurações', icon: <Settings   className="h-4 w-4" /> },
]

export function AppSidebar({
  nomeEmpresa,
  isOpen = false,
  onClose,
}: {
  nomeEmpresa: string
  isOpen?: boolean
  onClose?: () => void
}) {
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
    <aside
      className={[
        // Mobile: painel fixo deslizante que entra pela esquerda
        'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-card',
        'transition-transform duration-300 ease-in-out',
        // Desktop (md+): retorna ao fluxo normal e sempre visível
        'md:relative md:inset-auto md:z-auto md:w-56 md:shrink-0 md:translate-x-0',
        isOpen ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}
    >
      {/* Marca + botão fechar (X visível só no mobile) */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <Image
          src="/logo.png"
          alt="Cobranx"
          width={180}
          height={56}
          className="h-14 w-auto object-contain"
          priority
        />
        <button
          onClick={onClose}
          className="ml-2 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          aria-label="Fechar menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navegação */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Geral
        </p>
        {NAV.map(item => (
          <Link key={item.href} href={item.href} className={cls(item.href)} onClick={onClose}>
            {item.icon}
            {item.label}
          </Link>
        ))}

        <p className="mb-1 mt-4 px-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Cobranças
        </p>
        {NAV_COBRANCAS.map(item => (
          <Link key={item.href} href={item.href} className={cls(item.href)} onClick={onClose}>
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Sair com confirmação */}
      <div className="border-t border-border px-3 py-3">
        <SairButton signOutAction={signOutAction} />
      </div>
    </aside>
  )
}
