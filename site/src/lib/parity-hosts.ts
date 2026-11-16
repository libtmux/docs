import type { Port } from './ports'

/** One row of the Parity page's "How each port is built" table. */
export interface BuildRow {
  slug: string
  name: string
  packageName: string
  /** Where the port's reference is drawn: always this site. */
  host: 'libtmux.org'
  /** The ecosystem host that also serves it, when there is one. */
  alsoHost?: { name: string; url: string }
  /** What draws the libtmux.org page: `astro`, `sphinx` or `native-skinned`. */
  renderer: string
  generator: string
}

/**
 * Every port's reference is rendered on libtmux.org from its API model; an
 * ecosystem host is an alternative, not the home (decided 2026-11-14). The
 * renderer names what draws the page, never "not applicable".
 */
export function buildRows(ports: readonly Port[]): BuildRow[] {
  return ports.map((port) => ({
    slug: port.slug,
    name: port.name,
    packageName: port.packageName,
    host: 'libtmux.org',
    alsoHost: port.ecosystemHost ? { name: port.ecosystemHost.name, url: port.ecosystemHost.url } : undefined,
    renderer: port.renderer,
    generator: port.generator || 'Not applicable',
  }))
}
