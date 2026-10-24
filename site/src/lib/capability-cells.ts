/** Cell and row shapes for the capability matrix, kept free of data imports. */
import type { CapabilityCommand, CellState } from '@libtmux/api-model'

export interface Column {
  key: string
  label: string
  title: string
}

export interface Cell {
  state: CellState | 'absent'
  /** Short text shown with the icon, such as the release a port needs. */
  text?: string
}

export interface ApiLink {
  label: string
  href?: string
}

export interface Row {
  id: string
  label: string
  /** Where the row's name links; its anchor on this page when unset. */
  href?: string
  summary: string
  cells: Cell[]
  apis: ApiLink[]
  error?: ApiLink
  commands: CapabilityCommand[]
  /** Releases in words: "3.7 and later", "3.3a and later, not 3.4". */
  requirement: string
}

export const CELL_LABEL: Record<Cell['state'], string> = {
  supported: 'Works',
  workaround: 'Works with a workaround',
  repaired: 'Repaired after the command',
  fallback: 'Uses another path',
  refused: 'Refused with an error',
  absent: 'No entry in this port',
}

/** The releases an entry covers. */
export interface Needs {
  since?: string
  except?: string[]
  releases?: string[]
}

/** Releases in words: "3.7 and later", "3.3a and later, not 3.4", "Applies to 3.7". */
export function requirement(entry: Needs): string {
  if (entry.releases) return `Applies to ${entry.releases.join(', ')}`
  const except = entry.except?.length ? `, not ${entry.except.join(', ')}` : ''
  return `${entry.since} and later${except}`
}

/**
 * What one capability needs across ports. Ports can gate it at different
 * releases, so a single port's words would misstate the others: the phrase
 * stands alone when every port agrees, and names the ports otherwise.
 */
export function requirementAcross(entries: [port: string, entry: Needs][], name: (port: string) => string): string {
  const groups = new Map<string, string[]>()
  for (const [port, entry] of entries) {
    const text = requirement(entry)
    groups.set(text, [...(groups.get(text) ?? []), name(port)])
  }
  if (groups.size === 1) return [...groups.keys()][0]
  return [...groups].map(([text, names]) => `${text} (${names.join(', ')})`).join('; ')
}
