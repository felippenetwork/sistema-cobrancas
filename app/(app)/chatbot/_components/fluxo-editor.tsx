'use client'

// Criação/edição de uma automação do chatbot, em 4 passos (pedido do Felippe, 2026-10-26: o
// editor de etapas soltas ficou confuso). A conversa é montada como uma árvore — embaixo de cada
// opção, a resposta dela — e convertida para as etapas do robô só na hora de salvar
// (lib/chatbot/arvore.ts). Ao lado, o simulador mostra a conversa com as regras do robô de verdade.

import { createContext, useContext, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Flag, List, Loader2, MessageCircleQuestion, MessageSquare, Plus, RotateCcw, Tag, Trash2, UserRound, X } from 'lucide-react'
import type { UazapiEtiqueta } from '@/lib/uazapi'
import type { Etapa } from '@/lib/chatbot/fluxo'
import { MAX_OPCOES, QUALQUER_MENSAGEM } from '@/lib/chatbot/fluxo'
import { arvoreParaEtapas, continuacaoFim, etapasParaArvore, mapearArvore, type Acao, type Continuacao, type Depois, type No } from '@/lib/chatbot/arvore'
import { listarEtiquetasAction } from '../../disparos/_actions'
import { PassosEditor, novoPasso, paraEditavel, paraEnvio, type PassoEditavel } from '../../disparos/_components/passos-editor'
import { salvarFluxoAction } from '../_actions'
import { Simulador } from './simulador'

type EtiquetaSel = { id: string; nome: string }
type NoTela = No<PassoEditavel>

export type FluxoInicial = {
  nome: string; ativo: boolean; etapas: Etapa[]
  gatilhoPalavras: string[]; gatilhoEtiquetas: EtiquetaSel[]; excluirEtiquetas: EtiquetaSel[]
  palavrasHumano: string[]; msgNaoEntendi: string; msgHumano: string; avisoNumero: string
  boasVindas: boolean; boasVindasClientes: boolean
}

const INPUT = 'w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20'
const LABEL = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground'
const AJUDA = 'mt-1 text-xs text-muted-foreground'

const PASSOS_ASSISTENTE = [
  { titulo: 'Começo', descricao: 'Quando o robô responde' },
  { titulo: 'Boas-vindas', descricao: 'A primeira mensagem' },
  { titulo: 'Respostas', descricao: 'O que responder em cada opção' },
  { titulo: 'Atendente', descricao: 'Quando chamar você' },
] as const

let seq = 0
const novoId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`

function textoInicial(texto: string): PassoEditavel {
  return { ...novoPasso('texto', 0), texto } as PassoEditavel
}

function novoNo(texto = ''): NoTela {
  return { id: novoId(), passos: [{ ...textoInicial(texto), digitacao_seg: 8 }], depois: 'fim', opcoes: [], mostrarOpcoes: true, guardarComo: '', aposPergunta: continuacaoFim() }
}

/** Automação nova já vem com um exemplo pronto para trocar os textos. */
function exemplo(): NoTela {
  return {
    id: novoId(), passos: [textoInicial('Oi {{nome}}! Tudo bem? Como posso ajudar?')], depois: 'menu', mostrarOpcoes: true, guardarComo: '',
    aposPergunta: continuacaoFim(),
    opcoes: [
      { rotulo: 'Quero saber mais', cont: { acao: 'responder', resposta: novoNo('Que bom! Vou te explicar como funciona…') } },
      { rotulo: 'Falar com atendente', cont: { acao: 'atendente', resposta: null } },
    ],
  }
}

const nomeDoNo = (n: NoTela) => {
  const p = n.passos[0]
  if (!p) return 'Mensagem'
  return p.tipo === 'texto' ? (p.texto.trim().split('\n')[0] || 'Mensagem').slice(0, 50) : p.nome_arquivo ?? 'Mídia'
}

/** Respostas guardadas nas perguntas da automação: viram botão de inserir em todas as mensagens. */
const VariaveisDaAutomacao = createContext<string[]>([])

function respostasGuardadas(no: NoTela): string[] {
  const filhos = [...no.opcoes.map(o => o.cont), no.aposPergunta].flatMap(c => (c.resposta ? respostasGuardadas(c.resposta) : []))
  return [...new Set([...(no.depois === 'pergunta' && no.guardarComo ? [no.guardarComo] : []), ...filhos])]
}

const listaDePalavras = (texto: string) => texto.split(/[,\n]/).map(p => p.trim()).filter(Boolean)

// ── Escolhas ──────────────────────────────────────────────────────────────────

const DEPOIS: { valor: Depois; rotulo: string; icone: React.ReactNode }[] = [
  { valor: 'menu',      rotulo: 'Mostrar opções',      icone: <List className="h-4 w-4" /> },
  { valor: 'pergunta',  rotulo: 'Fazer uma pergunta',  icone: <MessageCircleQuestion className="h-4 w-4" /> },
  { valor: 'atendente', rotulo: 'Chamar você',         icone: <UserRound className="h-4 w-4" /> },
  { valor: 'inicio',    rotulo: 'Voltar ao começo',    icone: <RotateCcw className="h-4 w-4" /> },
  { valor: 'fim',       rotulo: 'Terminar',            icone: <Flag className="h-4 w-4" /> },
]

const ACOES: { valor: Acao; rotulo: string; icone: React.ReactNode }[] = [
  { valor: 'responder', rotulo: 'Responder com mensagem', icone: <MessageSquare className="h-4 w-4" /> },
  { valor: 'atendente', rotulo: 'Chamar você',            icone: <UserRound className="h-4 w-4" /> },
  { valor: 'inicio',    rotulo: 'Voltar ao começo',       icone: <RotateCcw className="h-4 w-4" /> },
  { valor: 'fim',       rotulo: 'Terminar',               icone: <Flag className="h-4 w-4" /> },
]

function Escolha<T extends string>({ rotulo, valor, opcoes, onChange }: {
  rotulo: string; valor: T; opcoes: { valor: T; rotulo: string; icone: React.ReactNode }[]; onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex flex-wrap gap-2">
      {opcoes.map(o => (
        <button key={o.valor} type="button" role="radio" aria-checked={valor === o.valor} onClick={() => onChange(o.valor)}
          className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition ${valor === o.valor ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
          {o.icone} {o.rotulo}
        </button>
      ))}
    </div>
  )
}

function EscolhaEtiquetas({ escolhidas, onChange, etiquetas, erro }: {
  escolhidas: EtiquetaSel[]; onChange: (e: EtiquetaSel[]) => void; etiquetas: UazapiEtiqueta[] | null; erro: string | null
}) {
  const marcada = (id: string) => escolhidas.some(e => e.id === id)
  if (erro) return <p className="text-xs text-muted-foreground">{erro}</p>
  if (!etiquetas) return <p className="text-xs text-muted-foreground">Carregando etiquetas…</p>
  if (!etiquetas.length) return <p className="text-xs text-muted-foreground">Este WhatsApp não tem etiquetas (elas só existem no WhatsApp Business).</p>
  return (
    <div className="flex flex-wrap gap-2">
      {etiquetas.map(e => (
        <label key={e.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition focus-within:ring-2 focus-within:ring-primary ${marcada(e.id) ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
          <input type="checkbox" className="sr-only" checked={marcada(e.id)}
            onChange={ev => onChange(ev.target.checked ? [...escolhidas, { id: e.id, nome: e.nome }] : escolhidas.filter(x => x.id !== e.id))} />
          {marcada(e.id) && <Check className="h-3 w-3" />} {e.nome}
        </label>
      ))}
      {escolhidas.filter(e => !etiquetas.some(x => x.id === e.id)).map(e => (
        <button key={e.id} type="button" onClick={() => onChange(escolhidas.filter(x => x.id !== e.id))}
          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          {e.nome} (não existe mais) <X className="h-3 w-3" />
        </button>
      ))}
    </div>
  )
}

// ── Árvore da conversa ────────────────────────────────────────────────────────

function CampoPergunta({ no, onChange }: { no: NoTela; onChange: (n: NoTela) => void }) {
  return (
    <div>
      <label htmlFor={`guardar-${no.id}`} className="mb-1 block text-xs text-muted-foreground">Guardar a resposta como</label>
      <input id={`guardar-${no.id}`} value={no.guardarComo} maxLength={30} required placeholder="cidade" pattern="[a-z][a-z0-9_]*"
        title="Só letras minúsculas, números e _ (ex.: cidade)"
        onChange={e => onChange({ ...no, guardarComo: e.target.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '') })}
        className={INPUT + ' max-w-xs'} />
      <p className={AJUDA}>
        {no.guardarComo
          ? <>Nas próximas mensagens, escreva <code className="rounded bg-muted px-1">{`{{${no.guardarComo}}}`}</code> para usar o que a pessoa respondeu.</>
          : 'Um nome curto, sem espaço (ex.: cidade, empresa).'}
      </p>
    </div>
  )
}

function OpcoesRotulos({ no, onChange }: { no: NoTela; onChange: (n: NoTela) => void }) {
  return (
    <div className="space-y-2">
      {no.opcoes.map((o, k) => (
        <div key={k} className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-center text-sm font-medium text-muted-foreground tabular-nums">{k + 1}</span>
          <input value={o.rotulo} maxLength={60} required placeholder="Texto da opção" aria-label={`Texto da opção ${k + 1}`}
            onChange={e => onChange({ ...no, opcoes: no.opcoes.map((x, j) => (j === k ? { ...x, rotulo: e.target.value } : x)) })} className={INPUT} />
          <button type="button" onClick={() => onChange({ ...no, opcoes: no.opcoes.filter((_, j) => j !== k) })} disabled={no.opcoes.length === 1}
            aria-label={`Remover opção ${k + 1}`} className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      {no.opcoes.length < MAX_OPCOES && (
        <button type="button" onClick={() => onChange({ ...no, opcoes: [...no.opcoes, { rotulo: '', cont: continuacaoFim() }] })}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <Plus className="h-3.5 w-3.5" /> Adicionar opção
        </button>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={no.mostrarOpcoes} onChange={e => onChange({ ...no, mostrarOpcoes: e.target.checked })} className="h-4 w-4 accent-primary" />
        O robô escreve a lista (1. …, 2. …) no fim da mensagem
      </label>
    </div>
  )
}

/** O que acontece depois de uma opção ou de uma pergunta — e, se for responder, a resposta aninhada. */
function ContinuacaoEditor({ titulo, cont, onChange, nivel }: { titulo: React.ReactNode; cont: Continuacao<PassoEditavel>; onChange: (c: Continuacao<PassoEditavel>) => void; nivel: number }) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-medium text-foreground">{titulo}</p>
      <Escolha rotulo="O que o robô faz" valor={cont.acao} opcoes={ACOES}
        onChange={acao => onChange({ acao, resposta: acao === 'responder' ? (cont.resposta ?? novoNo()) : cont.resposta })} />
      {cont.acao === 'responder' && cont.resposta && (
        <div className="border-l-2 border-primary/30 pl-3 md:pl-4">
          <NoEditor no={cont.resposta} onChange={r => onChange({ ...cont, resposta: r })} nivel={nivel + 1} />
        </div>
      )}
      {cont.acao === 'atendente' && <p className="text-xs text-muted-foreground">O robô manda a mensagem de atendimento (passo 4), pausa e avisa você.</p>}
      {cont.acao === 'inicio' && <p className="text-xs text-muted-foreground">Manda a mensagem de boas-vindas de novo.</p>}
      {cont.acao === 'fim' && <p className="text-xs text-muted-foreground">A conversa termina sem mais mensagens.</p>}
    </div>
  )
}

function ContinuacoesDe({ no, onChange, nivel }: { no: NoTela; onChange: (n: NoTela) => void; nivel: number }) {
  if (no.depois === 'menu') {
    return (
      <div className="space-y-3">
        {no.opcoes.map((o, k) => (
          <ContinuacaoEditor key={k} nivel={nivel}
            titulo={<>Se escolher <span className="tabular-nums">{k + 1}</span> · {o.rotulo || <span className="text-muted-foreground">opção sem texto</span>}</>}
            cont={o.cont} onChange={c => onChange({ ...no, opcoes: no.opcoes.map((x, j) => (j === k ? { ...x, cont: c } : x)) })} />
        ))}
      </div>
    )
  }
  if (no.depois === 'pergunta') {
    return <ContinuacaoEditor nivel={nivel} titulo="Depois que a pessoa responder" cont={no.aposPergunta} onChange={c => onChange({ ...no, aposPergunta: c })} />
  }
  return null
}

/** Uma mensagem do robô: as caixinhas, o que vem depois e (aninhado) as respostas. */
function NoEditor({ no, onChange, nivel, raiz = false, semRespostas = false }: {
  no: NoTela; onChange: (n: NoTela) => void; nivel: number; raiz?: boolean; semRespostas?: boolean
}) {
  const variaveis = useContext(VariaveisDaAutomacao)
  const mudarDepois = (depois: Depois) => onChange({
    ...no, depois,
    opcoes: depois === 'menu' && !no.opcoes.length ? [{ rotulo: '', cont: continuacaoFim() }, { rotulo: '', cont: continuacaoFim() }] : no.opcoes,
  })
  return (
    <div className="space-y-4">
      <PassosEditor passos={no.passos} onChange={p => onChange({ ...no, passos: p })} variaveis={variaveis} />
      <div className="space-y-2">
        <p className={LABEL}>Depois dessa mensagem</p>
        <Escolha rotulo="Depois dessa mensagem" valor={no.depois} opcoes={raiz ? DEPOIS.filter(d => d.valor !== 'inicio') : DEPOIS} onChange={mudarDepois} />
      </div>
      {no.depois === 'menu' && <OpcoesRotulos no={no} onChange={onChange} />}
      {no.depois === 'pergunta' && <CampoPergunta no={no} onChange={onChange} />}
      {!semRespostas && <ContinuacoesDe no={no} onChange={onChange} nivel={nivel} />}
    </div>
  )
}

// ── Assistente ────────────────────────────────────────────────────────────────

export function FluxoEditor({ fluxoId, inicial }: { fluxoId: string | null; inicial: FluxoInicial | null }) {
  const router = useRouter()
  const [{ raizInicial, perdeu }] = useState(() => {
    if (!inicial?.etapas.length) return { raizInicial: exemplo(), perdeu: false }
    const r = etapasParaArvore(inicial.etapas)
    return { raizInicial: r.raiz ? mapearArvore(r.raiz, paraEditavel) : exemplo(), perdeu: r.perdeu }
  })
  const [passo, setPasso]               = useState(0)
  const [nome, setNome]                 = useState(inicial?.nome ?? '')
  const [ativo, setAtivo]               = useState(inicial?.ativo ?? true)
  const [raiz, setRaiz]                 = useState<NoTela>(raizInicial)
  const [palavras, setPalavras]         = useState((inicial?.gatilhoPalavras ?? ['menu']).filter(p => p !== QUALQUER_MENSAGEM).join(', '))
  const [qualquer, setQualquer]         = useState(inicial?.gatilhoPalavras.includes(QUALQUER_MENSAGEM) ?? false)
  const palavrasGatilho = qualquer ? [QUALQUER_MENSAGEM] : listaDePalavras(palavras)
  const [gatEtiquetas, setGatEtiquetas] = useState<EtiquetaSel[]>(inicial?.gatilhoEtiquetas ?? [])
  const [excEtiquetas, setExcEtiquetas] = useState<EtiquetaSel[]>(inicial?.excluirEtiquetas ?? [])
  const [palavrasHumano, setPalHumano]  = useState((inicial?.palavrasHumano ?? ['atendente', 'humano']).join(', '))
  const [msgNaoEntendi, setNaoEntendi]  = useState(inicial?.msgNaoEntendi ?? 'Não entendi. Responda com o número de uma das opções.')
  const [msgHumano, setMsgHumano]       = useState(inicial?.msgHumano ?? 'Certo! Já chamei alguém da equipe para falar com você.')
  const [avisoNumero, setAvisoNumero]   = useState(inicial?.avisoNumero ?? '')
  const [boasVindas, setBoasVindas]     = useState(inicial?.boasVindas ?? false)
  const [bvClientes, setBvClientes]     = useState(inicial?.boasVindasClientes ?? false)
  const [etiquetas, setEtiquetas]       = useState<UazapiEtiqueta[] | null>(null)
  const [erroEtiquetas, setErroEtq]     = useState<string | null>(null)
  const [salvando, setSalvando]         = useState(false)
  const [erro, setErro]                 = useState<string | null>(null)
  const [salvo, setSalvo]               = useState(false)
  const [simAberto, setSimAberto]       = useState(false)

  useEffect(() => {
    let vivo = true
    listarEtiquetasAction().then(r => {
      if (!vivo) return
      if (r.error) setErroEtq(r.error)
      else setEtiquetas(r.etiquetas ?? [])
    })
    return () => { vivo = false }
  }, [])

  const etapas = arvoreParaEtapas(raiz, {
    nome: nomeDoNo,
    passosAtendente: () => [{ ...textoInicial(msgHumano), digitacao_seg: 3 }],
  })
  const etapasSalvar = etapas.map(e => ({ ...e, passos: paraEnvio(e.passos) }))
  const fluxoSimulado = {
    id: fluxoId ?? 'novo', nome: nome || 'Automação', etapas: etapasSalvar as Etapa[],
    gatilho_palavras: palavrasGatilho, gatilho_etiquetas: [], excluir_etiquetas: [],
    palavras_humano: listaDePalavras(palavrasHumano), msg_nao_entendi: msgNaoEntendi, msg_humano: msgHumano,
    aviso_numero: avisoNumero.replace(/\D/g, '') || null,
    boas_vindas: boasVindas, boas_vindas_clientes: bvClientes,
  }

  async function salvar() {
    setErro(null); setSalvo(false)
    if (!nome.trim()) { setPasso(0); setErro('Dê um nome para a automação.'); return }
    if (etapas.some(e => e.passos.some(p => p.tipo !== 'texto' && !p.caminho))) { setErro('Uma mensagem com arquivo ainda está sem o arquivo.'); return }
    setSalvando(true)
    const r = await salvarFluxoAction(fluxoId, {
      nome, ativo, etapas: etapasSalvar,
      gatilhoPalavras: palavrasGatilho, gatilhoEtiquetas: gatEtiquetas, excluirEtiquetas: excEtiquetas,
      palavrasHumano: listaDePalavras(palavrasHumano), msgNaoEntendi, msgHumano, avisoNumero,
      boasVindas, boasVindasClientes: bvClientes,
    })
    setSalvando(false)
    if (r.error || !r.id) { setErro(r.error ?? 'Não foi possível salvar.'); return }
    setSalvo(true)
    if (!fluxoId) router.replace(`/chatbot/${r.id}`)
    else router.refresh()
  }

  const avancar = (e: React.FormEvent) => {
    e.preventDefault()
    if (passo < PASSOS_ASSISTENTE.length - 1) { setPasso(passo + 1); window.scrollTo({ top: 0 }) }
    else void salvar()
  }

  const semComeco = !palavrasGatilho.length && !gatEtiquetas.length && !boasVindas

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/chatbot" aria-label="Voltar para o chatbot" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">{fluxoId ? nome || 'Editar automação' : 'Nova automação'}</h1>
        <button type="button" onClick={() => setSimAberto(true)}
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm text-foreground lg:hidden">
          <MessageSquare className="h-4 w-4" /> Testar conversa
        </button>
      </div>

      {/* Passos */}
      <ol className="mb-5 grid grid-cols-4 gap-2">
        {PASSOS_ASSISTENTE.map((p, i) => (
          <li key={p.titulo}>
            <button type="button" onClick={() => setPasso(i)} aria-current={passo === i ? 'step' : undefined}
              className={`w-full rounded-xl border px-2 py-2 text-left transition sm:px-3 ${passo === i ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}>
              <span className="block text-[11px] text-muted-foreground tabular-nums">Passo {i + 1}</span>
              <span className={`block truncate text-sm font-medium ${passo === i ? 'text-foreground' : 'text-muted-foreground'}`}>{p.titulo}</span>
              <span className="hidden truncate text-[11px] text-muted-foreground md:block">{p.descricao}</span>
            </button>
          </li>
        ))}
      </ol>

      {perdeu && (
        <p role="status" className="mb-4 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">
          Esta automação foi montada no editor antigo e um caminho repetido virou &quot;Terminar&quot;. Confira as respostas antes de salvar.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <VariaveisDaAutomacao.Provider value={respostasGuardadas(raiz)}>
        <form onSubmit={avancar} className="min-w-0 space-y-5">
          {passo === 0 && (
            <>
              <section className="space-y-3 rounded-2xl border border-border bg-card p-4 md:p-5">
                <div>
                  <label htmlFor="auto-nome" className={LABEL}>Nome da automação</label>
                  <input id="auto-nome" value={nome} onChange={e => setNome(e.target.value)} required maxLength={80} placeholder="Atendimento de novos clientes" className={INPUT} />
                  <p className={AJUDA}>Só para você reconhecer na lista.</p>
                </div>
              </section>
              <section className="space-y-4 rounded-2xl border border-border bg-card p-4 md:p-5">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">O robô começa a conversa quando…</h2>
                  <p className={AJUDA}>Pode usar um ou mais jeitos. Fora disso, o robô não responde ninguém.</p>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">alguém manda uma mensagem</p>
                  <div role="radiogroup" aria-label="Que mensagem começa a automação" className="mb-2 flex flex-wrap gap-2">
                    {([[false, 'Só estas palavras'], [true, 'Qualquer mensagem']] as const).map(([valor, rotulo]) => (
                      <button key={rotulo} type="button" role="radio" aria-checked={qualquer === valor} onClick={() => setQualquer(valor)}
                        className={`rounded-xl border px-3 py-2 text-sm transition ${qualquer === valor ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                        {rotulo}
                      </button>
                    ))}
                  </div>
                  {qualquer ? (
                    <p className={AJUDA}>
                      Qualquer coisa que a pessoa mandar começa a conversa, inclusive quem é cliente respondendo uma cobrança.
                      Depois que a conversa termina, o robô espera 24h para começar de novo com a mesma pessoa.
                    </p>
                  ) : (
                    <>
                      <input id="auto-palavras" aria-label="Palavras que começam a automação" value={palavras} onChange={e => setPalavras(e.target.value)} placeholder="menu, quero, oi" className={INPUT} />
                      <p className={AJUDA}>Separe por vírgula. A mensagem precisa ser só a palavra (&quot;Menu&quot;, &quot;menu!&quot; valem; &quot;quero ver o menu&quot; não).</p>
                    </>
                  )}
                </div>
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-foreground"><Tag className="h-3.5 w-3.5 text-muted-foreground" /> alguém com a etiqueta manda mensagem</p>
                  <EscolhaEtiquetas escolhidas={gatEtiquetas} onChange={setGatEtiquetas} etiquetas={etiquetas} erro={erroEtiquetas} />
                  <p className={AJUDA}>Uma vez por dia no máximo, para o robô não recomeçar a cada &quot;obrigado&quot;.</p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={boasVindas} onChange={e => setBoasVindas(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
                    <span>
                      <span className="block text-sm font-medium text-foreground">alguém manda a primeira mensagem (boas-vindas)</span>
                      <span className="block text-xs text-muted-foreground">Cada pessoa recebe esta automação uma vez só. Depois disso, não recebe mais (a não ser que mande uma das palavras acima).</span>
                    </span>
                  </label>
                  {boasVindas && (
                    <div role="radiogroup" aria-label="Quem recebe as boas-vindas" className="mt-3 space-y-2 pl-7">
                      {([
                        [false, 'Só quem ainda não é cliente', 'Quem já está cadastrado em Clientes não recebe.'],
                        [true, 'Todos, inclusive quem já é cliente', 'Quem já é cliente também recebe uma vez, na próxima mensagem que mandar.'],
                      ] as const).map(([valor, titulo, ajuda]) => (
                        <label key={titulo} className="flex cursor-pointer items-start gap-2">
                          <input type="radio" name="bv-quem" checked={bvClientes === valor} onChange={() => setBvClientes(valor)} className="mt-0.5 h-4 w-4 accent-primary" />
                          <span>
                            <span className="block text-sm text-foreground">{titulo}</span>
                            <span className="block text-xs text-muted-foreground">{ajuda}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <p className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">alguém responde a um disparo seu:</span> ao criar o disparo, escolha esta automação em &quot;Quando responderem&quot;.
                  {semComeco && ' Sem nenhuma das opções acima, esta automação só começa assim.'}
                </p>
              </section>
              <section className="space-y-3 rounded-2xl border border-border bg-card p-4 md:p-5">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Deixar alguém de fora (opcional)</h2>
                  <p className={AJUDA}>Quem tiver uma destas etiquetas nunca entra nesta automação.</p>
                </div>
                <EscolhaEtiquetas escolhidas={excEtiquetas} onChange={setExcEtiquetas} etiquetas={etiquetas} erro={erroEtiquetas} />
              </section>
            </>
          )}

          {passo === 1 && (
            <section className="space-y-4 rounded-2xl border border-border bg-card p-4 md:p-5">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Mensagem de boas-vindas</h2>
                <p className={AJUDA}>
                  É a primeira coisa que a pessoa recebe. <code className="rounded bg-muted px-1">{'{{nome}}'}</code> vira o nome dela no WhatsApp e <code className="rounded bg-muted px-1">{'{{periododia}}'}</code> vira Bom dia, Boa tarde ou Boa noite.
                  Dá para mandar mais de uma mensagem, com foto, vídeo, áudio ou documento.
                </p>
              </div>
              <NoEditor no={raiz} onChange={setRaiz} nivel={0} raiz semRespostas />
              {(raiz.depois === 'menu' || raiz.depois === 'pergunta') && (
                <p className="text-xs text-muted-foreground">No próximo passo você escreve o que o robô responde {raiz.depois === 'menu' ? 'em cada opção' : 'depois da resposta'}.</p>
              )}
            </section>
          )}

          {passo === 2 && (
            <section className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Respostas</h2>
                <p className={AJUDA}>Para cada opção, escolha o que o robô faz. Uma resposta também pode ter as próprias opções.</p>
              </div>
              {raiz.depois === 'menu' || raiz.depois === 'pergunta'
                ? <ContinuacoesDe no={raiz} onChange={setRaiz} nivel={0} />
                : (
                  <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    A boas-vindas {raiz.depois === 'atendente' ? 'já chama você' : 'termina a conversa'}: não há respostas para configurar.
                    <button type="button" onClick={() => setPasso(1)} className="mt-2 block w-full text-xs font-medium text-primary hover:underline">Mostrar opções na boas-vindas</button>
                  </div>
                )}
            </section>
          )}

          {passo === 3 && (
            <section className="space-y-4 rounded-2xl border border-border bg-card p-4 md:p-5">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Quando chamar você</h2>
                <p className={AJUDA}>O robô para de responder aquela pessoa e avisa você. Ele também chama você se a pessoa errar as opções 3 vezes ou se você responder pelo celular.</p>
              </div>
              <div>
                <label htmlFor="auto-humano" className={LABEL}>Palavras que chamam você</label>
                <input id="auto-humano" value={palavrasHumano} onChange={e => setPalHumano(e.target.value)} placeholder="atendente, humano" className={INPUT} />
                <p className={AJUDA}>Valem em qualquer momento da conversa.</p>
              </div>
              <div>
                <label htmlFor="auto-msg-humano" className={LABEL}>Mensagem para a pessoa</label>
                <textarea id="auto-msg-humano" value={msgHumano} onChange={e => setMsgHumano(e.target.value)} rows={2} maxLength={1000} required className={INPUT + ' resize-y'} />
              </div>
              <div>
                <label htmlFor="auto-aviso" className={LABEL}>Seu número para receber o aviso</label>
                <input id="auto-aviso" value={avisoNumero} onChange={e => setAvisoNumero(e.target.value)} inputMode="tel" placeholder="21 99999-0000" className={INPUT + ' tabular-nums max-w-xs'} />
                <p className={AJUDA}>Você recebe no WhatsApp o nome, o número e as respostas da pessoa. Use outro número seu, não o conectado. Vazio = sem aviso.</p>
              </div>
              <div className="border-t border-border pt-4">
                <label htmlFor="auto-nao-entendi" className={LABEL}>Quando o robô não entende a resposta</label>
                <textarea id="auto-nao-entendi" value={msgNaoEntendi} onChange={e => setNaoEntendi(e.target.value)} rows={2} maxLength={1000} required className={INPUT + ' resize-y'} />
                <p className={AJUDA}>As opções vão junto de novo. E quem mandar SAIR ou PARAR para de receber o robô e seus disparos.</p>
              </div>
              <label className="flex cursor-pointer items-start gap-3 border-t border-border pt-4">
                <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
                <span>
                  <span className="block text-sm font-medium text-foreground">Automação ligada</span>
                  <span className="block text-xs text-muted-foreground">Desligada, o robô não responde por ela (nem quem já estava na conversa).</span>
                </span>
              </label>
            </section>
          )}

          <div className="flex items-center gap-3 border-t border-border pt-4">
            {passo > 0 && (
              <button type="button" onClick={() => setPasso(passo - 1)} className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground transition hover:text-foreground">
                Voltar
              </button>
            )}
            <div className="min-w-0 flex-1">
              {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}
              {!erro && salvo && <p role="status" className="text-xs text-muted-foreground">Automação salva.</p>}
            </div>
            {fluxoId && passo < PASSOS_ASSISTENTE.length - 1 && (
              <button type="button" onClick={() => void salvar()} disabled={salvando} className="rounded-xl border border-border px-4 py-2.5 text-sm text-foreground transition hover:border-primary disabled:opacity-50">
                Salvar
              </button>
            )}
            <button type="submit" disabled={salvando}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              {passo < PASSOS_ASSISTENTE.length - 1 ? 'Próximo' : salvando ? 'Salvando…' : fluxoId ? 'Salvar automação' : 'Criar automação'}
            </button>
          </div>
        </form>
        </VariaveisDaAutomacao.Provider>

        {/* Simulador: ao lado no computador, em painel no celular */}
        <aside className="hidden lg:block">
          <div className="sticky top-4"><Simulador fluxo={fluxoSimulado} /></div>
        </aside>
      </div>

      {simAberto && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSimAberto(false)} />
          <div role="dialog" aria-modal="true" aria-label="Testar conversa" className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-3 shadow-sm lg:hidden">
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={() => setSimAberto(false)} aria-label="Fechar" className="rounded-md p-1 text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <Simulador fluxo={fluxoSimulado} />
          </div>
        </>
      )}
    </div>
  )
}
