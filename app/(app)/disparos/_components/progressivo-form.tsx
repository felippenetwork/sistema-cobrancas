'use client'

import { useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { criarProgressivoAction } from '../_actions'
import { interpretarLista, quotaDoDia } from '@/lib/disparo/progressivo'

type Modelo = { id: string; nome: string; corpo: string | null }

const INPUT = 'w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20'
const LABEL = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground'

/** Quantos dias até a lista acabar, seguindo o ciclo inicio → maximo → inicio. */
function diasParaTerminar(total: number, inicio: number, maximo: number): number {
  if (total <= 0 || inicio < 1 || maximo < inicio) return 0
  let enviados = 0
  let dia = 0
  while (enviados < total && dia < 3650) enviados += quotaDoDia(dia++, inicio, maximo)
  return dia
}

function Interruptor({ id, checked, onChange, titulo, descricao }: {
  id: string; checked: boolean; onChange: (v: boolean) => void; titulo: string; descricao: string
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3">
      <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
      <span>
        <span className="block text-sm font-medium text-foreground">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{descricao}</span>
      </span>
    </label>
  )
}

export function ProgressivoForm({ modelos, onConcluido, onVoltar }: {
  modelos: Modelo[]
  onConcluido: (pulados: number) => void
  onVoltar: () => void
}) {
  const [nome, setNome]               = useState('')
  const [mensagem, setMensagem]       = useState('')
  const [variacoes, setVariacoes]     = useState<string[]>([])
  const [lista, setLista]             = useState('')
  const [janelaInicio, setJanelaIni]  = useState('09:00')
  const [janelaFim, setJanelaFim]     = useState('18:00')
  const [inicio, setInicio]           = useState(1)
  const [maximo, setMaximo]           = useState(20)
  const [registrar, setRegistrar]     = useState(true)
  const [excluir, setExcluir]         = useState(true)
  const [erro, setErro]               = useState<string | null>(null)
  const [salvando, setSalvando]       = useState(false)

  const { contatos, invalidas } = useMemo(() => interpretarLista(lista), [lista])
  const dias = diasParaTerminar(contatos.length, inicio, maximo)
  const exemplo = useMemo(() => {
    if (inicio < 1 || maximo < inicio) return ''
    const passos = Array.from({ length: Math.min(maximo - inicio + 2, 6) }, (_, d) => quotaDoDia(d, inicio, maximo))
    const tamanho = maximo - inicio + 1
    return tamanho > 5
      ? `${passos.slice(0, 3).join(', ')} … ${maximo}, e volta para ${inicio}`
      : `${passos.join(', ')}…`
  }, [inicio, maximo])

  async function iniciar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setSalvando(true)
    const r = await criarProgressivoAction({
      nome, mensagem, variacoes, lista, janelaInicio, janelaFim, inicio, maximo,
      registrarEnviados: registrar, excluirJaEnviados: excluir,
    })
    setSalvando(false)
    if (r.error) { setErro(r.error); return }
    onConcluido(r.pulados ?? 0)
  }

  return (
    <form onSubmit={iniciar} className="flex flex-col gap-5 overflow-y-auto p-5" style={{ maxHeight: '75dvh' }}>
      <div>
        <label htmlFor="prog-nome" className={LABEL}>Nome do disparo</label>
        <input id="prog-nome" value={nome} onChange={e => setNome(e.target.value)} required maxLength={80}
          placeholder="Prospecção outubro" className={INPUT} />
      </div>

      {/* Mensagem */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <label htmlFor="prog-msg" className={LABEL + ' mb-0'}>Mensagem</label>
          {modelos.some(m => m.corpo) && (
            <select
              aria-label="Usar um modelo"
              defaultValue=""
              onChange={e => { const m = modelos.find(x => x.id === e.target.value); if (m?.corpo) setMensagem(m.corpo); e.target.value = '' }}
              className="rounded-lg border border-border bg-input px-2 py-1 text-xs text-muted-foreground outline-none focus-visible:border-primary"
            >
              <option value="" disabled>Usar um modelo…</option>
              {modelos.filter(m => m.corpo).map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          )}
        </div>
        <textarea id="prog-msg" value={mensagem} onChange={e => setMensagem(e.target.value)} required rows={4} maxLength={4000}
          placeholder="Oi {{nome}}, tudo bem? …" className={INPUT + ' resize-y'} />
        <p className="text-xs text-muted-foreground">
          <code className="rounded bg-muted px-1">{'{{nome}}'}</code> vira o nome do contato. Sem nome, some da frase.
        </p>

        {variacoes.map((v, i) => (
          <div key={i} className="flex gap-2">
            <textarea value={v} onChange={e => setVariacoes(vs => vs.map((x, j) => (j === i ? e.target.value : x)))}
              rows={3} maxLength={4000} aria-label={`Variação ${i + 1}`}
              placeholder={`Variação ${i + 1} — outra forma de dizer a mesma coisa`} className={INPUT + ' resize-y'} />
            <button type="button" onClick={() => setVariacoes(vs => vs.filter((_, j) => j !== i))}
              aria-label={`Remover variação ${i + 1}`}
              className="h-10 shrink-0 rounded-lg px-2 text-muted-foreground hover:bg-accent hover:text-foreground">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {variacoes.length < 5 && (
          <button type="button" onClick={() => setVariacoes(vs => [...vs, ''])}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" />
            Adicionar variação
          </button>
        )}
        {variacoes.length > 0 && (
          <p className="text-xs text-muted-foreground">As versões se alternam a cada contato, para não repetir o mesmo texto.</p>
        )}
      </section>

      {/* Lista */}
      <section className="space-y-2">
        <label htmlFor="prog-lista" className={LABEL}>Números e nomes</label>
        <textarea id="prog-lista" value={lista} onChange={e => setLista(e.target.value)} rows={6}
          placeholder={'Maria Souza; 21 99999-0001\nJoão, 5521999990002\n21999990003'}
          className={INPUT + ' resize-y font-mono text-xs'} />
        <p className="text-xs text-muted-foreground">
          Um contato por linha, nome e número em qualquer ordem.{' '}
          <span className="font-medium text-foreground tabular-nums">{contatos.length}</span> número{contatos.length === 1 ? '' : 's'} válido{contatos.length === 1 ? '' : 's'}
          {invalidas.length > 0 && <> · <span className="tabular-nums">{invalidas.length}</span> linha{invalidas.length === 1 ? '' : 's'} sem número válido (ignorada{invalidas.length === 1 ? '' : 's'})</>}
        </p>
      </section>

      {/* Ritmo */}
      <section className="space-y-3">
        <p className={LABEL + ' mb-0'}>Ritmo</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="prog-ini" className="mb-1 block text-xs text-muted-foreground">Envios no 1º dia</label>
            <input id="prog-ini" type="number" min={1} max={200} value={inicio} onChange={e => setInicio(Number(e.target.value))} className={INPUT + ' tabular-nums'} />
          </div>
          <div>
            <label htmlFor="prog-max" className="mb-1 block text-xs text-muted-foreground">Até quantos por dia</label>
            <input id="prog-max" type="number" min={1} max={200} value={maximo} onChange={e => setMaximo(Number(e.target.value))} className={INPUT + ' tabular-nums'} />
          </div>
          <div>
            <label htmlFor="prog-jini" className="mb-1 block text-xs text-muted-foreground">Janela — de</label>
            <input id="prog-jini" type="time" value={janelaInicio} onChange={e => setJanelaIni(e.target.value)} className={INPUT + ' tabular-nums'} />
          </div>
          <div>
            <label htmlFor="prog-jfim" className="mb-1 block text-xs text-muted-foreground">Janela — até</label>
            <input id="prog-jfim" type="time" value={janelaFim} onChange={e => setJanelaFim(e.target.value)} className={INPUT + ' tabular-nums'} />
          </div>
        </div>
        {exemplo && (
          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <p>Envios por dia: <span className="font-medium text-foreground tabular-nums">{exemplo}</span>.</p>
            <p className="mt-1">Cada envio sai num horário aleatório entre {janelaInicio} e {janelaFim}, espaçado dos outros, com 20 segundos de "digitando…" antes.</p>
            {dias > 0 && (
              <p className="mt-1">A lista termina em cerca de <span className="font-medium text-foreground tabular-nums">{dias}</span> dia{dias === 1 ? '' : 's'} com o WhatsApp conectado.</p>
            )}
          </div>
        )}
      </section>

      {/* Registro */}
      <section className="space-y-2">
        <Interruptor id="prog-reg" checked={registrar} onChange={setRegistrar}
          titulo="Registrar quem receber"
          descricao="Guarda cada número que recebeu, para os próximos disparos poderem pular." />
        <Interruptor id="prog-exc" checked={excluir} onChange={setExcluir}
          titulo="Não enviar para quem já recebeu"
          descricao="Pula os números registrados em disparos anteriores." />
      </section>

      {erro && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{erro}</p>}

      <div className="flex gap-3 border-t border-border pt-4" style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom, 0px))' }}>
        <button type="button" onClick={onVoltar}
          className="rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground transition hover:bg-accent">
          ← Voltar
        </button>
        <button type="submit" disabled={salvando || contatos.length === 0}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
          {salvando ? 'Iniciando…' : `Iniciar disparo para ${contatos.length}`}
        </button>
      </div>
    </form>
  )
}
