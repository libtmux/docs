import { SymbolIndex, symbolsForProduct, type ApiModel, type ApiSymbol } from '@libtmux/api-model'
import { PORT_BY_SLUG, portPageUrl, type DocProduct } from './ports'
import { withPortRoot } from './site-root'

/** Keep core references stable while product declarations stay in their section. */
export function productApiHref(model: ApiModel, symbol: ApiSymbol, version: string): string {
  if (symbol.product && symbol.product !== 'core' && symbol.apiScope !== 'internal') {
    return portPageUrl(PORT_BY_SLUG[model.port], version, `${symbol.product}/api/${symbol.slug}`)
  }
  return withPortRoot(`/reference/${model.port}/${symbol.slug}/`)
}

/** Product symbols share one route list between HTML and Markdown exports. */
export function productApiRoutes(
  models: Record<string, ApiModel>,
  buildPort: string | undefined,
  defaults: Record<string, string>,
  buildVersion: string,
): { path: string; model: ApiModel; symbol: ApiSymbol; version: string }[] {
  return Object.entries(models).filter(([port]) => !buildPort || port === buildPort)
    .flatMap(([port, model]) => {
      const version = buildPort ? buildVersion : (defaults[port] ?? 'latest')
      return [...symbolsForProduct(model, 'mcp'), ...symbolsForProduct(model, 'workspace')].map((symbol) => ({
        path: `${buildPort ? '' : `${port}/${version}/`}${symbol.product}/api/${symbol.slug}`,
        model, symbol, version,
      }))
    })
}

/** Public declarations listed on a product's reference landing page. */
export function productApiRoots(model: ApiModel, product: DocProduct): ApiSymbol[] {
  const symbols = symbolsForProduct(model, product)
  const ids = new Set(symbols.map((symbol) => symbol.id))
  return symbols.filter((symbol) => !symbol.parent || !ids.has(symbol.parent))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const indexes = new WeakMap<ApiModel, Map<string, SymbolIndex>>()

/** Reuse a symbol index without mixing core and product URL builders. */
export function productApiIndex(model: ApiModel, version: string): SymbolIndex {
  let versions = indexes.get(model)
  if (!versions) { versions = new Map(); indexes.set(model, versions) }
  let index = versions.get(version)
  if (!index) {
    index = new SymbolIndex(model.symbols, (symbol) => productApiHref(model, symbol, version), model.port)
    versions.set(version, index)
  }
  return index
}
