'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, Loader2, Plus, Search, X } from 'lucide-react'
import type { Passo } from '@/lib/disparo/passos'
import { formatarCelular, mascararCelular } from '@/lib/validations/celular'
import { PassosEditor, midiaSemArquivo, novoPasso, paraEditavel, paraEnvio, type PassoEditavel } from '../../disparos/_components/passos-editor'
import { acaoIncompleta } from '../../disparos/_components/acoes-editor'
import { cancelarAgendamentoAntigoAction, cancelarEnvioAgendadoAction, criarEnvioAgendadoAction } from '../_actions/agendamentos'

export type LinhaAgendamento = {
  id: string
  /** Mensagem avulsa da tela antiga (notificacoes_enviadas). */
  antigo: boolean
  celular: string
  nome: string | null
  resumo: string
  agendado_para: string
  status: 'pendente' | 'enviado' | 'falhou' | 'cancelado'
  erro: string | null
  aviso: string | null
  enviado_em: string | null
}
type Cliente = { id: string; nome: string; celular: string }
type Modelo = { id: string; nome: string; passos: Passo[] }

const INPUT = 'w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20'
const LABEL = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground'

const SITUACAO: Record<LinhaAgendamento['status'], { rotulo: string; cls: string }> = {
  pendente:  { rotulo: 'Agendado',  cls: 'bg-primary/10 text-primary' },
  enviado:   { rotulo: 'Enviado',   cls: 'bg-success/10 text-success' },
  falhou:    { rotulo: 'Não saiu',  cls: 'bg-destructive/10 text-destructive' },
  cancelado: { rotulo: 'Cancelado', cls: 'bg-muted text-muted-foreground' },
}

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

const numeroLegivel = (c: string) => (c ? formatarCelular(c) : '—')

export function AgendamentosClient({ linhas, clientes, modelos }: { linhas: LinhaAgendamento[]; clientes: Cliente[]; modelos: Modelo[] }) {
  const [novo, setNovo] = useState(false)
  const [cancelando, setCancelando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const agendados = linhas.filter(l => l.status === 'pendente').sort((a, b) => a.agendado_para.localeCompare(b.agendado_para))
  const historico = linhas.filter(l => l.status !== 'pendente')

  async function cancelar(l: LinhaAgendamento) {
    setErro(null)
    setCancelando(l.id)
    const r = l.antigo ? await cancelarAgendamentoAntigoAction(l.id) : await cancelarEnvioAgendadoAction(l.id)
    setCancelando(null)
    if (r.error) setErro(r.error)
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Agendamentos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Uma mensagem para uma pessoa, no dia e na hora que você escolher. Serve para cliente cadastrado ou qualquer número.
          </p>
        </div>
        <button onClick={() => setNovo(true)}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">
          <Plus className="h-4 w-4" /> Novo agendamento
        </button>
      </div>

      {erro && <p role="alert" className="mb-4 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}

      {linhas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <CalendarClock className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Nenhum envio agendado. Quando alguém pedir para você lembrar numa hora certa, agende aqui e a mensagem sai sozinha.</p>
          <button onClick={() => setNovo(true)}
            className="mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">
            Agendar primeiro envio
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          <Secao titulo="Próximos envios" vazio="Nada agendado daqui para frente." linhas={agendados} onCancelar={cancelar} cancelando={cancelando} />
          {historico.length > 0 && <Secao titulo="Já passaram" linhas={historico} onCancelar={cancelar} cancelando={cancelando} />}
        </div>
      )}

      {novo && <NovoAgendamento clientes={clientes} modelos={modelos} onFechar={() => setNovo(false)} />}
    </div>
  )
}

function Secao({ titulo, vazio, linhas, onCancelar, cancelando }: {
  titulo: string
  vazio?: string
  linhas: LinhaAgendamento[]
  onCancelar: (l: LinhaAgendamento) => void
  cancelando: string | null
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-foreground">{titulo}</h2>
      {linhas.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {linhas.map(l => {
            const atrasado = l.status === 'pendente' && new Date(l.agendado_para).getTime() < Date.now() - 2 * 60_000
            const s = SITUACAO[l.status]
            return (
              <li key={l.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    <span className="font-medium">{l.nome ?? 'Sem nome'}</span>
                    <span className="text-muted-foreground tabular-nums"> · {numeroLegivel(l.celular)}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{l.resumo || '—'}</p>
                  {l.status === 'falhou' && l.erro && <p className="mt-0.5 text-xs text-destructive">{l.erro}</p>}
                  {l.aviso && <p className="mt-0.5 text-xs text-warning">{l.aviso}</p>}
                  {atrasado && <p className="mt-0.5 text-xs text-warning">Ainda não saiu: confira se o WhatsApp está conectado.</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted-foreground tabular-nums">{dataHora(l.enviado_em ?? l.agendado_para)}</span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.rotulo}</span>
                  {l.status === 'pendente' && (
                    <button onClick={() => onCancelar(l)} disabled={cancelando === l.id} aria-label={`Cancelar envio para ${l.nome ?? numeroLegivel(l.celular)}`}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
                      {cancelando === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      Cancelar
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Daqui a uma hora, hora cheia, em São Paulo. */
function sugestaoDeHorario(): { data: string; hora: string } {
  const em = new Date(Date.now() + 60 * 60_000)
  const data = em.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const hh = em.toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).slice(0, 2)
  return { data, hora: `${hh}:00` }
}

function NovoAgendamento({ clientes, modelos, onFechar }: { clientes: Cliente[]; modelos: Modelo[]; onFechar: () => void }) {
  const [tipo, setTipo] = useState<'cliente' | 'numero'>(clientes.length ? 'cliente' : 'numero')
  const [busca, setBusca] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [nome, setNome] = useState('')
  const [celular, setCelular] = useState('')
  const [{ data, hora }, setQuando] = useState(sugestaoDeHorario)
  const [modeloId, setModeloId] = useState('')
  const [passos, setPassos] = useState<PassoEditavel[]>(() => [novoPasso('texto', 0)])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const hoje = useMemo(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), [])
  const escolhido = clientes.find(c => c.id === clienteId)
  const encontrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const digitos = t.replace(/\D/g, '')
    return clientes
      .filter(c => !t || c.nome.toLowerCase().includes(t) || (digitos.length >= 3 && c.celular.includes(digitos)))
      .slice(0, 50)
  }, [busca, clientes])

  function usarModelo(id: string) {
    setModeloId(id)
    const m = modelos.find(x => x.id === id)
    if (m) setPassos(paraEditavel(m.passos))
  }

  async function agendar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (tipo === 'cliente' && !clienteId) { setErro('Escolha o cliente.'); return }
    if (passos.some(midiaSemArquivo)) { setErro('Uma mensagem de mídia ainda está sem arquivo.'); return }
    if (passos.some(p => p.tipo === 'acao' && acaoIncompleta(p.acao))) { setErro('Uma ação está incompleta (escolha a etiqueta ou escreva a nota).'); return }
    setSalvando(true)
    const r = await criarEnvioAgendadoAction({
      destino: tipo === 'cliente' ? { tipo, clienteId } : { tipo, celular, nome },
      passos: paraEnvio(passos),
      data, hora,
    })
    setSalvando(false)
    if (r.error) { setErro(r.error); return }
    onFechar()
  }

  const aba = (v: 'cliente' | 'numero', rotulo: string) => (
    <button type="button" role="tab" aria-selected={tipo === v} onClick={() => setTipo(v)}
      className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${tipo === v ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
      {rotulo}
    </button>
  )

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onFechar} />
      <form onSubmit={agendar} role="dialog" aria-modal="true" aria-labelledby="titulo-agendamento"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="titulo-agendamento" className="text-base font-semibold text-foreground">Novo agendamento</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-md p-1 text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section>
            <p className={LABEL}>Para quem</p>
            <div role="tablist" className="mb-3 flex gap-1 rounded-xl bg-muted p-1">
              {aba('cliente', 'Cliente cadastrado')}
              {aba('numero', 'Digitar número')}
            </div>

            {tipo === 'cliente' ? (
              clientes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                  Nenhum cliente com celular cadastrado. Use &ldquo;Digitar número&rdquo;.
                </p>
              ) : escolhido ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2.5">
                  <p className="min-w-0 truncate text-sm text-foreground">
                    <span className="font-medium">{escolhido.nome}</span>
                    <span className="text-muted-foreground tabular-nums"> · {numeroLegivel(escolhido.celular)}</span>
                  </p>
                  <button type="button" onClick={() => setClienteId('')} className="shrink-0 text-xs font-medium text-primary hover:underline">Trocar</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome ou número" aria-label="Buscar cliente"
                      className={INPUT + ' pl-9'} autoFocus />
                  </div>
                  <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border" aria-label="Clientes">
                    {encontrados.length === 0 ? (
                      <li className="px-3 py-3 text-sm text-muted-foreground">Nenhum cliente encontrado.</li>
                    ) : encontrados.map(c => (
                      <li key={c.id}>
                        <button type="button" onClick={() => setClienteId(c.id)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-accent">
                          <span className="truncate text-foreground">{c.nome}</span>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{numeroLegivel(c.celular)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="ag-celular" className={LABEL}>WhatsApp</label>
                  <input id="ag-celular" value={celular} onChange={e => setCelular(mascararCelular(e.target.value))} required={tipo === 'numero'}
                    inputMode="tel" placeholder="(21) 99999-0000" className={INPUT + ' tabular-nums'} />
                </div>
                <div>
                  <label htmlFor="ag-nome" className={LABEL}>Nome (opcional)</label>
                  <input id="ag-nome" value={nome} onChange={e => setNome(e.target.value)} maxLength={80} placeholder="Maria" className={INPUT} />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">O nome entra onde a mensagem tiver {'{{nome}}'}.</p>
              </div>
            )}
          </section>

          <section className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ag-data" className={LABEL}>Dia</label>
              <input id="ag-data" type="date" value={data} min={hoje} required onChange={e => setQuando(q => ({ ...q, data: e.target.value }))} className={INPUT} />
            </div>
            <div>
              <label htmlFor="ag-hora" className={LABEL}>Hora</label>
              <input id="ag-hora" type="time" value={hora} required onChange={e => setQuando(q => ({ ...q, hora: e.target.value }))} className={INPUT} />
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">Horário de Brasília. Sai na hora marcada, mesmo fora do horário de envio dos lembretes.</p>
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className={LABEL + ' mb-0'}>Mensagem</p>
              {modelos.length > 0 && (
                <select value={modeloId} onChange={e => usarModelo(e.target.value)} aria-label="Começar de um modelo"
                  className="max-w-[55%] rounded-lg border border-border bg-input px-2 py-1 text-xs text-foreground outline-none focus-visible:border-primary">
                  <option value="">Começar de um modelo…</option>
                  {modelos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              )}
            </div>
            <PassosEditor passos={passos} onChange={setPassos} />
            <p className="mt-2 text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1">{'{{nome}}'}</code> vira o nome da pessoa e <code className="rounded bg-muted px-1">{'{{periododia}}'}</code> vira Bom dia, Boa tarde ou Boa noite pela hora em que a mensagem sai.
              {modelos.length === 0 && <> Para reaproveitar mensagens, crie um <Link href="/wa-templates" className="font-medium text-primary hover:underline">modelo</Link>.</>}
            </p>
          </section>

          {erro && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{erro}</p>}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-6 py-4">
          <button type="submit" disabled={salvando}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            {salvando ? 'Agendando…' : 'Agendar envio'}
          </button>
          <button type="button" onClick={onFechar} className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground transition hover:text-foreground">
            Cancelar
          </button>
        </div>
      </form>
    </>
  )
}
