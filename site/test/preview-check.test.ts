import { describe, expect, it } from 'vitest'
import { payloadGaps, servedByBuild } from '../scripts/check-page-readiness.mjs'
import { PORTS, referenceSegment, referenceUrl } from '../src/lib/ports'
import { buildTarget, linkedVersionFor } from '../src/lib/versions'

/**
 * The browser check of preview cards asks each marked link's payload from the build it runs against. The build serves one
 * version of each port's reference, so a link to another version names a tree it does not contain, and the check must
 * leave that out and still ask for everything the build does serve.
 */
const environment = (defaults: Record<string, string>) => ({ LIBTMUX_DOCS_VERSION: 'latest', LIBTMUX_DOCS_PORT_DEFAULTS: JSON.stringify(defaults) })
const build = (env: Record<string, string>) => ({ root: '', ports: PORTS, version: buildTarget(env).version, segment: referenceSegment('core') })
/** Where the site sends a link to a port's core reference, at the version the assembly's defaults give it. */
const linked = (env: Record<string, string>) => PORTS.map((port) => ({ port, href: `${referenceUrl(port, linkedVersionFor(port.slug, env))}some-declaration/` }))

describe('which destinations the build under test serves', () => {
  it('leaves out a port whose reference the links name at another version, and asks for every other port', () => {
    const env = environment({ py: 'stable' })
    const unserved = linked(env).filter(({ href }) => !servedByBuild(href, build(env))).map(({ port }) => port.slug)
    expect(unserved).toEqual(['py'])
    // The links of the other ports name the version the build serves.
    expect(linked(env).filter(({ port }) => port.slug !== 'py').every(({ href }) => servedByBuild(href, build(env)))).toBe(true)
  })

  it('follows the site: another default moves which port is left out, and none is named in the check', () => {
    const env = environment({ ts: 'v1.2', go: 'latest' })
    expect(linked(env).filter(({ href }) => !servedByBuild(href, build(env))).map(({ port }) => port.slug)).toEqual(['ts'])
    expect(linked(environment({})).filter(({ href }) => !servedByBuild(href, build(environment({})))).map(({ port }) => port.slug)).toEqual([])
  })

  it('serves what is not a port reference at whatever version a link names', () => {
    const env = environment({ py: 'stable' })
    const py = PORTS.find((port) => port.slug === 'py')!
    for (const href of [
      '/tmux/latest/reference/c-function-cmd-list-panes-c-cmd_list_panes_server/', '/tmux/3.2a/manual/list-panes/', '/tmux/latest/catalog/options/status-left/',
      `${referenceUrl(py, 'stable', 'mcp')}tool/`, `${referenceUrl(py, 'stable', 'workspace')}builder/`, '/py/stable/guides/attaching-to-tmux/',
    ]) expect(servedByBuild(href, build(env)), href).toBe(true)
    // The same pages under a root, as the dev server mounts them.
    expect(servedByBuild('/en/py/stable/reference/libtmux-server-panes/', { ...build(env), root: '/en' })).toBe(false)
    expect(servedByBuild('/en/cxx/latest/reference/libtmux-server-panes/', { ...build(env), root: '/en' })).toBe(true)
  })
})

describe('asking for payloads', () => {
  const request = (answers: Record<string, number>) => ({ get: async (url: string) => ({ ok: () => answers[url] === 200, status: () => answers[url] ?? 404 }) })

  it('reports a payload missing on a destination the build serves and names none it does not', async () => {
    const env = environment({ py: 'stable' })
    const served = (href: string) => servedByBuild(href, { ...build(env), root: '/en' })
    const asked = request({ 'http://x/en/cxx/latest/reference/a.preview.json': 200 })
    const hrefs = ['/en/cxx/latest/reference/a/', '/en/cxx/latest/reference/missing/', '/en/py/stable/reference/b/']
    expect(await payloadGaps(asked, 'http://x', hrefs, served)).toEqual({ missing: ['/en/cxx/latest/reference/missing/ answers 404'], skipped: ['/en/py/stable/reference/b/'] })
    // The control: asking for everything reports the destination the build does not contain too, which is the failure this check had.
    expect(await payloadGaps(asked, 'http://x', hrefs, undefined)).toEqual({ missing: ['/en/cxx/latest/reference/missing/ answers 404', '/en/py/stable/reference/b/ answers 404'], skipped: [] })
  })
})
