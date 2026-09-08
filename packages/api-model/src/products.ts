import type { ApiModel, ApiProduct, ApiSymbol } from './model.ts'

/** Select a product without assigning legacy core declarations to a new package. */
export function symbolsForProduct(model: ApiModel, product: ApiProduct): ApiSymbol[] {
  return model.symbols.filter((symbol) => (symbol.product ?? 'core') === product && symbol.apiScope !== 'internal')
}

/** Generated members without files belong to the product declaring their owner. */
export function inheritProductFromOwners(symbols: ApiSymbol[]): void {
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]))
  for (const symbol of symbols) {
    if (symbol.source.file || !symbol.parent) continue
    let owner = byId.get(symbol.parent)
    const seen = new Set([symbol.id])
    while (owner && !seen.has(owner.id)) {
      seen.add(owner.id)
      if (owner.source.file || !owner.parent) {
        if (owner.product) symbol.product = owner.product
        break
      }
      owner = byId.get(owner.parent)
    }
  }
}

/** Build a source link from the declaration's repository before the port fallback. */
export function sourceUrl(model: ApiModel, symbol: ApiSymbol): string | undefined {
  const { file, line } = symbol.source
  const repo = symbol.source.repo ?? model.repo
  const revision = symbol.source.revision ?? model.revision
  if (!file || !repo || !revision) return undefined
  return `https://github.com/${repo}/blob/${revision}/${file}${line ? `#L${line}` : ''}`
}
