import { memberTier, type ApiSymbol, type MemberSignals, type Signature, type SymbolIndex } from '@libtmux/api-model'

export interface ApiSection {
  id: string
  label: string
  nested?: boolean
  count?: number
}

/** The fields shown by ApiEntry, shared with its section navigation. */
export function apiEntryFields(symbol: ApiSymbol, port?: string) {
  const native = ['kotlin', 'scala', 'fsharp', 'c'].includes(port ?? '')
  const name = port === 'swift' ? symbol.name.replace(/\([^)]*\)$/, '') : symbol.name
  const labels = symbol.signatures.map(
    (signature) => `${name}(${signature.params.map((param) => param.name).join(', ')})`,
  )
  const label = (i: number) =>
    labels.filter((entry) => entry === labels[i]).length > 1 ? `${labels[i]} [overload ${i + 1}]` : labels[i]
  // Python's extractor merges @overload stubs followed by their implementation.
  // The implementation docstring documents the complete callable, not one stub.
  const familyDocumentation =
    port === 'py' && !symbol.modifiers.includes('overload') ? symbol.signatures.length - 1 : -1
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
      overloads:
        signatures.size < symbol.signatures.length && !signatures.has(familyDocumentation)
          ? [...signatures].map(label)
          : [],
    }))
  }
  return {
    params: collect((signature) => signature.params.filter((param) => native || param.doc)),
    returns: collect((signature) => (signature.returnsDoc ? [{ doc: signature.returnsDoc }] : [])),
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
    { id: 'api-parent-objects', label: 'Parent objects', members: [] as ApiSymbol[] },
    { id: 'api-collections', label: 'Collections and queries', members: [] as ApiSymbol[] },
    { id: 'api-operations', label: 'Common operations', members: [] as ApiSymbol[] },
    { id: 'api-other-members', label: 'Other members', members: [] as ApiSymbol[] },
  ]
  for (const member of members) {
    const tier = memberTier(member, signals)
    const group =
      tier === 'parent'
        ? 0
        : tier === 'listing' || tier === 'query'
          ? 1
          : tier === 'concept' || tier === 'discussed'
            ? 2
            : 3
    groups[group].members.push(member)
  }
  return groups.filter((group) => group.members.length > 0)
}

/** Related declarations come from ownership, inheritance and return types. */
export function relatedApiTypes(
  owner: ApiSymbol,
  members: ApiSymbol[],
  index: SymbolIndex,
  parent?: ApiSymbol,
  options: { includeInternal?: boolean } = {},
) {
  const types = new Map<string, ApiSymbol>()
  const add = (symbol?: ApiSymbol) => {
    if (
      !symbol ||
      symbol.id === owner.id ||
      (!options.includeInternal && symbol.apiScope === 'internal') ||
      !['class', 'struct', 'union', 'interface', 'trait', 'enum', 'typealias'].includes(symbol.kind)
    )
      return
    types.set(symbol.publicId ?? symbol.id, symbol)
  }
  add(parent)
  for (const type of owner.extends ?? []) {
    for (const span of index.linkType(type, owner)) add(span.link?.symbol)
  }
  for (const symbol of [owner, ...members]) {
    if (options.includeInternal && symbol.type) {
      for (const span of index.linkType(symbol.type, symbol)) add(span.link?.symbol)
    }
    for (const signature of symbol.signatures) {
      for (const type of [
        signature.returns,
        ...(options.includeInternal ? signature.params.map((param) => param.type) : []),
      ]) {
        if (type) for (const span of index.linkType(type, symbol)) add(span.link?.symbol)
      }
    }
  }
  return [...types.values()].slice(0, 6)
}

/** Describe unnamed native types without inventing a compilable declaration. */
export function anonymousDeclarationLabel(symbol: ApiSymbol): string {
  return symbol.type ? `${symbol.name}: ${symbol.type}` : `Anonymous ${symbol.kind}`
}
