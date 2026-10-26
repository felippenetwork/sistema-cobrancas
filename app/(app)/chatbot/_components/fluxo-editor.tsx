'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, Plus, Tag, Trash2, X } from 'lucide-react'
import type { UazapiEtiqueta } from '@/lib/uazapi'
import type { Etapa } from '@/lib/chatbot/fluxo'
import { MAX_ETAPAS, MAX_OPCOES } from '@/lib/chatbot/fluxo'
import { listarEtiquetasAction } from '../../disparos/_actions'
import { PassosEditor, novoPasso, paraEditavel, paraEnvio, type PassoEditavel } from '../../disparos/_components/passos-editor'
import { salvarFluxoAction } from '../_actions'

type EtiquetaSel = { id: string; nome: string }

export type FluxoInicial = {
  nome: string; ativo: boolean; etapas: Etapa[]
  gatilhoPalavras: string[]; gatilhoEtiquetas: EtiquetaSel[]; excluirEtiquetas: EtiquetaSel[]
  palavrasHumano: string[]; msgNaoEntendi: string; msgHumano: string; avisoNumero: string
}

type TipoResposta = Etapa['resposta']['tipo']
/** Etapa na tela: guarda os campos de todos os tipos de resposta, para trocar de tipo sem perder o que foi digitado. */
type EtapaEditavel = {
  id: string; nome: string; passos: PassoEditavel[]
  tipo: TipoResposta
  opcoes: { rotulo: string; proxima: string | null }[]
  mostrarOpcoes: boolean
  variavel: string
  proxima: string | null
}

const INPUT = 'w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20'
const LABEL = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground'
const SECAO = 'space-y-3 rounded-2xl border border-border bg-card p-4 md:p-5'

const TIPOS: { tipo: TipoResposta; rotulo: string; ajuda: string }[] = [
  { tipo: 'menu',   rotulo: 'Esperar a escolha de uma opção', ajuda: 'A pessoa responde 1, 2, 3… (ou o texto da opção) e vai para a etapa da opção.' },
  { tipo: 'texto',  rotulo: 'Esperar uma resposta e guardar', ajuda: 'O que a pessoa escrever fica guardado e pode ser usado depois como {{variável}}.' },
  { tipo: 'seguir', rotulo: 'Seguir direto para outra etapa', ajuda: 'Não espera resposta: manda a próxima etapa em seguida.' },
  { tipo: 'humano', rotulo: 'Passar para atendimento humano', ajuda: 'O robô pausa para este contato e você recebe o aviso no WhatsApp.' },
  { tipo: 'fim',    rotulo: 'Encerrar a conversa',            ajuda: 'O robô para. A pessoa só volta a um fluxo por um gatilho.' },
]

let seq = 0
const novoId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`

function novaEtapa(indice: number): EtapaEditavel {
  return {
    id: novoId(), nome: indice === 0 ? 'Boas-vindas' : `Etapa ${indice + 1}`, passos: [novoPasso('texto', 0)],
    tipo: indice === 0 ? 'menu' : 'fim', opcoes: [{ rotulo: '', proxima: null }], mostrarOpcoes: true, variavel: '', proxima: null,
  }
}

function paraTela(e: Etapa): EtapaEditavel {
  const r = e.resposta
  return {
    id: e.id, nome: e.nome, passos: paraEditavel(e.passos), tipo: r.tipo,
    opcoes: r.tipo === 'menu' ? r.opcoes : [{ rotulo: '', proxima: null }],
    mostrarOpcoes: r.tipo === 'menu' ? r.mostrar_opcoes : true,
    variavel: r.tipo === 'texto' ? r.variavel : '',
    proxima: r.tipo === 'texto' || r.tipo === 'seguir' ? r.proxima : null,
  }
}

function paraSalvar(e: EtapaEditavel) {
  const resposta =
    e.tipo === 'menu'   ? { tipo: e.tipo, opcoes: e.opcoes.map(o => ({ rotulo: o.rotulo, proxima: o.proxima })), mostrar_opcoes: e.mostrarOpcoes } :
    e.tipo === 'texto'  ? { tipo: e.tipo, variavel: e.variavel.trim().toLowerCase(), proxima: e.proxima } :
    e.tipo === 'seguir' ? { tipo: e.tipo, proxima: e.proxima } :
                          { tipo: e.tipo }
  return { id: e.id, nome: e.nome, passos: paraEnvio(e.passos), resposta }
}

const listaDePalavras = (texto: string) => texto.split(/[,\n]/).map(p => p.trim()).filter(Boolean)

// ── Campos auxiliares ─────────────────────────────────────────────────────────

function Destino({ id, valor, etapas, atual, onChange, rotulo }: {
  id: string; valor: string | null; etapas: EtapaEditavel[]; atual: string; onChange: (v: string | null) => void; rotulo: string
}) {
  return (
    <select id={id} aria-label={rotulo} value={valor ?? ''} onChange={e => onChange(e.target.value || null)} className={INPUT}>
      <option value="">Encerrar a conversa</option>
      {etapas.filter(e => e.id !== atual).map(e => <option key={e.id} value={e.id}>Ir para: {e.nome || 'etapa sem nome'}</option>)}
    </select>
  )
}

function EscolhaEtiquetas({ titulo, ajuda, escolhidas, onChange, etiquetas, erro }: {
  titulo: string; ajuda: string; escolhidas: EtiquetaSel[]; onChange: (e: EtiquetaSel[]) => void
  etiquetas: UazapiEtiqueta[] | null; erro: string | null
}) {
  const marcada = (id: string) => escolhidas.some(e => e.id === id)
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Tag className="h-3.5 w-3.5 text-muted-foreground" /> {titulo}</p>
      <p className="mb-2 text-xs text-muted-foreground">{ajuda}</p>
      {erro ? <p className="text-xs text-muted-foreground">{erro}</p>
        : !etiquetas ? <p className="text-xs text-muted-foreground">Carregando etiquetas…</p>
        : !etiquetas.length ? <p className="text-xs text-muted-foreground">Nenhuma etiqueta neste WhatsApp Business.</p>
        : (
          <div className="flex flex-wrap gap-2">
            {etiquetas.map(e => (
              <label key={e.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${marcada(e.id) ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                <input type="checkbox" className="sr-only" checked={marcada(e.id)}
                  onChange={ev => onChange(ev.target.checked ? [...escolhidas, { id: e.id, nome: e.nome }] : escolhidas.filter(x => x.id !== e.id))} />
                {e.nome}
              </label>
            ))}
          </div>
        )}
      {/* Etiqueta salva que não existe mais no WhatsApp: mostra para poder tirar. */}
      {etiquetas && escolhidas.filter(e => !etiquetas.some(x => x.id === e.id)).map(e => (
        <button key={e.id} type="button" onClick={() => onChange(escolhidas.filter(x => x.id !== e.id))}
          className="mt-2 mr-2 inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          {e.nome} (não existe mais) <X className="h-3 w-3" />
        </button>
      ))}
    </div>
  )
}

// ── Editor ────────────────────────────────────────────────────────────────────

export function FluxoEditor({ fluxoId, inicial }: { fluxoId: string | null; inicial: FluxoInicial | null }) {
  const router = useRouter()
  const [nome, setNome]                 = useState(inicial?.nome ?? '')
  const [ativo, setAtivo]               = useState(inicial?.ativo ?? true)
  const [etapas, setEtapas]             = useState<EtapaEditavel[]>(() => (inicial?.etapas.length ? inicial.etapas.map(paraTela) : [novaEtapa(0)]))
  const [palavras, setPalavras]         = useState((inicial?.gatilhoPalavras ?? []).join(', '))
  const [gatEtiquetas, setGatEtiquetas] = useState<EtiquetaSel[]>(inicial?.gatilhoEtiquetas ?? [])
  const [excEtiquetas, setExcEtiquetas] = useState<EtiquetaSel[]>(inicial?.excluirEtiquetas ?? [])
  const [palavrasHumano, setPalHumano]  = useState((inicial?.palavrasHumano ?? ['atendente', 'humano']).join(', '))
  const [msgNaoEntendi, setNaoEntendi]  = useState(inicial?.msgNaoEntendi ?? 'Não entendi. Responda com o número de uma das opções.')
  const [msgHumano, setMsgHumano]       = useState(inicial?.msgHumano ?? 'Certo! Já chamei alguém da equipe para falar com você.')
  const [avisoNumero, setAvisoNumero]   = useState(inicial?.avisoNumero ?? '')
  const [etiquetas, setEtiquetas]       = useState<UazapiEtiqueta[] | null>(null)
  const [erroEtiquetas, setErroEtq]     = useState<string | null>(null)
  const [salvando, setSalvando]         = useState(false)
  const [erro, setErro]                 = useState<string | null>(null)
  const [salvo, setSalvo]               = useState(false)

  useEffect(() => {
    let vivo = true
    listarEtiquetasAction().then(r => {
      if (!vivo) return
      if (r.error) setErroEtq(r.error)
      else setEtiquetas(r.etiquetas ?? [])
    })
    return () => { vivo = false }
  }, [])

  const atualizar = (i: number, patch: Partial<EtapaEditavel>) => { setSalvo(false); setEtapas(l => l.map((e, j) => (j === i ? { ...e, ...patch } : e))) }
  const mover = (i: number, d: -1 | 1) => setEtapas(l => { const n = [...l]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n })
  const remover = (i: number) => setEtapas(l => {
    const fora = l[i].id
    // Quem apontava para a etapa removida passa a encerrar a conversa.
    return l.filter((_, j) => j !== i).map(e => ({
      ...e, proxima: e.proxima === fora ? null : e.proxima,
      opcoes: e.opcoes.map(o => (o.proxima === fora ? { ...o, proxima: null } : o)),
    }))
  })

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null); setSalvo(false)
    if (etapas.some(x => x.passos.some(p => p.tipo !== 'texto' && !p.caminho))) { setErro('Uma mensagem de mídia ainda está sem arquivo.'); return }
    setSalvando(true)
    const r = await salvarFluxoAction(fluxoId, {
      nome, ativo, etapas: etapas.map(paraSalvar),
      gatilhoPalavras: listaDePalavras(palavras), gatilhoEtiquetas: gatEtiquetas, excluirEtiquetas: excEtiquetas,
      palavrasHumano: listaDePalavras(palavrasHumano), msgNaoEntendi, msgHumano, avisoNumero,
    })
    setSalvando(false)
    if (r.error || !r.id) { setErro(r.error ?? 'Não foi possível salvar.'); return }
    setSalvo(true)
    if (!fluxoId) router.replace(`/chatbot/${r.id}`)
    else router.refresh()
  }

  const semGatilho = !listaDePalavras(palavras).length && !gatEtiquetas.length

  return (
    <form onSubmit={salvar} className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Link href="/chatbot" aria-label="Voltar para o chatbot" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-lg font-semibold text-foreground">{fluxoId ? 'Editar fluxo' : 'Novo fluxo'}</h1>
      </div>

      <section className={SECAO}>
        <div>
          <label htmlFor="fluxo-nome" className={LABEL}>Nome do fluxo</label>
          <input id="fluxo-nome" value={nome} onChange={e => setNome(e.target.value)} required maxLength={80} placeholder="Atendimento inicial" className={INPUT} />
        </div>
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
          <span>
            <span className="block text-sm font-medium text-foreground">Fluxo ligado</span>
            <span className="block text-xs text-muted-foreground">Desligado, o robô ignora os gatilhos deste fluxo (quem já está nele também para).</span>
          </span>
        </label>
      </section>

      <section className={SECAO}>
        <h2 className="text-sm font-semibold text-foreground">Quando o robô começa</h2>
        <div>
          <label htmlFor="fluxo-palavras" className={LABEL}>Palavras-chave</label>
          <input id="fluxo-palavras" value={palavras} onChange={e => setPalavras(e.target.value)} placeholder="menu, quero, oi" className={INPUT} />
          <p className="mt-1 text-xs text-muted-foreground">Separe por vírgula. Vale quando a mensagem inteira é a palavra (maiúscula e acento não importam). Recomeça o fluxo mesmo no meio de uma conversa.</p>
        </div>
        <EscolhaEtiquetas titulo="Quem tem a etiqueta" ajuda="Contato com qualquer uma destas etiquetas entra no fluxo quando manda mensagem (no máximo uma vez a cada 24h)."
          escolhidas={gatEtiquetas} onChange={v => setGatEtiquetas(v)} etiquetas={etiquetas} erro={erroEtiquetas} />
        <p className="text-xs text-muted-foreground">
          Também começa quando alguém responde a um disparo ligado a este fluxo (escolha o fluxo ao criar o disparo).
          {semGatilho && ' Sem palavra-chave nem etiqueta, este fluxo só começa por disparo.'}
        </p>
      </section>

      <section className={SECAO}>
        <h2 className="text-sm font-semibold text-foreground">Quem fica de fora</h2>
        <EscolhaEtiquetas titulo="Não entra quem tem a etiqueta" ajuda="Contato com qualquer uma destas etiquetas nunca entra neste fluxo, nem por palavra-chave ou disparo."
          escolhidas={excEtiquetas} onChange={v => setExcEtiquetas(v)} etiquetas={etiquetas} erro={erroEtiquetas} />
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Etapas</h2>
          <p className="text-xs text-muted-foreground">A primeira é a mensagem de entrada.</p>
        </div>
        {etapas.map((e, i) => (
          <div key={e.id} className={SECAO}>
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                {i === 0 ? 'Entrada' : `Etapa ${i + 1}`}
              </span>
              <input value={e.nome} onChange={ev => atualizar(i, { nome: ev.target.value })} maxLength={60} required aria-label={`Nome da etapa ${i + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-foreground outline-none hover:border-border focus-visible:border-primary" />
              <div className="flex shrink-0">
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir etapa ${i + 1}`}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => mover(i, 1)} disabled={i === etapas.length - 1} aria-label={`Descer etapa ${i + 1}`}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => remover(i)} disabled={etapas.length === 1} aria-label={`Remover etapa ${i + 1}`}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>

            <PassosEditor passos={e.passos} onChange={p => atualizar(i, { passos: p })} />

            <div className="space-y-2 border-t border-border pt-3">
              <label htmlFor={`tipo-${e.id}`} className={LABEL}>Depois de enviar</label>
              <select id={`tipo-${e.id}`} value={e.tipo} onChange={ev => atualizar(i, { tipo: ev.target.value as TipoResposta })} className={INPUT}>
                {TIPOS.map(t => <option key={t.tipo} value={t.tipo}>{t.rotulo}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">{TIPOS.find(t => t.tipo === e.tipo)?.ajuda}</p>

              {e.tipo === 'menu' && (
                <div className="space-y-2">
                  {e.opcoes.map((o, k) => (
                    <div key={k} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:grid-cols-[auto_1fr_1fr_auto]">
                      <span className="w-5 text-center text-sm font-medium text-muted-foreground tabular-nums">{k + 1}</span>
                      <input value={o.rotulo} maxLength={60} required placeholder="Ver planos" aria-label={`Texto da opção ${k + 1}`}
                        onChange={ev => atualizar(i, { opcoes: e.opcoes.map((x, j) => (j === k ? { ...x, rotulo: ev.target.value } : x)) })} className={INPUT} />
                      <div className="col-span-3 col-start-2 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
                        <Destino id={`op-${e.id}-${k}`} valor={o.proxima} etapas={etapas} atual={e.id} rotulo={`Para onde vai a opção ${k + 1}`}
                          onChange={v => atualizar(i, { opcoes: e.opcoes.map((x, j) => (j === k ? { ...x, proxima: v } : x)) })} />
                      </div>
                      <button type="button" onClick={() => atualizar(i, { opcoes: e.opcoes.filter((_, j) => j !== k) })} disabled={e.opcoes.length === 1}
                        aria-label={`Remover opção ${k + 1}`} className="col-start-3 row-start-1 rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 sm:col-start-4">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {e.opcoes.length < MAX_OPCOES && (
                    <button type="button" onClick={() => atualizar(i, { opcoes: [...e.opcoes, { rotulo: '', proxima: null }] })}
                      className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      <Plus className="h-3.5 w-3.5" /> Opção
                    </button>
                  )}
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={e.mostrarOpcoes} onChange={ev => atualizar(i, { mostrarOpcoes: ev.target.checked })} className="h-4 w-4 accent-primary" />
                    Listar as opções (1. …, 2. …) no fim da última mensagem
                  </label>
                </div>
              )}

              {e.tipo === 'texto' && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`var-${e.id}`} className="mb-1 block text-xs text-muted-foreground">Guardar como</label>
                    <input id={`var-${e.id}`} value={e.variavel} required maxLength={30} placeholder="cidade" pattern="[a-z][a-z0-9_]*"
                      title="Só letras minúsculas, números e _ (ex.: cidade)"
                      onChange={ev => atualizar(i, { variavel: ev.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} className={INPUT} />
                    {e.variavel && <p className="mt-1 text-xs text-muted-foreground">Use <code className="rounded bg-muted px-1">{`{{${e.variavel}}}`}</code> nas próximas mensagens.</p>}
                  </div>
                  <div>
                    <label htmlFor={`prox-${e.id}`} className="mb-1 block text-xs text-muted-foreground">Depois</label>
                    <Destino id={`prox-${e.id}`} valor={e.proxima} etapas={etapas} atual={e.id} rotulo="Para onde vai depois da resposta" onChange={v => atualizar(i, { proxima: v })} />
                  </div>
                </div>
              )}

              {e.tipo === 'seguir' && (
                <Destino id={`seg-${e.id}`} valor={e.proxima} etapas={etapas} atual={e.id} rotulo="Etapa seguinte" onChange={v => atualizar(i, { proxima: v })} />
              )}
            </div>
          </div>
        ))}
        {etapas.length < MAX_ETAPAS && (
          <button type="button" onClick={() => setEtapas(l => [...l, novaEtapa(l.length)])}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition hover:border-primary hover:text-foreground">
            <Plus className="h-4 w-4" /> Adicionar etapa
          </button>
        )}
      </section>

      <section className={SECAO}>
        <h2 className="text-sm font-semibold text-foreground">Atendimento humano e respostas do robô</h2>
        <div>
          <label htmlFor="fluxo-humano" className={LABEL}>Palavras para falar com uma pessoa</label>
          <input id="fluxo-humano" value={palavrasHumano} onChange={e => setPalHumano(e.target.value)} placeholder="atendente, humano" className={INPUT} />
          <p className="mt-1 text-xs text-muted-foreground">Em qualquer etapa, a pessoa manda uma delas e o robô pausa. Depois de 3 respostas que o robô não entende, ele também passa para você.</p>
        </div>
        <div>
          <label htmlFor="fluxo-msg-humano" className={LABEL}>Resposta quando passa para você</label>
          <textarea id="fluxo-msg-humano" value={msgHumano} onChange={e => setMsgHumano(e.target.value)} rows={2} maxLength={1000} required className={INPUT + ' resize-y'} />
        </div>
        <div>
          <label htmlFor="fluxo-aviso" className={LABEL}>Avisar no WhatsApp</label>
          <input id="fluxo-aviso" value={avisoNumero} onChange={e => setAvisoNumero(e.target.value)} inputMode="tel" placeholder="21 99999-0000" className={INPUT + ' tabular-nums'} />
          <p className="mt-1 text-xs text-muted-foreground">Número que recebe o aviso com o nome, o número e as respostas da pessoa. Use outro número seu, não o conectado. Vazio = sem aviso.</p>
        </div>
        <div>
          <label htmlFor="fluxo-nao-entendi" className={LABEL}>Resposta quando o robô não entende</label>
          <textarea id="fluxo-nao-entendi" value={msgNaoEntendi} onChange={e => setNaoEntendi(e.target.value)} rows={2} maxLength={1000} required className={INPUT + ' resize-y'} />
          <p className="mt-1 text-xs text-muted-foreground">Num menu, as opções vão junto de novo. Quem mandar SAIR ou PARAR sai do robô e dos disparos.</p>
        </div>
      </section>

      <div className="sticky bottom-16 z-30 -mx-4 border-t border-border bg-card px-4 py-3 md:bottom-0 md:-mx-6 md:px-6">
        <div className="flex items-center gap-3">
          {erro && <p role="alert" className="min-w-0 flex-1 text-xs text-destructive">{erro}</p>}
          {!erro && salvo && <p role="status" className="min-w-0 flex-1 text-xs text-muted-foreground">Fluxo salvo.</p>}
          {!erro && !salvo && <span className="flex-1" />}
          <Link href="/chatbot" className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground transition hover:text-foreground">Voltar</Link>
          <button type="submit" disabled={salvando}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            {salvando ? 'Salvando…' : fluxoId ? 'Salvar fluxo' : 'Criar fluxo'}
          </button>
        </div>
      </div>
    </form>
  )
}
