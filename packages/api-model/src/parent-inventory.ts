import type { ApiModel, ApiSymbol } from './model.ts'
import type { InventoryEntry } from './inventory.ts'
import { OWNER_KINDS } from './prose.ts'

/** Parent APIs used by a facade, including unambiguous short names. */
export function parentInventory(model: ApiModel, hrefFor: (symbol: ApiSymbol) => string): InventoryEntry[] {
  const candidates = new Map<string, Map<string, { entry: InventoryEntry; rank: number }>>()
  for (const symbol of model.symbols) {
    if (symbol.apiScope === 'internal' || (symbol.product && symbol.product !== 'core')) continue
    const name = symbol.qualifiedName ?? (symbol.publicId ?? symbol.id).replace(/(^|\.)(\w+)\.\2(?=\.|$)/g, '$1$2')
    const uri = hrefFor(symbol).replace(/^\/+/, '')
    const parts = name.split('.')
    for (let offset = 0; offset < parts.length; offset++) {
      const alias = parts.slice(offset).join('.')
      const entries = candidates.get(alias) ?? new Map()
      entries.set(uri, {
        entry: { name: alias, uri, type: 'std:label', priority: 1, dispname: '-' },
        rank: OWNER_KINDS.has(symbol.kind) ? 0 : 1,
      })
      candidates.set(alias, entries)
    }
  }
  return [...candidates.values()].flatMap((entries) => {
    const rank = Math.min(...[...entries.values()].map((candidate) => candidate.rank))
    const best = [...entries.values()].filter((candidate) => candidate.rank === rank)
    return best.length === 1 ? [best[0].entry] : []
  })
}

