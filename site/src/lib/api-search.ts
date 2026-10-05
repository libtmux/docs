/** The same inventory feeds lazy navigation and scoped symbol search. */
export interface ApiTreeEntry {
  id: string
  name: string
  symbolName?: string
  qualifiedName?: string
  slug: string
  m: 0 | 1
  kind?: string
  category?: 'types' | 'members'
  summary?: string
}

export interface ApiTreeBucket {
  id: string
  label: string
  count: number
  slug: string | null
  types: ApiTreeEntry[]
  children: ApiTreeBucket[]
}

export interface ApiTreeJson {
  port: string
  buckets: ApiTreeBucket[]
  members: Record<string, [string, string, string?, string?, ('types' | 'members')?, string?, string?][]>
  relationships?: Record<string, { target: string; kind: 'type' | 'call' | 'reference'; sites?: { file: string; line: number }[] }[]>
}

export interface ApiSearchResult {
  id: string
  name: string
  symbolName: string
  qualifiedName: string
  slug: string
  kind: string
  category: 'types' | 'members'
  summary: string
}

const words = (value: string) => value
  .replace(/([a-z\d])([A-Z])/g, '$1 $2')
  .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
  .toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** Exact symbols lead; other matches retain the reference's semantic order. */
export function searchApi(json: ApiTreeJson, query: string, category = 'all'): ApiSearchResult[] {
  const records: ApiSearchResult[] = []
  const seen = new Set<string>()
  const append = (entry: ApiSearchResult) => {
    if (seen.has(entry.id)) return
    seen.add(entry.id)
    records.push(entry)
    for (const [name, slug, id, kind, category, summary, qualifiedName] of json.members[entry.id] ?? []) {
      append({ name, symbolName: name, slug, id: id ?? `${entry.id}.${name}`, kind: kind ?? 'member',
        category: category ?? 'members', summary: summary ?? '', qualifiedName: qualifiedName ?? id ?? `${entry.id}.${name}` })
    }
  }
  const visit = (buckets: ApiTreeBucket[]) => {
    for (const bucket of buckets) {
      for (const entry of bucket.types) append({ ...entry, symbolName: entry.symbolName ?? entry.name, kind: entry.kind ?? 'symbol',
        category: entry.category ?? 'types', summary: entry.summary ?? '', qualifiedName: entry.qualifiedName ?? entry.id })
      visit(bucket.children)
    }
  }
  visit(json.buckets)
  const terms = words(query)
  const phrase = terms.join(' ')
  const literal = query.trim().toLowerCase()
  const symbolic = /[.:/]/.test(query)
  const rank = (entry: ApiSearchResult) => {
    if (entry.symbolName === query.trim() || entry.qualifiedName === query.trim() || entry.id === query.trim()) return -1
    if (entry.symbolName.toLowerCase() === literal || entry.qualifiedName.toLowerCase() === literal || entry.id.toLowerCase() === literal) return 0
    if (phrase && words(entry.symbolName).join(' ') === phrase) return 1
    const identity = words(entry.qualifiedName).join(' ')
    if (terms.length > 1 && (identity === phrase || identity.endsWith(` ${phrase}`))) return 2
    return 3
  }
  return records.filter((entry) => {
    if (category !== 'all' && category !== entry.category) return false
    if (literal && !terms.length) return `${entry.symbolName} ${entry.qualifiedName} ${entry.id}`.toLowerCase().includes(literal)
    const tokens = words(`${entry.qualifiedName} ${entry.id} ${entry.name} ${entry.symbolName} ${symbolic ? '' : entry.summary}`)
    const identity = words(entry.qualifiedName).join('')
    return terms.every((term) => tokens.some((token) => token.startsWith(term)) || identity.includes(term))
  }).sort((left, right) => rank(left) - rank(right))
}
