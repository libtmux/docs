import type { ApiModel, ApiSymbol } from './model.ts'

/** The source-qualified spelling shown to readers; stable link ids remain separate. */
export const qualifiedNameOf = (symbol: ApiSymbol): string => symbol.qualifiedName ?? symbol.publicId ?? symbol.id

/**
 * The module, package or namespace a symbol is declared in.
 *
 * Prefer a source declaration. Older models encode their module in the public
 * id; trimming the symbol name retains that fallback, including C++'s `::`.
 *
 * Returns '' for a symbol whose id is a bare name, which is a symbol at the
 * root of a port that has no module concept.
 */
export function moduleOf(symbol: ApiSymbol): string {
  if (symbol.namespace !== undefined) return symbol.namespace
  const id = symbol.publicId ?? symbol.id
  if (!id.endsWith(symbol.name)) return ''
  return id.slice(0, id.length - symbol.name.length).replace(/[.:]+$/, '')
}

/**
 * Every module in a model, each with the top-level symbols it declares.
 *
 * Members are excluded: a class's methods belong to the class, and a module
 * listing that repeats them is a wall rather than an index. Modules are
 * returned in declaration-path order so the listing reads like the source
 * tree, with the shallowest — usually the primary package — first.
 */
export function modulesIn(model: ApiModel): { name: string; symbols: ApiSymbol[] }[] {
  const byModule = new Map<string, ApiSymbol[]>()
  for (const s of model.symbols) {
    if (s.parent) continue
    const mod = moduleOf(s)
    if (!mod) continue
    const list = byModule.get(mod) ?? []
    list.push(s)
    byModule.set(mod, list)
  }
  // Older models can take a module segment from the file name and yield one
  // "module" per type. Below
  // an average of two symbols per module there is no grouping to be had, and
  // saying so here — rather than on the page — is what keeps the set of
  // modules that resolve identical to the set that gets rendered an anchor.
  const total = [...byModule.values()].reduce((n, list) => n + list.length, 0)
  if (byModule.size < 2 || total < byModule.size * 2) return []

  return [...byModule]
    .map(([name, symbols]) => ({
      name,
      symbols: symbols.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
    }))
    .sort(
      (a, b) =>
        a.name.split(/[.:]+/).length - b.name.split(/[.:]+/).length ||
        a.name.localeCompare(b.name),
    )
}
