import { describe, expect, it } from 'vitest'
import { ownTreeElsewhere, payloadGaps, servedByBuild } from '../scripts/check-page-readiness.mjs'
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
    const env = environment({ py: 'v0.46.2' })
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
    const env = environment({ py: 'v0.46.2' })
    const py = PORTS.find((port) => port.slug === 'py')!
    for (const href of [
      '/tmux/latest/reference/c-function-cmd-list-panes-c-cmd_list_panes_server/', '/tmux/3.2a/manual/list-panes/', '/tmux/latest/catalog/options/status-left/',
      `${referenceUrl(py, 'v0.46.2', 'mcp')}tool/`, `${referenceUrl(py, 'v0.46.2', 'workspace')}builder/`, '/py/v0.46.2/guides/attaching-to-tmux/',
    ]) expect(servedByBuild(href, build(env)), href).toBe(true)
    // The same pages under a root, as the dev server mounts them.
    expect(servedByBuild('/en/py/v0.46.2/reference/libtmux-server-panes/', { ...build(env), root: '/en' })).toBe(false)
    expect(servedByBuild('/en/cxx/latest/reference/libtmux-server-panes/', { ...build(env), root: '/en' })).toBe(true)
  })
})

describe('asking for payloads', () => {
  const request = (answers: Record<string, number>) => ({ get: async (url: string) => ({ ok: () => answers[url] === 200, status: () => answers[url] ?? 404 }) })

  it('reports a payload missing on a destination the build serves and names none it does not', async () => {
    const env = environment({ py: 'v0.46.2' })
    const served = (href: string) => servedByBuild(href, { ...build(env), root: '/en' })
    const asked = request({ 'http://x/en/cxx/latest/reference/a.preview.json': 200 })
    const hrefs = ['/en/cxx/latest/reference/a/', '/en/cxx/latest/reference/missing/', '/en/py/v0.46.2/reference/b/']
    expect(await payloadGaps(asked, 'http://x', hrefs, served)).toEqual({ missing: ['/en/cxx/latest/reference/missing/ answers 404'], skipped: ['/en/py/v0.46.2/reference/b/'] })
    // The control: asking for everything reports the destination the build does not contain too, which is the failure this check had.
    expect(await payloadGaps(asked, 'http://x', hrefs, undefined)).toEqual({ missing: ['/en/cxx/latest/reference/missing/ answers 404', '/en/py/v0.46.2/reference/b/ answers 404'], skipped: [] })
  })
})

describe('what the check leaves out', () => {
  it('is only a core reference of a port whose publisher owns its tree, at a version the build does not serve', () => {
    const env = environment({ py: 'v0.46.2' })
    const mounted = { ...build(env), root: '/en' }
    const links = ['/en/py/v0.46.2/reference/libtmux-server-panes/', '/en/cxx/latest/reference/libtmux-server-panes/', '/en/py/v0.46.2/mcp/reference/x/', '/en/tmux/latest/reference/c-function-x/', '/en/py/latest/reference/a/']
    // Every link the check leaves out is of that kind, and every one of that kind is left out: the two rules agree on these links.
    expect(links.filter((href) => !servedByBuild(href, mounted))).toEqual(['/en/py/v0.46.2/reference/libtmux-server-panes/'])
    expect(links.filter((href) => ownTreeElsewhere(href, mounted))).toEqual(['/en/py/v0.46.2/reference/libtmux-server-panes/'])
    expect(PORTS.filter((port) => !port.publishesOwnTree).map((port) => port.slug)).toEqual([])
  })

  it('does not call a port tree that its publisher does not own, or one of the version the build serves, one that is left out', () => {
    const env = environment({ py: 'v0.46.2' })
    const ports = PORTS.map((port) => (port.slug === 'py' ? { ...port, publishesOwnTree: false } : port))
    expect(ownTreeElsewhere('/py/v0.46.2/reference/a/', { ...build(env), ports })).toBe(false)
    expect(ownTreeElsewhere('/py/latest/reference/a/', build(env))).toBe(false)
    // A destination the check would leave out with no port tree behind it is the difference the check asserts on.
    expect(servedByBuild('/py/v0.46.2/reference/a/', { ...build(env), ports })).toBe(false)
  })
})
