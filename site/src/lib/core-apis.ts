/**
 * The library symbols a capability's example uses, linked to the API reference.
 *
 * `data/core-apis.json` names candidate symbols per port and capability. A
 * candidate is listed only if the shown program mentions its name and the
 * port's API model has it as a public core symbol, so a renamed or removed
 * symbol, or one the example does not use, fails `apisUsed` and
 * `test/core-apis.test.ts`. The list is ordered by the symbol's first use in
 * the program and holds no standard-library items, because the model holds
 * none.
 */
import DATA from '../data/core-apis.json'
import { API_MODELS, referenceHref } from './api-models.ts'
import { PORT_BY_SLUG, referenceUrl } from './ports.ts'

/** Entries shown before "+N more". */
export const MAX_APIS = 10

export const CORE_APIS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = DATA

export interface ApiUsed {
  id: string
  label: string
  href: string
  /** Offset of the first use in the program. */
  at: number
}

export interface ApisUsed {
  shown: ApiUsed[]
  more: number
  moreHref: string
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The symbols `ids` name, as the program uses them, in order of first use. */
export function apisUsed(port: string, ids: readonly string[], code: string, version: string, what = port): ApisUsed {
  const info = PORT_BY_SLUG[port]
  const model = API_MODELS[port]
  if (!info || !model) throw new Error(`core-apis: unknown port ${port}`)
  const seen = new Set<string>()
  const found = ids.map((id): ApiUsed => {
    if (seen.has(id)) throw new Error(`core-apis: ${what} lists ${id} twice`)
    seen.add(id)
    const symbol = model.symbols.find((entry) => (entry.publicId ?? entry.id) === id)
    if (!symbol) throw new Error(`core-apis: ${what} names ${id}, which is not in the ${port} API model`)
    if (symbol.apiScope === 'internal' || (symbol.product ?? 'core') !== 'core') throw new Error(`core-apis: ${what} names ${id}, which has no core reference page`)
    const at = new RegExp(`(?<![\\w])${escape(symbol.name)}(?![\\w])`).exec(code)?.index
    if (at === undefined) throw new Error(`core-apis: ${what} names ${id}, but the program never uses ${symbol.name}`)
    const href = referenceHref(port, id, version)
    if (!href) throw new Error(`core-apis: ${what} has no reference page for ${id}`)
    const parent = symbol.parent ? model.symbols.find((entry) => entry.id === symbol.parent) : undefined
    const separator = port === 'rs' ? '::' : /[#.]/.exec(id.slice(id.lastIndexOf(parent?.name ?? '') + (parent?.name.length ?? 0)))?.[0] ?? '.'
    return { id, label: parent ? `${parent.name}${separator}${symbol.name}` : symbol.name, href, at }
  }).sort((a, b) => a.at - b.at)
  return { shown: found.slice(0, MAX_APIS), more: Math.max(0, found.length - MAX_APIS), moreHref: referenceUrl(info, version) }
}
