'use client'

import { useMemo, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { criarProgressivoAction } from '../_actions'
import { interpretarLista, quotaDoDia } from '@/lib/disparo/progressivo'
import { PassosEditor, novoPasso, type PassoEditavel } from './passos-editor'
import { ImportarGrupo } from './importar-grupo'
import { EtiquetasCampo, type EtiquetaEscolhida } from './etiquetas-campo'

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

/** Passos da tela → formato que o servidor valida (lib/disparo/passos.ts). */
function paraEnvio(passos: PassoEditavel[]) {
  return passos.map(p => p.tipo === 'texto'
    ? { tipo: p.tipo, texto: p.texto, variacoes: p.variacoes, digitacao_seg: p.digitacao_seg }
    : { tipo: p.tipo, caminho: p.caminho ?? '', nome_arquivo: p.nome_arquivo, legenda: p.legenda.trim() || null, digitacao_seg: p.digitacao_seg })
}

export function ProgressivoForm({ modelos, onConcluido, onVoltar }: {
  modelos: Modelo[]
  onConcluido: (pulados: number) => void
  onVoltar: () => void
}) {
  const [nome, setNome]               = useState('')
  const [passos, setPassos]           = useState<PassoEditavel[]>(() => [novoPasso('texto', 0)])
  const [lista, setLista]             = useState('')
  const [importando, setImportando]   = useState(false)
  const [resumoImport, setResumoImp]  = useState<string | null>(null)
  const [janelaInicio, setJanelaIni]  = useState('09:00')
  const [janelaFim, setJanelaFim]     = useState('18:00')
  const [inicio, setInicio]           = useState(1)
  const [maximo, setMaximo]           = useState(20)
  const [etqAdicionar, setEtqAdd]     = useState<EtiquetaEscolhida>(null)
  const [etqRemover, setEtqRem]       = useState<EtiquetaEscolhida>(null)
  const [registrar, setRegistrar]     = useState(true)
  const [excluir, setExcluir]         = useState(true)
  const [erro, setErro]               = useState<string | null>(null)
  const [salvando, setSalvando]       = useState(false)

  const { contatos, invalidas } = useMemo(() => interpretarLista(lista), [lista])
  const dias = diasParaTerminar(contatos.length, inicio, maximo)
  const segundosPorContato = passos.reduce((s, p) => s + p.digitacao_seg, 0)
  const exemplo = useMemo(() => {
    if (inicio < 1 || maximo < inicio) return ''
    const passosCiclo = Array.from({ length: Math.min(maximo - inicio + 2, 6) }, (_, d) => quotaDoDia(d, inicio, maximo))
    return maximo - inicio + 1 > 5
      ? `${passosCiclo.slice(0, 3).join(', ')} … ${maximo}, e volta para ${inicio}`
      : `${passosCiclo.join(', ')}…`
  }, [inicio, maximo])

  const primeiroTexto = passos.find(p => p.tipo === 'texto')

  function usarModelo(id: string) {
    const m = modelos.find(x => x.id === id)
    if (!m?.corpo) return
    const i = passos.findIndex(p => p.tipo === 'texto')
    if (i >= 0) setPassos(passos.map((p, j) => (j === i && p.tipo === 'texto' ? { ...p, texto: m.corpo as string } : p)))
    else setPassos([{ ...novoPasso('texto', 0), texto: m.corpo } as PassoEditavel, ...passos])
  }

  async function iniciar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (passos.some(p => p.tipo !== 'texto' && !p.caminho)) { setErro('Uma mensagem de mídia ainda está sem arquivo.'); return }
    setSalvando(true)
    const r = await criarProgressivoAction({
      nome, passos: paraEnvio(passos), lista, janelaInicio, janelaFim, inicio, maximo,
      etiquetaAdicionar: etqAdicionar, etiquetaRemover: etqRemover,
      registrarEnviados: registrar, excluirJaEnviados: excluir,
    })
    setSalvando(false)
    if (r.error) { setErro(r.error); return }
    onConcluido(r.pulados ?? 0)
  }

  return (
    <form onSubmit={iniciar} className="flex flex-col gap-5 overflow-y-auto p-5" style={{ maxHeight: '78dvh' }}>
      <div>
        <label htmlFor="prog-nome" className={LABEL}>Nome do disparo</label>
        <input id="prog-nome" value={nome} onChange={e => setNome(e.target.value)} required maxLength={80}
          placeholder="Prospecção outubro" className={INPUT} />
      </div>

      {/* Mensagens */}
      <section>
        <div className="flex items-end justify-between gap-3">
          <p className={LABEL + ' mb-0'}>Mensagens, na ordem em que chegam</p>
          {modelos.some(m => m.corpo) && primeiroTexto && (
            <select aria-label="Usar um modelo no primeiro texto" defaultValue=""
              onChange={e => { usarModelo(e.target.value); e.target.value = '' }}
              className="rounded-lg border border-border bg-input px-2 py-1 text-xs text-muted-foreground outline-none focus-visible:border-primary">
              <option value="" disabled>Usar um modelo…</option>
              {modelos.filter(m => m.corpo).map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          )}
        </div>
        <PassosEditor passos={passos} onChange={setPassos} />
        <p className="mt-2 text-xs text-muted-foreground">
          <code className="rounded bg-muted px-1">{'{{nome}}'}</code> vira o nome do contato (some da frase se não houver).
          Cada contato leva cerca de <span className="tabular-nums">{segundosPorContato}</span> s entre digitação e envios.
        </p>
      </section>

      {/* Lista */}
      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <label htmlFor="prog-lista" className={LABEL + ' mb-0'}>Números e nomes</label>
          {!importando && (
            <button type="button" onClick={() => setImportando(true)}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <Download className="h-3.5 w-3.5" /> Importar de grupo ou comunidade
            </button>
          )}
        </div>
        {importando && (
          <ImportarGrupo
            onFechar={() => setImportando(false)}
            onImportar={(linhas, resumo) => {
              setLista(atual => (atual.trim() ? `${atual.trim()}\n${linhas}` : linhas))
              setResumoImp(resumo)
              setImportando(false)
            }}
          />
        )}
        {resumoImport && <p className="text-xs text-muted-foreground">Importado: {resumoImport}.</p>}
        <textarea id="prog-lista" value={lista} onChange={e => setLista(e.target.value)} rows={6}
          placeholder={'Maria Souza; 21 99999-0001\nJoão, 5521999990002\n21999990003'}
          className={INPUT + ' resize-y font-mono text-xs'} />
        <p className="text-xs text-muted-foreground">
          Um contato por linha, nome e número em qualquer ordem. Repetidos entram uma vez.{' '}
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
            <p>Contatos por dia: <span className="font-medium text-foreground tabular-nums">{exemplo}</span>.</p>
            <p className="mt-1">Cada contato recebe num horário aleatório entre {janelaInicio} e {janelaFim}, espaçado dos outros.</p>
            {dias > 0 && (
              <p className="mt-1">A lista termina em cerca de <span className="font-medium text-foreground tabular-nums">{dias}</span> dia{dias === 1 ? '' : 's'} com o WhatsApp conectado.</p>
            )}
          </div>
        )}
      </section>

      {/* Etiquetas e registro */}
      <section className="space-y-2">
        <EtiquetasCampo adicionar={etqAdicionar} remover={etqRemover} onAdicionar={setEtqAdd} onRemover={setEtqRem} />
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
