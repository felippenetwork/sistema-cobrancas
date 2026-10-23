'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Search, Users } from 'lucide-react'
import type { PreferenciaNome, ResumoGrupo } from '@/lib/disparo/extracao'
import { importarGrupoAction, listarGruposAction } from '../_actions'

/**
 * Escolhe um grupo/comunidade do WhatsApp conectado e devolve as linhas "Nome; número" para a
 * lista do disparo. Buscar grupos grandes pode levar dezenas de segundos — a tela avisa.
 */
export function ImportarGrupo({ onImportar, onFechar }: {
  onImportar: (linhas: string, resumo: string) => void
  onFechar: () => void
}) {
  const [grupos, setGrupos] = useState<ResumoGrupo[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [escolhido, setEscolhido] = useState<ResumoGrupo | null>(null)
  const [preferencia, setPreferencia] = useState<PreferenciaNome>('whatsapp')
  const [importando, setImportando] = useState(false)

  useEffect(() => {
    let vivo = true
    listarGruposAction().then(r => {
      if (!vivo) return
      if (r.error) setErro(r.error)
      else setGrupos(r.grupos ?? [])
    })
    return () => { vivo = false }
  }, [])

  async function importar() {
    if (!escolhido) return
    setErro(null)
    setImportando(true)
    const r = await importarGrupoAction({ jid: escolhido.jid, preferencia })
    setImportando(false)
    if (r.error || !r.linhas) { setErro(r.error ?? 'Nada para importar.'); return }
    const partes = [`${r.total} contato${r.total === 1 ? '' : 's'} de "${escolhido.nome}"`]
    if (r.semNome) partes.push(`${r.semNome} sem nome`)
    if (r.semTelefone) partes.push(`${r.semTelefone} com número oculto pelo WhatsApp (não importados)`)
    if (r.agendaIndisponivel) partes.push('agenda indisponível agora: nomes só do WhatsApp')
    onImportar(r.linhas, partes.join(' · '))
  }

  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  const visiveis = (grupos ?? []).filter(g => !termo || g.nome.toLocaleLowerCase('pt-BR').includes(termo))

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground">Importar de grupo ou comunidade</p>
        <button type="button" onClick={onFechar} className="text-xs text-muted-foreground hover:text-foreground">Fechar</button>
      </div>

      {!grupos && !erro && (
        <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Buscando os grupos no WhatsApp… em grupos grandes isso leva até um minuto.
        </p>
      )}
      {erro && <p role="alert" className="text-xs text-destructive">{erro}</p>}

      {grupos && (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar grupo" aria-label="Buscar grupo"
              className="w-full rounded-lg border border-border bg-input py-2 pl-8 pr-3 text-sm text-foreground outline-none focus-visible:border-primary" />
          </div>

          <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {visiveis.length === 0 && (
              <li className="px-3 py-4 text-xs text-muted-foreground">{grupos.length ? 'Nenhum grupo com esse nome.' : 'Este WhatsApp não está em nenhum grupo.'}</li>
            )}
            {visiveis.map(g => {
              const ativo = escolhido?.jid === g.jid
              return (
                <li key={g.jid}>
                  <button type="button" aria-pressed={ativo} onClick={() => setEscolhido(g)}
                    className={['flex w-full items-center gap-3 px-3 py-2.5 text-left transition', ativo ? 'bg-primary/10' : 'hover:bg-accent'].join(' ')}>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 truncate text-sm text-foreground">
                        {g.tipo === 'comunidade' && <Users className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Comunidade" />}
                        <span className="truncate">{g.nome}</span>
                      </span>
                      <span className="block text-[11px] text-muted-foreground tabular-nums">
                        {g.tipo === 'comunidade' ? 'Comunidade · todos os grupos · ' : g.comunidade ? `Em ${g.comunidade} · ` : ''}
                        {g.comTelefone} com número{g.total > g.comTelefone ? ` · ${g.total - g.comTelefone} ocultos` : ''}
                      </span>
                    </span>
                    {ativo && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                </li>
              )
            })}
          </ul>

          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs text-muted-foreground">Nome que vai no {'{{nome}}'}</legend>
            {([
              ['whatsapp', 'Nome do WhatsApp', 'O nome que a pessoa usa no WhatsApp; se não tiver, o salvo na sua agenda.'],
              ['agenda', 'Nome salvo na agenda', 'Como você salvou o contato; se não estiver salvo, o nome do WhatsApp.'],
            ] as const).map(([valor, titulo, desc]) => (
              <label key={valor} className="flex cursor-pointer items-start gap-2 text-xs">
                <input type="radio" name="pref-nome" value={valor} checked={preferencia === valor} onChange={() => setPreferencia(valor)} className="mt-0.5 accent-primary" />
                <span><span className="text-foreground">{titulo}</span> — <span className="text-muted-foreground">{desc}</span></span>
              </label>
            ))}
          </fieldset>

          <button type="button" onClick={importar} disabled={!escolhido || importando}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
            {importando && <Loader2 className="h-4 w-4 animate-spin" />}
            {importando ? 'Lendo o grupo…' : escolhido ? `Importar ${escolhido.comTelefone} contatos` : 'Escolha um grupo'}
          </button>
        </>
      )}
    </div>
  )
}
