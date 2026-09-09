import { symbolsForProduct, type ApiModel, type ApiSymbol, type SymbolIndex } from '@libtmux/api-model'
import { API_MODELS, createApiIndex, referenceAlternatives } from './api-models'
import { PORT_BY_SLUG, portPageUrl, productApiPath, type DocProduct } from './ports'
import { withPortRoot } from './site-root'

/** Keep core references stable while product declarations stay in their section. */
export function productApiHref(model: ApiModel, symbol: ApiSymbol, version: string): string {
  if (symbol.product && symbol.product !== 'core' && symbol.apiScope !== 'internal') {
    return portPageUrl(PORT_BY_SLUG[model.port], version, `${productApiPath(symbol.product)}/${symbol.slug}`)
  }
  return withPortRoot(`/reference/${model.port}/${symbol.slug}/`)
}

/** Equivalent declarations stay in their product and target port's version. */
export function productApiAlternatives(model: ApiModel, symbol: ApiSymbol, version: string, defaults: Record<string, string>) {
  return referenceAlternatives(model.port, symbol.publicId ?? symbol.id).map((group) => ({
    ...group,
    ports: group.ports.map((entry) => {
      const target = API_MODELS[entry.port]
      const declaration = entry.publicId
        ? target?.symbols.find((candidate) => (candidate.publicId ?? candidate.id) === entry.publicId) : undefined
      return {
        ...entry,
        href: declaration
          ? productApiHref(target, declaration, entry.port === model.port ? version : (defaults[entry.port] ?? 'latest'))
          : entry.href,
      }
    }),
  }))
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
        path: `${buildPort ? '' : `${port}/${version}/`}${productApiPath(symbol.product as DocProduct)}/${symbol.slug}`,
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
    index = createApiIndex(model, (symbol) => productApiHref(model, symbol, version))
    versions.set(version, index)
  }
  return index
}
