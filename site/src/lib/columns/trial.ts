/**
 * Where the columns view is offered. The Go reference first: a trial, so the
 * view is listed by port and every other reference stays tree-only.
 */
export const API_COLUMNS_PORTS: readonly string[] = ['go']

export const apiColumnsOffered = (port: string | undefined): boolean => Boolean(port && API_COLUMNS_PORTS.includes(port))

/** The reference's own routes for the trial pages, below the port's reference root. */
export const TRIAL_PAGES = [
  { slug: 'columns', label: 'All variants' },
  { slug: 'panels', label: 'Panels' },
] as const
