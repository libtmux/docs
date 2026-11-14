/**
 * The symbol index: every public symbol by name, a letter at a time.
 *
 * Pure grouping and ordering, shared by the cross-port index at
 * `/reference/symbols/<letter>/` and each port's own A-Z view under its
 * reference. The page files render; this decides what goes where.
 */

export interface IndexEntry {
  port: string
  /** The bare name a reader types: `capture`, not `libtmux.Pane.capture`. */
  name: string
  /** The qualified id, shown on its own line when it says more than the name. */
  id: string
  kind: string
  /** The owning type, when the symbol is a member. */
  owner?: string
  /** One line of the doc comment, if the source has one. */
  summary?: string
  href?: string
}

/** The strip's key for names that do not start with a letter. */
export const OTHER_LETTER = '0'

/** The letter a name files under: its first letter or digit, skipping `_`, `~` and other marks. */
export function letterOf(name: string): string {
  const first = name.replace(/^[^A-Za-z0-9]+/, '').charAt(0).toUpperCase()
  return /[A-Z]/.test(first) ? first : OTHER_LETTER
}

/** What the strip shows for a key. */
export const letterLabel = (letter: string) => (letter === OTHER_LETTER ? '#' : letter)

/** `_clauses`, `__call__` and `~CommandExecutor`: filed under their letter, after the public names. */
export const isSpecialName = (name: string) => /^[_~]/.test(name)

/**
 * Public names first, alphabetical by bare name then port; special names
 * follow in the same order. Case is ignored, so `capture` and `Capture` sit
 * together.
 */
export function sortEntries<T extends Pick<IndexEntry, 'name' | 'port'>>(entries: readonly T[]): T[] {
  const compare = (a: T, b: T) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name) || a.port.localeCompare(b.port)
  const special = (entry: T) => (isSpecialName(entry.name) ? 1 : 0)
  return [...entries].sort((a, b) => special(a) - special(b) || compare(a, b))
}

export interface LetterGroup<T> {
  letter: string
  entries: T[]
}

/** Entries by letter, in strip order (`#` last), each sorted. */
export function groupByLetter<T extends Pick<IndexEntry, 'name' | 'port'>>(entries: readonly T[]): LetterGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const entry of entries) {
    const letter = letterOf(entry.name)
    groups.set(letter, [...(groups.get(letter) ?? []), entry])
  }
  const last = (letter: string) => (letter === OTHER_LETTER ? 1 : 0)
  return [...groups.entries()]
    .sort(([a], [b]) => last(a) - last(b) || a.localeCompare(b))
    .map(([letter, list]) => ({ letter, entries: sortEntries(list) }))
}

/** A row of the list: one symbol, or one name that many owners declare. */
export type IndexRow<T extends IndexEntry = IndexEntry> =
  | { type: 'symbol'; entry: T }
  | { type: 'group'; name: string; entries: T[] }

/**
 * Names declared by `min` or more owners fold into one expandable row with an
 * owner count: Go declares `String` on 50 types, and fifty rows of the same
 * word bury what is next to it. Order is kept; the group sits where its first
 * member would.
 */
export function groupRepeats<T extends IndexEntry>(entries: readonly T[], min = 3): IndexRow<T>[] {
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1)
  const rows: IndexRow<T>[] = []
  const groups = new Map<string, Extract<IndexRow<T>, { type: 'group' }>>()
  for (const entry of entries) {
    if ((counts.get(entry.name) ?? 0) < min) {
      rows.push({ type: 'symbol', entry })
      continue
    }
    const existing = groups.get(entry.name)
    if (existing) existing.entries.push(entry)
    else {
      const group = { type: 'group' as const, name: entry.name, entries: [entry] }
      groups.set(entry.name, group)
      rows.push(group)
    }
  }
  return rows
}

/** "24 owners". */
export const ownerCount = (n: number) => `${n} owner${n === 1 ? '' : 's'}`

/** Kinds present in a list, with their counts, most common first. */
export function kindCounts(entries: readonly Pick<IndexEntry, 'kind'>[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** The status line: "176 symbols" or "12 of 176 symbols". */
export const countStatus = (shown: number, total: number) =>
  shown === total ? `${total} symbol${total === 1 ? '' : 's'}` : `${shown} of ${total} symbols`

/** The letter an index's front link opens: the first of A-Z that has names, else `#`. */
export function firstLetter(names: readonly string[]): string {
  const letters = new Set(names.map(letterOf))
  return [...letters].filter((letter) => letter !== OTHER_LETTER).sort()[0] ?? OTHER_LETTER
}

/** One line of a doc comment for a row: markup dropped, at most 160 characters; empty when the source has none. */
export function summaryLine(summary: string | undefined): string | undefined {
  const text = (summary ?? '').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}...` : text
}
