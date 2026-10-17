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

