import type { ApiModel, ApiSymbol } from './model.ts'
import type { InventoryEntry } from './inventory.ts'
import { OWNER_KINDS } from './prose.ts'

const qualifiedNameOf = (symbol: ApiSymbol) =>
  symbol.qualifiedName ?? (symbol.publicId ?? symbol.id).replace(/(^|\.)(\w+)\.\2(?=\.|$)/g, '$1$2')

/**
 * Parent APIs used by a facade, including unambiguous short names.
 *
 * The parent's workspace and MCP products are named by their full qualified name. A type of theirs is
 * also named by its short name when nothing else in the parent carries it: a shared short name would
 * compete with the core's for a bare word the facade's prose uses for its own API. Their members keep
 * only the qualified name.
 */
export function parentInventory(model: ApiModel, hrefFor: (symbol: ApiSymbol) => string): InventoryEntry[] {
  const candidates = new Map<string, Map<string, { entry: InventoryEntry; rank: number }>>()
  for (const symbol of model.symbols) {
    if (symbol.apiScope === 'internal') continue
    const core = !symbol.product || symbol.product === 'core'
    const qualified = qualifiedNameOf(symbol)
    const name = model.port === 'java' && symbol.id.endsWith('()') ? `${qualified}()` : qualified
    const uri = hrefFor(symbol).replace(/^\/+/, '')
    const parts = name.split('.')
    for (let offset = 0; offset < (core ? parts.length : 1); offset++) {
      const alias = parts.slice(offset).join('.')
      const entries = candidates.get(alias) ?? new Map()
      entries.set(uri, {
        entry: { name: alias, uri, type: 'std:label', priority: 1, dispname: '-' },
        rank: OWNER_KINDS.has(symbol.kind) ? 0 : 1,
      })
      candidates.set(alias, entries)
    }
  }
  const shortNames = new Map<string, Map<string, InventoryEntry>>()
  for (const symbol of model.symbols) {
    if (symbol.apiScope === 'internal' || !OWNER_KINDS.has(symbol.kind) || !symbol.product || symbol.product === 'core') continue
    const qualified = qualifiedNameOf(symbol)
    const alias = qualified.split('.').at(-1)!
    if (alias === qualified || candidates.has(alias)) continue
    const uri = hrefFor(symbol).replace(/^\/+/, '')
    const entries = shortNames.get(alias) ?? new Map<string, InventoryEntry>()
    entries.set(uri, { name: alias, uri, type: 'std:label', priority: 1, dispname: '-' })
    shortNames.set(alias, entries)
  }
  const unique = [...shortNames.values()].flatMap((entries) => entries.size === 1 ? [...entries.values()] : [])
  return [...unique, ...[...candidates.values()].flatMap((entries) => {
    const rank = Math.min(...[...entries.values()].map((candidate) => candidate.rank))
    const best = [...entries.values()].filter((candidate) => candidate.rank === rank)
    return best.length === 1 ? [best[0].entry] : []
  })]
}

