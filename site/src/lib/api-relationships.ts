import type { ApiModelBase, ApiSymbol } from '@libtmux/api-model'
import { sourceUrl } from '@libtmux/api-model'

type Reference = NonNullable<ApiSymbol['references']>[number]
export interface ApiRelationship {
  from: ApiSymbol
  to: ApiSymbol
  kind: Reference['kind']
}
export interface ApiRelationshipSection {
  id: string
  label: string
  items: ApiSymbol[]
}
export interface ApiRelationshipPath {
  title: string
  symbols: ApiSymbol[]
  edges: ApiRelationship['kind'][]
}

const catalogs = new WeakMap<ApiModelBase, ReturnType<typeof catalogFor>>()
function catalogFor(model: ApiModelBase) {
  const symbols = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))
  const outgoing = new Map<string, ApiRelationship[]>()
  const incoming = new Map<string, ApiRelationship[]>()
  for (const from of model.symbols) {
    for (const reference of from.references ?? []) {
      const to = symbols.get(reference.target)
      if (!to) continue
      const edge = { from, to, kind: reference.kind }
      const out = outgoing.get(from.id) ?? []
      const into = incoming.get(to.id) ?? []
      out.push(edge)
      into.push(edge)
      outgoing.set(from.id, out)
      incoming.set(to.id, into)
    }
  }
  return { symbols, outgoing, incoming }
}
function catalog(model: ApiModelBase) {
  let value = catalogs.get(model)
  if (!value) {
    value = catalogFor(model)
    catalogs.set(model, value)
  }
  return value
}

/** Native relationships only: taking a callback's address is not a call. */
export function apiRelationships(model: ApiModelBase, symbol: ApiSymbol) {
  const graph = catalog(model)
  return { outgoing: graph.outgoing.get(symbol.id) ?? [], incoming: graph.incoming.get(symbol.id) ?? [] }
}

/** Cite the call token, separately from the callee's declaration link. */
export function apiCallSource(model: ApiModelBase, from: ApiSymbol, to: ApiSymbol): string | undefined {
  const site = from.references?.find((edge) => edge.kind === 'call' && edge.target === to.id)?.sites?.[0]
  return site ? sourceUrl(model, { ...from, source: { ...from.source, ...site } }) : undefined
}

/** The same incoming/outgoing groups appear in HTML and copied Markdown. */
export function apiRelationshipSections(model: ApiModelBase, symbol: ApiSymbol): ApiRelationshipSection[] {
  const { outgoing, incoming } = apiRelationships(model, symbol)
  const calls = new Set(outgoing.filter((edge) => edge.kind === 'call').map((edge) => edge.to.id))
  const callers = new Set(incoming.filter((edge) => edge.kind === 'call').map((edge) => edge.from.id))
  const groups: ApiRelationshipSection[] = [
    {
      id: 'api-called-by',
      label: 'Called by',
      items: incoming.filter((edge) => edge.kind === 'call').map((edge) => edge.from),
    },
    { id: 'api-calls', label: 'Calls', items: outgoing.filter((edge) => edge.kind === 'call').map((edge) => edge.to) },
    {
      id: 'api-function-references',
      label: 'Other function references',
      items: outgoing
        .filter((edge) => edge.kind === 'reference' && edge.to.kind === 'function' && !calls.has(edge.to.id))
        .map((edge) => edge.to),
    },
    {
      id: 'api-referenced-by',
      label: 'Referenced by',
      items: incoming
        .filter((edge) => edge.kind === 'reference' && !callers.has(edge.from.id))
        .map((edge) => edge.from),
    },
    {
      id: 'api-referenced-declarations',
      label: 'Referenced declarations',
      items: outgoing.filter((edge) => edge.kind !== 'call' && edge.to.kind !== 'function').map((edge) => edge.to),
    },
  ]
  return groups
    .map((group) => ({
      ...group,
      items: [...new Map(group.items.map((item) => [item.id, item])).values()].sort(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      ),
    }))
    .filter((group) => group.items.length > 0)
}

/** A reading path is available only when every edge exists in this version. */
export function apiRelationshipPath(
  model: ApiModelBase,
  title: string,
  ids: string[],
): ApiRelationshipPath | undefined {
  const graph = catalog(model)
  const symbols = ids.map((id) => graph.symbols.get(id))
  if (symbols.length < 2 || symbols.some((symbol) => !symbol || symbol.kind !== 'function')) return undefined
  const edges = ids.slice(1).map((id, i) => {
    const candidates = graph.outgoing.get(ids[i])?.filter((edge) => edge.to.id === id && edge.kind !== 'type') ?? []
    return candidates.find((edge) => edge.kind === 'call') ?? candidates[0]
  })
  if (edges.some((edge) => !edge)) return undefined
  return { title, symbols: symbols as ApiSymbol[], edges: edges.map((edge) => edge!.kind) }
}
