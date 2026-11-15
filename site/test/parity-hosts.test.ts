import { describe, expect, it, vi } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { buildRows } from '../src/lib/parity-hosts'
import { PORTS } from '../src/lib/ports'

vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))

/**
 * The Parity page's "How each port is built" table: every port's reference is
 * drawn on libtmux.org from its API model, an ecosystem host is an alternative,
 * and the renderer names what draws the page (decided 2026-11-14).
 */
describe('parity build rows', () => {
  const rows = buildRows(PORTS)

  it('lists every port with libtmux.org as its reference host', () => {
    expect(rows.map((row) => row.slug)).toEqual(PORTS.map((port) => port.slug))
    expect(new Set(rows.map((row) => row.host))).toEqual(new Set(['libtmux.org']))
  })

  it('names the ecosystem host as an alternative for the six ports that have one', () => {
    const withAlternative = rows.filter((row) => row.alsoHost).map((row) => [row.slug, row.alsoHost?.name])
    expect(Object.fromEntries(withAlternative)).toMatchObject({
      rs: 'docs.rs', go: 'pkg.go.dev', java: 'javadoc.io', kotlin: 'Dokka', scala: 'Scaladoc',
    })
    expect(withAlternative.length).toBeGreaterThanOrEqual(6)
    // A port with no ecosystem host has no alternative to name.
    expect(rows.find((row) => row.slug === 'py')?.alsoHost).toBeUndefined()
  })

  it('names a renderer for every port and never says none or not applicable', () => {
    for (const row of rows) expect(['astro', 'sphinx', 'native-skinned'], row.slug).toContain(row.renderer)
    expect(rows.find((row) => row.slug === 'go')?.renderer).toBe('astro')
    expect(rows.find((row) => row.slug === 'rs')?.renderer).toBe('astro')
    expect(rows.find((row) => row.slug === 'py')?.renderer).toBe('sphinx')
  })
})

describe('the rendered Parity page', () => {
  it('draws the reference host and renderer cells from those rows', async () => {
    const page = await loadAstroTemplate('pages/meta/parity.astro')
    const html = await renderAstroTemplate(page, {})
    const hosts = [...html.matchAll(/<td data-reference-host[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    const renderers = [...html.matchAll(/<td data-renderer[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!.trim())
    expect(hosts).toHaveLength(PORTS.length)
    expect(hosts.every((host) => host.startsWith('libtmux.org'))).toBe(true)
    expect(hosts.some((host) => host.startsWith('libtmux.org, also pkg.go.dev'))).toBe(true)
    expect(renderers).toHaveLength(PORTS.length)
    expect(renderers).not.toContain('none')
    expect(html).not.toContain('Not applicable</td>\n                <td>Not applicable')
    // Wide tables scroll in a labelled, focusable region.
    expect(html).toMatch(/class="meta-scroll" tabindex="0" role="region" aria-label="How each port is built, scrollable"/)
  })
})
