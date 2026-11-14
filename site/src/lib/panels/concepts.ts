/**
 * The cross-port concepts a panel is about, as the page sends them to the browser.
 *
 * A concept maps to every port's symbol, a note on how a port differs, or a
 * recorded reason the port has none. The rows come from `api-equivalents.ts`,
 * so the panel and the reference's own "In other ports" table agree.
 */

export interface ConceptRow {
  port: string
  /** The port's public id for the concept. */
  publicId: string
  qualifiedName: string
  href?: string
  kind?: string
  /** What differs from the concept's primary port, each chip a word a reader can search for. */
  chips: string[]
  note?: string
}

export interface ConceptRecord {
  id: string
  label: string
  /** The port the chips are relative to: Go when it has a symbol, else the first that does. */
  primary: string
  /** The primary symbol's doc summary, plain text. */
  summary?: string
  /** Mapped ports in the site's port order. */
  rows: ConceptRow[]
  /** Ports with a recorded reason, by port. */
  absent: Record<string, string>
  /** Ports the concept table says nothing about. */
  unmapped: string[]
}

export interface ConceptIndex {
  list: readonly ConceptRecord[]
  byId: ReadonlyMap<string, ConceptRecord>
  /** The port slugs in display order, with their names. */
  ports: readonly { slug: string; name: string; short: string }[]
}

export function conceptIndex(list: readonly ConceptRecord[], ports: ConceptIndex['ports']): ConceptIndex {
  return { list, byId: new Map(list.map((c) => [c.id, c])), ports }
}

export const symbolOf = (c: ConceptRecord, port: string): ConceptRow | undefined => c.rows.find((r) => r.port === port)
