/** Where libraries and the C source meet the catalog. */
import { qualifiedNameOf, type ApiModel, type ApiSymbol, type SourceApiModel } from '@libtmux/api-model'
import { API_MODELS, PORT_NAME, referenceHref } from './api-models'
import type { CatalogEntry } from './tmux-catalog'
import { tmuxCatalogMentions, tmuxCatalogProseMentions } from './tmux-catalog-links'
import { tmuxReferenceUrl, tmuxSourceModel } from './tmux-reference'

export interface CatalogUse {
  port: string
  name: string
  symbols: { label: string; href: string }[]
}

/** Every text a symbol's documentation carries. */
function docTexts(symbol: ApiSymbol): string[] {
  const blocks = [symbol.doc, ...symbol.signatures.map((signature) => signature.doc), ...(symbol.declarations ?? []).map((declaration) => declaration.doc)]
  const texts: (string | undefined)[] = blocks.flatMap((doc) => doc ? [
    doc.summary, doc.body, doc.deprecated, doc.changed,
    ...(doc.examples ?? []).flatMap((example) => [example.intro, example.outro]),
    ...(doc.admonitions ?? []).map((admonition) => admonition.text),
  ] : [])
  for (const signature of symbol.signatures) {
    texts.push(signature.returnsDoc, ...signature.params.map((param) => param.doc), ...(signature.raises ?? []).map((raise) => raise.doc))
  }
  return texts.filter((value): value is string => Boolean(value))
}

const LITERALS = /``([^`\n]+?)``|`([^`\n]+?)`|<code>(.*?)<\/code>|\{@code\s+([^}]+)\}|<c>(.*?)<\/c>/g

/** Names a documentation text mentions, in prose or in code literals. */
export function catalogNamesIn(text: string, version = 'latest'): Set<string> {
  const found = new Set<string>()
  for (const mention of tmuxCatalogProseMentions(text, version)) found.add(`${mention.kind}/${mention.name}`)
  for (const match of text.matchAll(LITERALS)) {
    const literal = match.slice(1).find((part) => part !== undefined)!
    const start = match.index!
    const around = { before: text.slice(Math.max(0, start - 48), start), after: text.slice(start + match[0].length, start + match[0].length + 48) }
    for (const mention of tmuxCatalogMentions(literal, { code: true, version, ...around })) found.add(`${mention.kind}/${mention.name}`)
  }
  return found
}

let usage: Map<string, Map<string, { label: string; href: string }[]>> | undefined

function buildUsage() {
  const out = new Map<string, Map<string, { label: string; href: string }[]>>()
  for (const [port, model] of Object.entries(API_MODELS) as [string, ApiModel][]) {
    for (const symbol of model.symbols) {
      if (symbol.apiScope === 'internal') continue
      const names = new Set<string>()
      for (const text of docTexts(symbol)) for (const name of catalogNamesIn(text)) names.add(name)
      if (!names.size) continue
      const href = referenceHref(port, symbol.publicId ?? symbol.id)
      if (!href) continue
      for (const name of names) {
        const ports = out.get(name) ?? new Map()
        ports.set(port, [...(ports.get(port) ?? []), { label: qualifiedNameOf(symbol), href }])
        out.set(name, ports)
      }
    }
  }
  return out
}

/** The library members whose documentation names this entry, by language. */
export function tmuxCatalogUses(entry: CatalogEntry): CatalogUse[] {
  usage ??= buildUsage()
  const ports = usage.get(`${entry.kind}/${entry.name}`)
  if (!ports) return []
  return Object.keys(API_MODELS).filter((port) => ports.has(port)).map((port) => ({
    port, name: PORT_NAME[port] ?? port, symbols: ports.get(port)!.sort((a, b) => a.label.localeCompare(b.label)),
  }))
}

/** Every entry that has at least one library member naming it. */
export function tmuxCatalogUsedNames(): string[] {
  usage ??= buildUsage()
  return [...usage.keys()]
}

const bySourceName = new WeakMap<SourceApiModel, Map<string, ApiSymbol[]>>()
function symbolsNamed(version: string, name: string): ApiSymbol[] {
  const model = tmuxSourceModel(version)
  let index = bySourceName.get(model)
  if (!index) {
    index = new Map()
    for (const symbol of model.symbols) index.set(symbol.name, [...(index.get(symbol.name) ?? []), symbol])
    bySourceName.set(model, index)
  }
  return index.get(name) ?? []
}

/** The C declarations behind an entry: its table and the functions that read or fire it. */
export function tmuxCatalogReferences(version: string, entry: CatalogEntry): { name: string; href: string }[] {
  const wanted = entry.kind === 'option' ? ['options_table']
    : entry.kind === 'hook' ? ['options_table', ...new Set((entry.firedFrom ?? []).map((site) => site.call).filter((call): call is string => Boolean(call)))]
      : [entry.callback ?? 'format_table']
  return wanted.flatMap((name) => {
    const symbols = symbolsNamed(version, name)
    const symbol = symbols.find((candidate) => candidate.source.file === entry.source.file) ?? symbols[0]
    return symbol ? [{ name, href: tmuxReferenceUrl(version, symbol) }] : []
  })
}
