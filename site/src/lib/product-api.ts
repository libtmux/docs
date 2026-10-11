import { symbolsForProduct, type ApiModel, type ApiSymbol, type SymbolIndex } from '@libtmux/api-model'
import { API_MODELS, createApiIndex, referenceAlternatives } from './api-models'
import { PORT_BY_SLUG, portPageUrl, productApiPath, referenceUrl, type DocProduct } from './ports'

/** Keep core references stable while product declarations stay in their section. */
export function productApiHref(model: ApiModel, symbol: ApiSymbol, version: string): string {
  if (symbol.product && symbol.product !== 'core' && symbol.apiScope !== 'internal') {
    return portPageUrl(PORT_BY_SLUG[model.port], version, `${productApiPath(symbol.product)}/${symbol.slug}`)
  }
  return `${referenceUrl(PORT_BY_SLUG[model.port], version)}${symbol.slug}/`
}

/** Equivalent declarations stay in their product and target port's version. */
export function productApiAlternatives(
  model: ApiModel,
  symbol: ApiSymbol,
  version: string,
  defaults: Record<string, string>,
) {
  return referenceAlternatives(model.port, symbol.publicId ?? symbol.id).map((group) => ({
    ...group,
    ports: group.ports.map((entry) => {
      const target = API_MODELS[entry.port]
      const declaration = entry.publicId
        ? target?.symbols.find((candidate) => (candidate.publicId ?? candidate.id) === entry.publicId)
        : undefined
      return {
        ...entry,
        href: declaration
          ? productApiHref(
              target,
              declaration,
              entry.port === model.port ? version : (defaults[entry.port] ?? 'latest'),
            )
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
  return Object.entries(models)
    .filter(([port]) => !buildPort || port === buildPort)
    .flatMap(([port, model]) => {
      const version = buildPort ? buildVersion : (defaults[port] ?? 'latest')
      return [...symbolsForProduct(model, 'mcp'), ...symbolsForProduct(model, 'workspace')].map((symbol) => ({
        path: `${buildPort ? '' : `${port}/${version}/`}${productApiPath(symbol.product as DocProduct)}/${symbol.slug}`,
        model,
        symbol,
        version,
      }))
    })
}

/** Retired generated operators lead to their current type, outside the API inventory. */
export function productApiRedirects(
  models: Record<string, ApiModel>,
  buildPort: string | undefined,
  defaults: Record<string, string>,
  buildVersion: string,
) {
  // WorkspaceBuilderError now carries arbitrary callback errors and is no longer Equatable.
  const model = models.swift
  if (
    !model ||
    (buildPort && buildPort !== 'swift') ||
    model.symbols.some((symbol) => symbol.id === 'WorkspaceBuilderError.!=(_:_:)')
  )
    return []
  const owner = productApiRoutes({ swift: model }, buildPort, defaults, buildVersion).find(
    (route) => route.symbol.id === 'WorkspaceBuilderError',
  )
  if (!owner) return []
  return [
    {
      ...owner,
      target: owner.path,
      path: owner.path.replace(/workspacebuildererror$/, 'workspacebuildererror-(_-_-)'),
    },
  ]
}

/** Public declarations listed on a product's reference landing page. */
export function productApiRoots(model: ApiModel, product: DocProduct): ApiSymbol[] {
  const symbols = symbolsForProduct(model, product)
  const ids = new Set(symbols.map((symbol) => symbol.id))
  return symbols
    .filter((symbol) => !symbol.parent || !ids.has(symbol.parent))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const indexes = new WeakMap<ApiModel, Map<string, SymbolIndex>>()

/** Reuse a symbol index without mixing core and product URL builders. */
export function productApiIndex(model: ApiModel, version: string): SymbolIndex {
  let versions = indexes.get(model)
  if (!versions) {
    versions = new Map()
    indexes.set(model, versions)
  }
  let index = versions.get(version)
  if (!index) {
    index = createApiIndex(model, (symbol) => productApiHref(model, symbol, version))
    versions.set(version, index)
  }
  return index
}
