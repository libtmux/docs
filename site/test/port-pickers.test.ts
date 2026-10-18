import { describe, expect, it } from 'vitest'
import { PICKER_GROUPS, PORTS, PORT_BY_SLUG, portPickers, type Port, type PortPicker } from '../src/lib/ports'
import { PICKERS } from './fixtures/port-pickers'

const picker = (port: Port, kind: PortPicker['kind']) => portPickers(port).find((entry) => entry.kind === kind)
const tuples = (port: Port, kind: PortPicker['kind']) => picker(port, kind)?.rows.map((row) => [row.group, row.label, row.detail, row.url])
const withHosts = (overrides: Partial<Port>): Port => ({ ...PORT_BY_SLUG.rs!, ...overrides })

describe('port pickers', () => {
  it('has an expectation for every registered port', () => {
    expect(Object.keys(PICKERS).sort()).toEqual(PORTS.map(({ slug }) => slug).sort())
  })

  it.each(Object.entries(PICKERS))('lists the verified rows for %s', (slug, expected) => {
    const port = PORT_BY_SLUG[slug]!
    for (const kind of ['github', 'packages', 'docs'] as const) {
      expect(tuples(port, kind), `${slug} ${kind}`).toEqual(expected[kind]?.map((row) => [...row]))
    }
    expect(portPickers(port).map(({ kind }) => kind)).toEqual(['github', 'packages', 'docs'].filter((kind) => expected[kind as keyof typeof expected]))
  })

  it('shows all three menus for Rust and hides the ones a port has no entries for', () => {
    expect(portPickers(PORT_BY_SLUG.rs!).map(({ kind }) => kind)).toEqual(['github', 'packages', 'docs'])
    const kinds = (slug: string) => portPickers(PORT_BY_SLUG[slug]!).map(({ kind }) => kind)
    // No package registry and no off-site reference.
    expect(kinds('julia')).toEqual(['github'])
    expect(kinds('cxx')).toEqual(['github'])
    // A registry but no off-site reference.
    for (const slug of ['py', 'ruby', 'lua', 'powershell', 'ts', 'csharp', 'fsharp']) expect(kinds(slug), slug).toEqual(['github', 'packages'])
    expect(PORTS.filter((port) => kinds(port.slug).includes('docs')).map(({ slug }) => slug).sort())
      .toEqual(['go', 'java', 'kotlin', 'rs', 'scala', 'swift'])
    // Control: the same port loses the menu when its data does.
    expect(portPickers(withHosts({ registry: undefined })).map(({ kind }) => kind)).toEqual(['github', 'docs'])
    expect(portPickers(withHosts({ ecosystemHost: undefined, packages: [], components: [] })).map(({ kind }) => kind)).toEqual(['github', 'packages'])
    expect(portPickers(withHosts({ registry: undefined, ecosystemHost: undefined, packages: [], components: [] })).map(({ kind }) => kind)).toEqual(['github'])
  })

  it.each(PORTS.map(({ slug }) => slug))('keeps %s core entry first and its groups in product order', (slug) => {
    const port = PORT_BY_SLUG[slug]!
    for (const entry of portPickers(port)) {
      expect(entry.rows.length, `${slug} ${entry.kind}`).toBeGreaterThan(0)
      expect(entry.rows[0]!.group).toBe('core')
      const order = entry.rows.map((row) => PICKER_GROUPS.indexOf(row.group))
      expect(order).toEqual([...order].sort((a, b) => a - b))
    }
    expect(picker(port, 'packages')?.rows[0]?.url).toBe(port.registry?.url)
    expect(picker(port, 'docs')?.rows[0]?.url).toBe(port.ecosystemHost?.url ?? picker(port, 'docs')?.rows[0]?.url)
    // The library's own repository, or its directory, leads the GitHub menu.
    expect(picker(port, 'github')!.rows[0]!.url).toBe(port.source
      ? `https://github.com/${port.repo}/tree/${port.source.ref}/${port.source.path}` : `https://github.com/${port.repo}`)
  })

  it('names each destination once', () => {
    for (const port of PORTS) {
      for (const entry of portPickers(port)) {
        const urls = entry.rows.map((row) => row.url)
        expect(new Set(urls).size, `${port.slug} ${entry.kind}`).toBe(urls.length)
      }
    }
    // Swift lists one package page for three entries that share it.
    const units = [PORT_BY_SLUG.swift!.registry!.url, ...PORT_BY_SLUG.swift!.packages!.map((entry) => entry.registry)]
    expect(units.filter((url) => url === 'https://swiftpackageindex.com/libtmux/libtmux-swift')).toHaveLength(3)
    expect(picker(PORT_BY_SLUG.swift!, 'packages')!.rows).toHaveLength(1)
  })

  it('links only to unversioned external hosts, with no locale or preview prefix', () => {
    const hosts = new Set(['github.com', 'pypi.org', 'rubygems.org', 'luarocks.org', 'www.powershellgallery.com', 'www.npmjs.com', 'crates.io',
      'docs.rs', 'pkg.go.dev', 'central.sonatype.com', 'javadoc.io', 'www.nuget.org', 'swiftpackageindex.com'])
    for (const port of PORTS) {
      for (const entry of portPickers(port)) {
        for (const row of entry.rows) {
          const url = new URL(row.url)
          expect(url.protocol, row.url).toBe('https:')
          expect(hosts.has(url.hostname), row.url).toBe(true)
          expect(url.search + url.hash, row.url).toBe('')
          expect(url.pathname, row.url).not.toMatch(/^\/(?:pr-\d+\/)?(?:en|ja)\/|\/(?:latest|stable)(?:\/|$)/)
        }
      }
    }
  })

  it('marks each menu with GitHub, the registry or the documentation host', () => {
    for (const port of PORTS) {
      expect(picker(port, 'github')!.icon).toBe('github')
      expect(picker(port, 'packages')?.icon ?? port.registry?.icon).toBe(port.registry?.icon)
    }
    const icons = (slug: string) => portPickers(PORT_BY_SLUG[slug]!).map((entry) => entry.icon)
    expect(icons('rs')).toEqual(['github', 'crates', 'docsrs'])
    expect(icons('java')).toEqual(['github', 'maven', 'javadoc'])
    expect(icons('go')).toEqual(['github', 'go', 'go'])
    expect(icons('swift')).toEqual(['github', 'swift', 'swift'])
    expect(icons('py')).toEqual(['github', 'pypi'])
    expect(icons('powershell')).toEqual(['github', 'powershell'])
    expect(portPickers(PORT_BY_SLUG.go!).map((entry) => entry.context)).toEqual(['libtmux/libtmux-go', 'pkg.go.dev', 'pkg.go.dev'])
  })

  it('matches a search on labels, coordinates, import aliases, hosts and repository names', () => {
    const match = (slug: string, kind: PortPicker['kind'], label: string) =>
      picker(PORT_BY_SLUG[slug]!, kind)!.rows.find((row) => row.label === label)!.match.toLowerCase().split(' ')
    expect(match('rs', 'packages', 'libtmux-macros')).toEqual(expect.arrayContaining(['libtmux-macros', 'crates.io', 'libtmux/libtmux-rs', 'libtmux-rs', 'core', 'library']))
    expect(match('ts', 'packages', '@libtmux/workspace-cli')).toEqual(expect.arrayContaining(['@libtmux/workspace-cli', 'npm', 'tmux-workspace', 'manager']))
    expect(match('ruby', 'packages', 'libtmux-async')).toEqual(expect.arrayContaining(['libtmux/async', 'rubygems']))
    expect(match('go', 'packages', 'mcp')).toEqual(expect.arrayContaining(['github.com/libtmux/libtmux-go/mcp', 'pkg.go.dev', 'libtmux-go']))
    expect(match('java', 'packages', 'libtmux-mcp')).toEqual(expect.arrayContaining(['io.github.libtmux:libtmux-mcp', 'central']))
    expect(match('py', 'packages', 'tmuxp')).toEqual(expect.arrayContaining(['tmux-python/tmuxp', 'tmuxp', 'pypi']))
    expect(match('py', 'github', 'tmuxp')).toEqual(expect.arrayContaining(['tmux-python/tmuxp', 'github', 'source', 'repository']))
    expect(match('rs', 'docs', 'tmux-mcp')).toEqual(expect.arrayContaining(['docs.rs', 'api', 'reference', 'tmux-mcp']))
    // A coordinate that differs from the label is searchable and shown.
    expect(match('go', 'docs', 'tmux/tmuxtest')).toEqual(expect.arrayContaining(['github.com/libtmux/libtmux-go/tmux/tmuxtest']))
  })

  it('refuses a reference on a host it has no mark for', () => {
    const port = withHosts({ ecosystemHost: { name: 'Example', url: 'https://example.com/libtmux', rationale: 'Not a registered host.' } })
    expect(() => portPickers(port)).toThrow('https://example.com/libtmux has no registered reference host')
  })

  it('opens a separate repository for its products and a directory for the ones in the library repository', () => {
    const py = tuples(PORT_BY_SLUG.py!, 'github')!
    expect(py.map(([, , , url]) => url)).toEqual([
      'https://github.com/tmux-python/libtmux', 'https://github.com/tmux-python/libtmux-mcp', 'https://github.com/tmux-python/tmuxp',
    ])
    expect(tuples(PORT_BY_SLUG.rs!, 'github')!.slice(1).every(([, , , url]) =>
      /^https:\/\/github\.com\/libtmux\/libtmux-rs\/tree\/[^/]+\/crates\//.test(String(url)))).toBe(true)
  })
})
