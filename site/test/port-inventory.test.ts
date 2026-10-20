import { describe, expect, it } from 'vitest'
import {
  API_HOSTS, INVENTORY, PACKAGE_HOSTS, entryCandidates, entryDestinations, sourceUrl, type InventoryEntry,
} from '../src/lib/port-inventory'
import { PORTS, PORT_BY_SLUG } from '../src/lib/ports'

const entries = (slug: string) => INVENTORY[slug]!
const published = (slug: string) => entries(slug).filter((entry) => entry.status === 'published')
const coordinates = (slug: string, kinds?: InventoryEntry['kind'][]) =>
  published(slug).filter((entry) => !kinds || kinds.includes(entry.kind)).map((entry) => entry.coordinate)

/**
 * What the owning manifests and release configuration declare, written from
 * their files rather than computed from the inventory: `package.json` and
 * `release_policy.ts`, `Cargo.toml` (`publish`), `go.mod`, the Gradle
 * publication conventions and BOM, the `.csproj` package ids, `Package.swift`,
 * each `Project.toml`, the vcpkg port and CMake targets, and the gemspecs,
 * rockspec publish step and module manifests.
 */
const DECLARED_PACKAGES: Record<string, readonly string[]> = {
  py: ['libtmux', 'tmuxp', 'libtmux-mcp'],
  ruby: ['libtmux', 'libtmux-async', 'libtmux-mcp', 'libtmux-workspace'],
  lua: ['libtmux'],
  powershell: ['LibTmux', 'LibTmux.Workspace'],
  ts: ['libtmux', '@libtmux/mcp', '@libtmux/workspace', '@libtmux/workspace-cli'],
  rs: ['libtmux', 'libtmux-macros', 'tmux-mcp', 'tmux-workspace'],
  java: ['libtmux', 'libtmux-bom', 'libtmux-jackson', 'libtmux-junit5', 'libtmux-kotlin', 'libtmux-mcp', 'libtmux-scala_3',
    'libtmux-scala-cats_3', 'libtmux-scala-ox_3', 'libtmux-workspace', 'libtmux-workspace-cli'].map((name) => `io.github.libtmux:${name}`),
  csharp: ['LibTmux', 'LibTmux.Query.Json', 'LibTmux.Testing', 'LibTmux.Extensions.DependencyInjection', 'LibTmux.Workspace',
    'LibTmux.Workspace.Cli', 'LibTmux.Mcp', 'LibTmux.FSharp'],
}

describe('port inventory', () => {
  it('covers every registered port and nothing else', () => {
    expect(Object.keys(INVENTORY).sort()).toEqual(PORTS.map(({ slug }) => slug).sort())
  })

  it.each(PORTS.map(({ slug }) => slug))('names %s once, with its library first and an owner for every entry', (slug) => {
    const ids = entries(slug).map((entry) => entry.id)
    expect(new Set(ids).size, 'ids are unique').toBe(ids.length)
    expect(entries(slug).filter((entry) => entry.kind === 'library'), 'exactly one library').toHaveLength(1)
    expect(entries(slug)[0]!.kind).toBe('library')
    expect(entries(slug)[0]!.status).toBe('published')
    for (const entry of entries(slug)) {
      expect(entry.label.trim(), entry.id).not.toBe('')
      expect(entry.coordinate.trim(), entry.id).not.toBe('')
      expect(entry.repo, entry.id).toMatch(/^[\w.-]+\/[\w.-]+$/)
      expect(entry.path ?? '', entry.id).not.toMatch(/^\/|\/$|\.\./)
    }
  })

  it.each(Object.entries(DECLARED_PACKAGES))('includes every package %s declares', (slug, declared) => {
    const distributions = coordinates(slug, ['library', 'companion', 'cli', 'mcp-server', 'module', 'testing'])
    for (const name of declared) expect(distributions, `${slug} ${name}`).toContain(name)
  })

  it('lists the distributions the metadata used to omit', () => {
    // The workspace library is separate from its CLI; the macros crate is separate from the library.
    expect(coordinates('ts')).toEqual(expect.arrayContaining(['@libtmux/workspace', '@libtmux/workspace-cli']))
    expect(coordinates('rs')).toContain('libtmux-macros')
    // The BOM, Jackson, JUnit and the Scala facades are published beside the library and its products.
    expect(coordinates('java')).toEqual(expect.arrayContaining(['io.github.libtmux:libtmux-bom', 'io.github.libtmux:libtmux-jackson',
      'io.github.libtmux:libtmux-junit5', 'io.github.libtmux:libtmux-scala-cats_3', 'io.github.libtmux:libtmux-scala-ox_3']))
    expect(coordinates('csharp')).toEqual(expect.arrayContaining(['LibTmux.Query.Json', 'LibTmux.Testing', 'LibTmux.Extensions.DependencyInjection']))
    // Ruby's async gem has a source directory even though the central metadata never named it.
    expect(published('ruby').find((entry) => entry.id === 'libtmux-async')?.path).toBe('gems/libtmux-async')
  })

  it('keeps each ecosystem’s own unit of identity', () => {
    const byId = (slug: string, id: string) => entries(slug).find((entry) => entry.id === id)!
    // Go: a root module, packages inside it, two further modules and a command in each.
    const go = entries('go').map((entry) => [entry.kind, entry.coordinate])
    expect(go).toEqual(expect.arrayContaining([
      ['module', 'github.com/libtmux/libtmux-go'], ['library', 'github.com/libtmux/libtmux-go/tmux'],
      ['module', 'github.com/libtmux/libtmux-go/tmuxq'], ['testing', 'github.com/libtmux/libtmux-go/tmux/tmuxtest'],
      ['mcp-server', 'github.com/libtmux/libtmux-go/mcp'], ['cli', 'github.com/libtmux/libtmux-go/mcp/cmd/libtmux-mcp'],
      ['companion', 'github.com/libtmux/libtmux-go/workspace'], ['cli', 'github.com/libtmux/libtmux-go/workspace/cmd/tmux-workspace'],
    ]))
    // Swift: one package, library products with DocC targets, a fixture product and two executables.
    expect(entries('swift').map((entry) => [entry.kind, entry.label])).toEqual([
      ['library', 'libtmux-swift'], ['module', 'LibTmux'], ['testing', 'TmuxFixture'], ['module', 'LibTmuxMCP'],
      ['mcp-server', 'libtmux-mcp'], ['module', 'TmuxWorkspace'], ['cli', 'tmux-workspace'],
    ])
    expect(byId('swift', 'TmuxFixture').path).toBe('Tests/TmuxFixture')
    expect(byId('swift', 'LibTmux').api?.url).toBe('https://swiftpackageindex.com/libtmux/libtmux-swift/documentation/libtmux')
    expect(byId('swift', 'TmuxFixture').api, 'the fixture has no DocC target').toBeUndefined()
    // Julia: three packages with their own directories and an embedded module, none registered.
    expect(entries('julia').map((entry) => [entry.kind, entry.label, entry.package])).toEqual([
      ['library', 'LibTmux', undefined], ['source', 'libtmux-julia', undefined], ['module', 'LibTmux.Filters', undefined],
      ['mcp-server', 'LibTmuxMCP', undefined], ['cli', 'LibTmuxWorkspace', undefined],
    ])
    expect(byId('julia', 'LibTmuxMCP').path).toBe('packages/LibTmuxMCP')
    // C++: a custom vcpkg registry port and CMake targets, so no host page names anything.
    expect(entries('cxx').map((entry) => [entry.kind, entry.label])).toEqual([
      ['library', 'libtmux'], ['source', 'libtmux-cxx'], ['source', 'vcpkg port'], ['target', 'libtmux::libtmux'],
      ['testing', 'libtmux::testing'], ['mcp-server', 'libtmux-mcp-server'], ['cli', 'tmux-workspace'],
    ])
    expect(entries('cxx').filter((entry) => entry.package || entry.api)).toEqual([])
  })

  it('gives Kotlin, Scala and F# their own primary package and the family’s repository', () => {
    const library = (slug: string) => entries(slug)[0]!
    expect([library('kotlin').coordinate, library('scala').coordinate, library('fsharp').coordinate])
      .toEqual(['io.github.libtmux:libtmux-kotlin', 'io.github.libtmux:libtmux-scala_3', 'LibTmux.FSharp'])
    expect(library('kotlin').repo).toBe('libtmux/libtmux-java')
    expect(library('fsharp').repo).toBe('libtmux/libtmux-dotnet')
    // The Java and C# libraries they build on are companions with their own page, not the primary.
    expect(entries('kotlin').find((entry) => entry.coordinate === 'io.github.libtmux:libtmux')?.kind).toBe('companion')
    expect(entries('fsharp').find((entry) => entry.coordinate === 'LibTmux')?.kind).toBe('companion')
    // They do not inherit the parent’s MCP server, workspace CLI or testing artifacts.
    for (const slug of ['kotlin', 'scala', 'fsharp']) {
      expect(entries(slug).filter((entry) => ['mcp-server', 'cli', 'testing'].includes(entry.kind)), slug).toEqual([])
    }
    // Another repository keeps its own: Python’s companions are not directories of the library’s.
    expect(entries('py').map((entry) => entry.repo)).toEqual([
      'tmux-python/libtmux', 'tmux-python/libtmux', 'tmux-python/tmuxp', 'tmux-python/libtmux-mcp',
    ])
    expect(entries('py').find((entry) => entry.id === 'libtmux-mcp')?.ref).toBe('main')
  })

  it('agrees with the port metadata the hero already shows', () => {
    for (const port of PORTS) {
      const [library] = entries(port.slug)
      expect(library!.repo, port.slug).toBe(port.repo)
      expect(library!.package?.url, port.slug).toBe(port.registry?.url)
      expect(library!.api?.url, port.slug).toBe(port.ecosystemHost?.url)
      if (port.source) expect(library!.path, port.slug).toBe(port.source.path)
      if (port.registry) expect(PACKAGE_HOSTS[library!.package!.host].name, port.slug).toBe(port.registry.name)
      for (const documented of port.packages ?? []) {
        const match = published(port.slug).find((entry) => entry.package?.url === documented.registry
          || (documented.source && entry.repo === (documented.source.repo ?? port.repo) && entry.path === documented.source.path))
        expect(match, `${port.slug} ${documented.name}`).toBeDefined()
        if (documented.registry) expect(match!.package?.url).toBe(documented.registry)
        if (documented.reference) expect(match!.api?.url).toBe(documented.reference)
      }
    }
  })

  it('serves every destination from the host it names, over https, without a version or locale', () => {
    for (const [slug, list] of Object.entries(INVENTORY)) {
      for (const entry of list) {
        const linked = entryDestinations(entry)
        for (const { kind, url, host } of [...linked, ...entryCandidates(entry)]) {
          const where = `${slug}:${entry.id} ${kind}`
          const parsed = new URL(url)
          expect(parsed.protocol, where).toBe('https:')
          expect(parsed.search + parsed.hash, where).toBe('')
          // A candidate is another host's own URL, so only what the site links must be free of our prefixes.
          if (linked.some((destination) => destination.url === url)) {
            expect(parsed.pathname, where).not.toMatch(/^\/(?:pr-\d+\/)?(?:en|ja)\/|\/(?:latest|stable)(?:\/|$)/)
          }
          if (kind === 'package' && host in PACKAGE_HOSTS) expect(parsed.hostname, where).toBe(PACKAGE_HOSTS[host as keyof typeof PACKAGE_HOSTS].hostname)
          if (kind === 'api' && host in API_HOSTS) expect(parsed.hostname, where).toBe(API_HOSTS[host as keyof typeof API_HOSTS].hostname)
          if (kind === 'source') expect(parsed.hostname, where).toBe('github.com')
        }
      }
    }
  })

  it('names a package page only for a distribution that has one, and an API page only where a host builds one', () => {
    for (const slug of ['julia', 'cxx']) {
      expect(entries(slug).flatMap((entry) => [entry.package, entry.api]).filter(Boolean), slug).toEqual([])
    }
    // Only these ecosystems host an API reference off site.
    expect(PORTS.filter((port) => entries(port.slug).some((entry) => entry.api)).map(({ slug }) => slug).sort())
      .toEqual(['go', 'java', 'kotlin', 'rs', 'scala', 'swift'])
    // Go’s package page and its API reference are one URL on one host.
    for (const entry of entries('go')) expect(entry.api?.url, entry.id).toBe(entry.package?.url)
  })

  it('links nothing for an entry that is planned or configured but not published', () => {
    const lua = entries('lua')
    expect(lua.filter((entry) => entry.status !== 'published').map((entry) => [entry.id, entry.status])).toEqual([
      ['libtmux-mcp', 'planned'], ['libtmux-workspace', 'planned'],
    ])
    for (const entry of lua.filter((candidate) => candidate.status === 'planned')) {
      expect(entry.package, entry.id).toBeUndefined()
      expect(entry.note, entry.id).toMatch(/rockspec/)
      // The unpublished package page is recorded as a destination to keep failing, never as a link.
      expect(entryCandidates(entry).map(({ url }) => url), entry.id).toEqual([`https://luarocks.org/modules/tony/${entry.id}`])
    }
    for (const list of Object.values(INVENTORY)) {
      for (const entry of list.filter((candidate) => candidate.status !== 'published')) {
        expect(entry.note, entry.id).toBeTruthy()
        expect(entry.package ?? entry.api, entry.id).toBeUndefined()
      }
    }
    // The BOM and the workspace CLI ship no Javadoc, so javadoc.io is a rejected candidate for each.
    for (const id of ['libtmux-bom', 'libtmux-workspace-cli']) {
      const entry = entries('java').find((candidate) => candidate.id === id)!
      expect(entry.api, id).toBeUndefined()
      expect(entryCandidates(entry).map(({ url }) => url), id).toEqual([`https://javadoc.io/doc/io.github.libtmux/${id}`])
    }
  })

  it('builds a source link from a directory, or the repository when there is none', () => {
    expect(sourceUrl({ repo: 'libtmux/libtmux-rs', path: 'crates/tmux-mcp', ref: 'master' })).toBe('https://github.com/libtmux/libtmux-rs/tree/master/crates/tmux-mcp')
    expect(sourceUrl({ repo: 'libtmux/libtmux-rs', ref: 'master' })).toBe('https://github.com/libtmux/libtmux-rs')
    expect(sourceUrl({ repo: 'tmux-python/libtmux-mcp', path: 'src/libtmux_mcp', ref: 'main' })).toBe('https://github.com/tmux-python/libtmux-mcp/tree/main/src/libtmux_mcp')
    expect(PORT_BY_SLUG.rs).toBeDefined()
  })
})
