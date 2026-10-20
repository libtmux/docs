import { describe, expect, it } from 'vitest'
import evidence from '../src/data/destination-evidence.json'
import { SECTION_LABEL, headerSections, matchesSearch, portHeaderLinks, type HeaderRow } from '../src/lib/header-links'
import { API_HOSTS, INVENTORY, PACKAGE_HOSTS, type InventoryEntry } from '../src/lib/port-inventory'
import { PORTS, PORT_BY_SLUG, portDestinations } from '../src/lib/ports'
import { LINKS } from './fixtures/header-links'

const links = (slug: string) => portHeaderLinks(PORT_BY_SLUG[slug]!)
const passing = new Set(evidence.destinations.filter((record) => record.ok).map((record) => record.url))
/** The rows a query finds, by label and kind, as the picker's script would leave them visible. */
const found = (slug: string, query: string) => links(slug).rows.filter((row) => matchesSearch(row, query)).map((row) => `${row.kind}:${row.label}`)

describe('header links', () => {
  it('has an expectation for every registered port', () => {
    expect(Object.keys(LINKS).sort()).toEqual(PORTS.map(({ slug }) => slug).sort())
  })

  it.each(Object.entries(LINKS))('offers %s the verified actions and index rows', (slug, expected) => {
    const actual = links(slug)
    expect(actual.actions.map((action) => [action.kind, action.label, action.name, action.url]), `${slug} actions`).toEqual(expected.actions.map((action) => [...action]))
    expect(actual.rows.map((row) => [row.kind, row.label, row.detail, row.url]), `${slug} rows`).toEqual(expected.rows.map((row) => [...row]))
    expect(actual.indexed, `${slug} lists a destination no direct link opens`).toBe(expected.indexed)
  })

  it.each(PORTS.map(({ slug }) => slug))('keeps %s repository first, then its package host, then its reference', (slug) => {
    const port = PORT_BY_SLUG[slug]!
    const { actions } = links(slug)
    expect(actions.map((action) => action.kind)).toEqual(['source', ...(actions.some((action) => action.kind === 'package') ? ['package'] : []),
      ...(actions.some((action) => action.kind === 'api') ? ['api'] : [])])
    // The same destinations the homepage's links row names.
    const { source, registry } = portDestinations({ port })
    expect(actions[0]!.url).toBe(source.url)
    expect(actions.find((action) => action.kind === 'package')?.url).toBe(registry?.url)
    expect(new Set(actions.map((action) => action.url)).size, 'no two actions open one URL').toBe(actions.length)
    // Each direct link is also in the index, so a search finds what a click already reaches.
    for (const action of actions) expect(links(slug).rows.map((row) => row.url), `${slug} ${action.label}`).toContain(action.url)
  })

  it('shows Julia and C++ only their repository, because neither names a package host or reference', () => {
    for (const slug of ['julia', 'cxx']) {
      expect(links(slug).actions.map((action) => action.kind), slug).toEqual(['source'])
      expect(links(slug).rows.map((row) => row.kind), slug).toEqual(Array(links(slug).rows.length).fill('source'))
    }
  })

  it('opens Go’s package page once, because pkg.go.dev serves the package and its reference', () => {
    const go = links('go')
    expect(go.actions.map((action) => action.kind)).toEqual(['source', 'package'])
    expect(go.rows.filter((row) => row.kind === 'api')).toEqual([])
    const tmux = go.rows.find((row) => row.url === 'https://pkg.go.dev/github.com/libtmux/libtmux-go/tmux')!
    expect(tmux.kind).toBe('package')
    // The merged row still answers a search for the reference.
    expect(matchesSearch(tmux, 'api reference')).toBe(true)
  })

  it('names one row for each URL and keeps every entry’s identity in its search text', () => {
    for (const port of PORTS) {
      const urls = links(port.slug).rows.map((row) => row.url)
      expect(new Set(urls).size, port.slug).toBe(urls.length)
    }
    // A Swift product has no page apart from its package; each is found by its own name.
    const swift = links('swift').rows.find((row) => row.url === 'https://swiftpackageindex.com/libtmux/libtmux-swift')!
    expect(swift.entries).toEqual(['libtmux-swift', 'LibTmux', 'TmuxFixture', 'LibTmuxMCP', 'libtmux-mcp', 'TmuxWorkspace', 'tmux-workspace'])
    for (const name of ['LibTmux', 'TmuxFixture', 'LibTmuxMCP', 'TmuxWorkspace', 'import TmuxWorkspace', 'TmuxWorkspaceCLI']) expect(matchesSearch(swift, name), name).toBe(true)
    // Python’s pytest plugin ships in the libtmux distribution.
    expect(found('py', 'libtmux.pytest_plugin')).toEqual(['source:libtmux', 'package:libtmux'])
    // A TypeScript subpath export is the library’s page, not a package of its own.
    expect(found('ts', 'libtmux/testing')).toEqual(['source:libtmux', 'package:libtmux'])
    // Julia’s embedded module opens the directory that holds the core package.
    expect(found('julia', 'LibTmux.Filters')).toEqual(['source:LibTmux'])
  })

  it('searches labels, coordinates, import aliases, hosts and repository names', () => {
    expect(found('py', 'tmuxp')).toEqual(['source:tmuxp', 'package:tmuxp'])
    expect(found('java', 'io.github.libtmux:libtmux-mcp')).toEqual(['source:libtmux-mcp', 'package:libtmux-mcp', 'api:libtmux-mcp'])
    expect(found('ruby', 'libtmux/async')).toEqual(['source:libtmux-async', 'package:libtmux-async'])
    expect(found('ts', '@libtmux/workspace/config')).toEqual(['source:@libtmux/workspace', 'package:@libtmux/workspace'])
    expect(found('ts', 'tmux-workspace')).toEqual(['source:@libtmux/workspace-cli', 'package:@libtmux/workspace-cli'])
    expect(found('rs', 'libtmux_macros')).toEqual(['source:libtmux-macros', 'package:libtmux-macros', 'api:libtmux-macros'])
    // A repository name finds everything built from that repository.
    expect(found('rs', 'libtmux-rs')).toHaveLength(links('rs').rows.length)
    expect(found('py', 'tmux-python/libtmux-mcp')).toEqual(['source:libtmux-mcp', 'package:libtmux-mcp'])
    // A host, a kind of destination and a product narrow the list; every word must match.
    expect(found('rs', 'docs.rs')).toEqual(['api:libtmux', 'api:libtmux-macros', 'api:tmux-mcp', 'api:tmux-workspace'])
    expect(found('rs', 'crates mcp')).toEqual(['source:tmux-mcp', 'package:tmux-mcp'])
    expect(found('rs', 'mcp server github')).toEqual(['source:tmux-mcp'])
    expect(found('go', 'workspace cmd')).toEqual(['source:tmux-workspace', 'package:tmux-workspace'])
    // Words match inside names, so a reader need not know the exact spelling.
    expect(found('csharp', 'dependency injection')).toEqual(['source:LibTmux.Extensions.DependencyInjection', 'package:LibTmux.Extensions.DependencyInjection'])
    expect(found('cxx', 'COMPONENTS testing')).toEqual(['source:libtmux::testing'])
    expect(found('cxx', 'vcpkg')).toEqual(['source:vcpkg port', 'source:libtmux-mcp-server'])
    // Control: a word nothing carries finds nothing, and an empty query leaves every row.
    expect(found('rs', 'no such destination')).toEqual([])
    expect(found('rs', '   ')).toHaveLength(links('rs').rows.length)
  })

  it('leaves out an entry that is not published, and links it the moment it is', () => {
    const lua = (status: InventoryEntry['status'], withPackage: boolean) => {
      const entries = INVENTORY.lua!.map((entry) => (entry.id !== 'libtmux-mcp' ? entry : {
        ...entry, status, ...(withPackage && { package: { host: 'luarocks' as const, url: 'https://luarocks.org/modules/tony/libtmux-mcp' } }),
      }))
      return portHeaderLinks(PORT_BY_SLUG.lua!, { ...INVENTORY, lua: entries })
    }
    const urls = (result: ReturnType<typeof portHeaderLinks>) => result.rows.map((row) => row.url)
    // Planned, and configured but not yet on the host: no link, not even to its directory.
    expect(urls(lua('planned', false))).toEqual(urls(links('lua')))
    expect(urls(lua('configured-unpublished', true))).toEqual(urls(links('lua')))
    expect(urls(links('lua')).join(' ')).not.toMatch(/libtmux-mcp|libtmux-workspace/)
    // Control: the same entry, published, adds its package page and a disclosure.
    const published = lua('published', true)
    expect(urls(published)).toContain('https://luarocks.org/modules/tony/libtmux-mcp')
    expect(published.indexed).toBe(true)
    expect(links('lua').indexed).toBe(false)
    // Nothing the inventory excludes reaches any port’s header.
    for (const port of PORTS) {
      const excluded = INVENTORY[port.slug]!.filter((entry) => entry.status !== 'published')
      for (const entry of excluded) expect(links(port.slug).rows.flatMap((row) => row.entries), `${port.slug} ${entry.id}`).not.toContain(entry.id)
    }
  })

  it('links only to https pages on the hosts the inventory names, without version, locale or preview prefix', () => {
    const hosts = new Set(['github.com', ...Object.values(PACKAGE_HOSTS).map((host) => host.hostname), ...Object.values(API_HOSTS).map((host) => host.hostname)])
    for (const port of PORTS) {
      const { actions, rows } = links(port.slug)
      for (const { url } of [...actions, ...rows]) {
        const parsed = new URL(url)
        expect(parsed.protocol, url).toBe('https:')
        expect(hosts.has(parsed.hostname), url).toBe(true)
        expect(parsed.search + parsed.hash, url).toBe('')
        expect(parsed.pathname, url).not.toMatch(/^\/(?:pr-\d+\/)?(?:en|ja)\/|\/(?:latest|stable)(?:\/|$)/)
      }
    }
  })

  it('holds every linked URL to a passing verification record', () => {
    for (const port of PORTS) {
      for (const { url } of [...links(port.slug).actions, ...links(port.slug).rows]) expect(passing.has(url), `${port.slug} ${url}`).toBe(true)
    }
  })

  it('gives each row a label and one short line, and each action a name that begins with its label', () => {
    for (const port of PORTS) {
      const { actions, rows } = links(port.slug)
      for (const row of rows) {
        expect(row.label.trim(), row.url).not.toBe('')
        expect(row.detail.trim(), row.url).not.toBe('')
        expect(row.detail.length, `${port.slug} ${row.label}`).toBeLessThanOrEqual(60)
        expect(row.detail, row.url).not.toMatch(/\n/)
      }
      for (const action of actions) expect(action.name.startsWith(action.label), action.name).toBe(true)
    }
  })

  it('groups rows under source, packages and API reference in that order, with a section only for a kind that has rows', () => {
    const rows = (kinds: HeaderRow['kind'][]) => kinds.map((kind) => ({ kind, match: '' }) as HeaderRow)
    expect(headerSections(rows(['source', 'package', 'api', 'package', 'source'])).map((section) => [section.kind, section.label, section.rows.length]))
      .toEqual([['source', SECTION_LABEL.source, 2], ['package', SECTION_LABEL.package, 2], ['api', SECTION_LABEL.api, 1]])
    expect(headerSections(rows(['source'])).map((section) => section.kind)).toEqual(['source'])
    expect(headerSections([])).toEqual([])
    expect(headerSections(links('rs').rows).map((section) => section.kind)).toEqual(['source', 'package', 'api'])
    expect(headerSections(links('cxx').rows).map((section) => section.kind)).toEqual(['source'])
    expect(headerSections(links('py').rows).map((section) => section.kind)).toEqual(['source', 'package'])
    // Within a kind the library comes first and products follow in order.
    const products = links('java').rows.filter((row) => row.kind === 'package').map((row) => row.label)
    expect(products[0]).toBe('libtmux')
    expect(products.slice(-2)).toEqual(['libtmux-workspace', 'libtmux-workspace-cli'])
  })
})
