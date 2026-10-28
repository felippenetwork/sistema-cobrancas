'use client'

import { useMemo, useRef, useState } from 'react'
import { Download, Loader2, Upload } from 'lucide-react'
import { criarProgressivoAction } from '../_actions'
import { interpretarLista, quotaDoDia } from '@/lib/disparo/progressivo'
import { contatosDeVcf, linhasDeTabela, tabelaDeCsv, type ResultadoArquivo } from '@/lib/disparo/arquivo-contatos'
import { ImportarGrupo } from './importar-grupo'
import { ModeloEscolha, type ModeloDisparo } from './modelo-escolha'
import { FluxoEscolha, type FluxoDisparo } from './fluxo-escolha'

const INPUT = 'w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20'
const LABEL = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground'
const ACEITA_ARQUIVO = '.xlsx,.csv,.txt,.vcf'
const TAMANHO_MAX_ARQUIVO = 5 * 1024 * 1024

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

export function ProgressivoForm({ modelos, fluxos, onConcluido, onVoltar }: {
  modelos: ModeloDisparo[]
  fluxos: FluxoDisparo[]
  onConcluido: (pulados: number) => void
  onVoltar: () => void
}) {
  const [nome, setNome]               = useState('')
  const [modeloId, setModeloId]       = useState(modelos.length === 1 ? modelos[0].id : '')
  const [fluxoId, setFluxoId]         = useState('')
  const [lista, setLista]             = useState('')
  const [importando, setImportando]   = useState(false)
  const [resumoImport, setResumoImp]  = useState<string | null>(null)
  const [lendoArquivo, setLendoArquivo] = useState(false)
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const arquivoRef                    = useRef<HTMLInputElement>(null)
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
    const passosCiclo = Array.from({ length: Math.min(maximo - inicio + 2, 6) }, (_, d) => quotaDoDia(d, inicio, maximo))
    return maximo - inicio + 1 > 5
      ? `${passosCiclo.slice(0, 3).join(', ')} … ${maximo}, e volta para ${inicio}`
      : `${passosCiclo.join(', ')}…`
  }, [inicio, maximo])

  function acrescentarNaLista(linhas: string, resumo: string) {
    setLista(atual => (atual.trim() ? `${atual.trim()}\n${linhas}` : linhas))
    setResumoImp(resumo)
  }

  async function lerArquivo(arquivo: File) {
    setErroArquivo(null)
    if (arquivo.size > TAMANHO_MAX_ARQUIVO) { setErroArquivo('O arquivo passa de 5 MB. Divida a lista em partes menores.'); return }
    const extensao = arquivo.name.split('.').pop()?.toLowerCase() ?? ''
    setLendoArquivo(true)
    try {
      let r: ResultadoArquivo
      if (extensao === 'xlsx') {
        const { default: readXlsxFile } = await import('read-excel-file')
        r = linhasDeTabela(await readXlsxFile(arquivo))
      } else if (extensao === 'vcf') {
        r = contatosDeVcf(await arquivo.text())
      } else if (extensao === 'csv') {
        r = linhasDeTabela(tabelaDeCsv(await arquivo.text()))
      } else if (extensao === 'txt') {
        const { contatos, invalidas } = interpretarLista(await arquivo.text())
        r = { linhas: contatos.map(c => (c.nome ? `${c.nome}; ${c.celular}` : c.celular)), semNumero: invalidas.length }
      } else {
        setErroArquivo('Formato não aceito. Use planilha (.xlsx), .csv, .txt ou contatos (.vcf).')
        return
      }
      if (!r.linhas.length) { setErroArquivo(`Nenhum número válido em ${arquivo.name}.`); return }
      const fora = r.semNumero ? `, ${r.semNumero} linha${r.semNumero === 1 ? '' : 's'} sem número válido ficou de fora` : ''
      acrescentarNaLista(r.linhas.join('\n'), `${r.linhas.length} contato${r.linhas.length === 1 ? '' : 's'} de ${arquivo.name}${fora}`)
    } catch (e) {
      console.error('[disparos] ler arquivo da lista falhou', e)
      setErroArquivo(extensao === 'xlsx'
        ? 'Não foi possível ler a planilha. Se ela for .xls antigo, salve como .xlsx ou .csv e tente de novo.'
        : 'Não foi possível ler o arquivo. Confira se ele não está corrompido e tente de novo.')
    } finally {
      setLendoArquivo(false)
    }
  }

  async function iniciar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!modeloId) { setErro('Escolha o modelo com as mensagens do disparo.'); return }
    setSalvando(true)
    const r = await criarProgressivoAction({
      nome, modeloId, fluxoId: fluxoId || null, lista, janelaInicio, janelaFim, inicio, maximo,
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
        <label htmlFor="prog-modelo" className={LABEL}>Modelo (as mensagens que cada contato recebe)</label>
        <ModeloEscolha id="prog-modelo" modelos={modelos} valor={modeloId} onChange={setModeloId} />
      </section>

      {/* Lista */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <label htmlFor="prog-lista" className={LABEL + ' mb-0'}>Números e nomes</label>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button type="button" onClick={() => arquivoRef.current?.click()} disabled={lendoArquivo}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50">
              {lendoArquivo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Subir arquivo
            </button>
            <input ref={arquivoRef} type="file" accept={ACEITA_ARQUIVO} className="hidden" aria-hidden="true" tabIndex={-1}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void lerArquivo(f) }} />
            {!importando && (
              <button type="button" onClick={() => setImportando(true)}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <Download className="h-3.5 w-3.5" /> Importar de grupo ou comunidade
              </button>
            )}
          </div>
        </div>
        {importando && (
          <ImportarGrupo
            onFechar={() => setImportando(false)}
            onImportar={(linhas, resumo) => {
              acrescentarNaLista(linhas, resumo)
              setImportando(false)
            }}
          />
        )}
        {resumoImport && <p className="text-xs text-muted-foreground">Importado: {resumoImport}.</p>}
        {erroArquivo && <p role="alert" className="text-xs text-destructive">{erroArquivo}</p>}
        <textarea id="prog-lista" value={lista} onChange={e => setLista(e.target.value)} rows={6}
          placeholder={'Maria Souza; 21 99999-0001\nJoão, 5521999990002\n21999990003'}
          className={INPUT + ' resize-y font-mono text-xs'} />
        <p className="text-xs text-muted-foreground">
          Um contato por linha, nome e número em qualquer ordem, ou suba uma planilha, CSV ou os contatos do celular (.vcf). Repetidos entram uma vez.{' '}
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
        <FluxoEscolha id="prog-fluxo" fluxos={fluxos} valor={fluxoId} onChange={setFluxoId} />
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
        <button type="submit" disabled={salvando || contatos.length === 0 || !modeloId}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
          {salvando ? 'Iniciando…' : `Iniciar disparo para ${contatos.length}`}
        </button>
      </div>
    </form>
  )
}
