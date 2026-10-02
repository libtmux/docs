import { memberTier, type ApiSymbol, type MemberSignals, type Signature, type SymbolIndex } from '@libtmux/api-model'

export interface ApiSection {
  id: string
  label: string
  nested?: boolean
  count?: number
}

/** The fields shown by ApiEntry, shared with its section navigation. */
export function apiEntryFields(symbol: ApiSymbol, port?: string) {
  const native = ['kotlin', 'scala', 'fsharp'].includes(port ?? '')
  const label = (signature: Signature) => signature.raw?.replace(/\s+/g, ' ').trim() ??
    `${symbol.name}(${signature.params.map((param) => `${param.name}${param.type ? `: ${param.type}` : ''}`).join(', ')})`
  const collect = <T>(read: (signature: Signature) => T[]) => {
    const fields = new Map<string, { value: T; signatures: Set<number> }>()
    symbol.signatures.forEach((signature, i) => {
      for (const value of read(signature)) {
        const key = JSON.stringify(value)
        const field = fields.get(key) ?? { value, signatures: new Set<number>() }
        field.signatures.add(i)
        fields.set(key, field)
      }
    })
    return [...fields.values()].map(({ value, signatures }) => ({
      ...value,
      overloads: signatures.size < symbol.signatures.length
        ? [...signatures].map((i) => label(symbol.signatures[i])) : [],
    }))
  }
  return {
    params: collect((signature) => signature.params.filter((param) => native || param.doc)),
    returns: collect((signature) => signature.returnsDoc ? [{ doc: signature.returnsDoc }] : []),
    raises: collect((signature) => signature.raises ?? []),
  }
}

/** Only sections that the declaration actually renders, in reading order. */
export function apiEntrySections(symbol: ApiSymbol, port?: string): ApiSection[] {
  const anchor = symbol.publicId ?? symbol.id
  const fields = apiEntryFields(symbol, port)
  const sections: ApiSection[] = []
  if (symbol.doc?.body) sections.push({ id: `${anchor}.description`, label: 'Description' })
  if (symbol.doc?.examples?.length) sections.push({ id: `${anchor}.examples`, label: 'Examples' })
  if (symbol.doc?.references?.length) sections.push({ id: `${anchor}.references`, label: 'References' })
  if (fields.params.length) sections.push({ id: `${anchor}.parameters`, label: 'Parameters' })
  if (fields.returns.length) sections.push({ id: `${anchor}.returns`, label: 'Returns' })
  if (fields.raises.length) sections.push({ id: `${anchor}.errors`, label: 'Errors' })
  return sections
}

/** Group the existing semantic order without sorting or omitting members. */
export function apiMemberGroups(members: ApiSymbol[], signals: MemberSignals) {
  const groups = [
    { id: 'api-collections', label: 'Collections and queries', members: [] as ApiSymbol[] },
    { id: 'api-operations', label: 'Common operations', members: [] as ApiSymbol[] },
    { id: 'api-other-members', label: 'Other members', members: [] as ApiSymbol[] },
  ]
  for (const member of members) {
    const tier = memberTier(member, signals)
    const group = tier === 'listing' || tier === 'query' ? 0 : tier === 'concept' || tier === 'discussed' ? 1 : 2
    groups[group].members.push(member)
  }
  return groups.filter((group) => group.members.length > 0)
}

/** Related declarations come from ownership, inheritance and return types. */
export function relatedApiTypes(owner: ApiSymbol, members: ApiSymbol[], index: SymbolIndex, parent?: ApiSymbol) {
  const types = new Map<string, ApiSymbol>()
  const add = (symbol?: ApiSymbol) => {
    if (!symbol || symbol.id === owner.id || symbol.apiScope === 'internal' ||
        !['class', 'struct', 'interface', 'trait', 'enum', 'typealias'].includes(symbol.kind)) return
    types.set(symbol.publicId ?? symbol.id, symbol)
  }
  add(parent)
  for (const type of owner.extends ?? []) {
    for (const span of index.linkType(type, owner)) add(span.link?.symbol)
  }
  for (const symbol of [owner, ...members]) {
    for (const signature of symbol.signatures) {
      if (!signature.returns) continue
      for (const span of index.linkType(signature.returns, symbol)) add(span.link?.symbol)
    }
  }
  return [...types.values()].slice(0, 6)
}
