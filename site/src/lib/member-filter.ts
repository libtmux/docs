/**
 * The rules of a member collection's search and group chips (MemberCollection, record 0056).
 *
 * A row matches when every word of the query is in its name or its summary. The
 * chips count what the search leaves, so a group with no match reads zero and is
 * disabled. `ApiMemberList.astro` binds these to the page; they hold no DOM.
 */

/** A row as the filter sees it: its group and kind, and the text a query searches. */
export interface MemberRow {
  group: string
  kind: string
  text: string
}

/** The lower-case words of a query; none for a blank one. */
export const queryWords = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean)

/** Every word is somewhere in `text`, ignoring case. No words match everything. */
export const matchesQuery = (text: string, words: readonly string[]): boolean => {
  const haystack = text.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** Where the words occur in `text`, as sorted [start, end) pairs; matches that touch or overlap join. */
export function highlightRanges(text: string, words: readonly string[]): [number, number][] {
  const haystack = text.toLowerCase()
  const found: [number, number][] = []
  for (const word of words) {
    for (let at = haystack.indexOf(word); at !== -1; at = haystack.indexOf(word, at + word.length)) found.push([at, at + word.length])
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const joined: [number, number][] = []
  for (const range of found) {
    const last = joined.at(-1)
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else joined.push([...range])
  }
  return joined
}

/**
 * What each chip counts. The group chips count the rows the search and the kind chip leave; the kind chips count
 * the rows the search and the group chip leave. An empty `group` or `kind` is the All chip.
 */
export function tally(rows: readonly MemberRow[], words: readonly string[], group: string, kind: string) {
  const found = rows.filter((row) => matchesQuery(row.text, words))
  const count = (list: readonly MemberRow[], key: 'group' | 'kind') => {
    const counts: Record<string, number> = {}
    for (const row of rows) counts[row[key]] ??= 0
    for (const row of list) counts[row[key]]! += 1
    return counts
  }
  const byKind = found.filter((row) => !kind || row.kind === kind)
  const byGroup = found.filter((row) => !group || row.group === group)
  return { all: found.length, groups: count(byKind, 'group'), kinds: count(byGroup, 'kind') }
}

/** "175 members", or "12 of 175 members" while anything narrows the list. */
export const countLabel = (shown: number, total: number, noun: string): string =>
  shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`
