'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMesAno } from '@/lib/utils/format'

export function MonthSelector({ mesParam }: { mesParam: string }) {
  const router = useRouter()

  function nav(offset: number) {
    const [ano, mes] = mesParam.split('-').map(Number)
    const d = new Date(ano, mes - 1 + offset, 1)
    const novo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    router.push(`/cobrancas?mes=${novo}`)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => nav(-1)}
        aria-label="Mês anterior"
        className="rounded-md border border-border p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="w-36 text-center text-sm font-medium text-foreground">
        {formatMesAno(mesParam)}
      </span>
      <button
        onClick={() => nav(1)}
        aria-label="Próximo mês"
        className="rounded-md border border-border p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}
