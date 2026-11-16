/**
 * The concept records the panel workspace reads, built on the server from the
 * concept table and `equivalentsFor`, so a panel and the reference's "In other
 * ports" table cannot disagree.
 */
import { CONCEPTS } from '@libtmux/api-model/reference'
import { API_MODELS } from '../api-models'
import { equivalentsFor } from '../api-equivalents'
import { plainSummary } from '../columns/api-hierarchy'
import { PORTS } from '../ports'
import { conceptIndex, type ConceptIndex, type ConceptRecord } from './concepts'

/** Notes carry markdown links and code spans; a panel shows them as text. */
const plainNote = (note: string) => note.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`([^`]+)`/g, '$1')

export function buildConceptRecords(): ConceptRecord[] {
  const order = PORTS.map((port) => port.slug)
  const records: ConceptRecord[] = []
  for (const [id, concept] of Object.entries(CONCEPTS)) {
    const mapped = order.filter((port) => concept.symbols[port])
    if (!mapped.length) continue
    const primary = mapped.includes('go') ? 'go' : mapped[0]!
    const publicId = concept.symbols[primary]!
    const symbol = API_MODELS[primary]?.symbols.find((s) => (s.publicId ?? s.id) === publicId)
    const group = symbol ? equivalentsFor(primary, symbol).find((g) => g.label === concept.label) : undefined
    const rows = mapped.map((port) => {
      const row = group?.rows.find((r) => r.port === port)
      return {
        port, publicId: concept.symbols[port]!, qualifiedName: row?.qualifiedName ?? concept.symbols[port]!,
        ...(row?.href ? { href: row.href } : {}), ...(row?.kind ? { kind: row.kind } : {}),
        chips: row?.chips ?? [], ...(concept.notes?.[port] ? { note: plainNote(concept.notes[port]!) } : {}),
      }
    })
    const absent = Object.fromEntries(group?.absent.map((r) => [r.port, r.reason!]) ?? [])
    const summary = plainSummary(group?.rows[0]?.summary)
    records.push({
      id, label: concept.label, primary, ...(summary ? { summary } : {}), rows, absent,
      unmapped: order.filter((port) => !mapped.includes(port) && !(port in absent)),
    })
  }
  return records
}

export function workspaceConcepts(): ConceptIndex {
  return conceptIndex(buildConceptRecords(), PORTS.map((port) => ({ slug: port.slug, name: port.name, short: port.shortName })))
}
