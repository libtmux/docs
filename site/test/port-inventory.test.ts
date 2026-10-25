import { describe, expect, it } from 'vitest'
import {
  API_HOSTS, INVENTORY, PACKAGE_HOSTS, entryCandidates, entryDestinations, servedBy, sourceUrl, type InventoryEntry,
} from '../src/lib/port-inventory'
import manifestPackages from '../src/data/manifest-packages.json'
import { PORTS, PORT_BY_SLUG } from '../src/lib/ports'

const entries = (slug: string) => INVENTORY[slug]!
const published = (slug: string) => entries(slug).filter((entry) => entry.status === 'published')
const coordinates = (slug: string, kinds?: InventoryEntry['kind'][]) =>
  published(slug).filter((entry) => !kinds || kinds.includes(entry.kind)).map((entry) => entry.coordinate)

/**
 * What the owning manifests and release configuration declare, read at each
 * port's pinned revision by `scripts/gen-manifest-packages.mjs` rather than
 * written here. The comparison is two-sided: an entry the manifests do not
 * declare is as wrong as a declared package the inventory omits.
 */
const manifests = manifestPackages.ports as Record<string, {
  wrapper?: string
  distributions: { name: string; version: string }[]
  units: { unit: string; name: string }[]
}>
const distributions = (slug: string) => published(slug).filter((entry) => !entry.within && entry.kind !== 'source')
const declared = (slug: string) => manifests[slug]!.distributions.map((entry) => entry.name)
const GO = 'github.com/libtmux/libtmux-go'

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

  it('has a manifest reading for every port', () => {
    expect(Object.keys(manifests).sort()).toEqual(PORTS.map(({ slug }) => slug).sort())
  })

  it.each(PORTS.filter((port) => !port.parentLibrary).map(({ slug }) => slug))('lists exactly the distributions %s declares', (slug) => {
    expect(distributions(slug).map((entry) => entry.coordinate).sort((a, b) => a.localeCompare(b))).toEqual(declared(slug).sort((a, b) => a.localeCompare(b)))
  })

  it.each(PORTS.filter((port) => port.parentLibrary).map(({ slug }) => slug))('lists the %s package and the family package it builds on, and nothing the manifests lack', (slug) => {
    const own = distributions(slug).map((entry) => entry.coordinate)
    for (const name of own) expect(declared(slug), `${slug} ${name}`).toContain(name)
    expect(own[0], 'its own primary package leads').toBe(PORT_BY_SLUG[slug]!.packageName)
    // It does not list the rest of the family.
    expect(own.length).toBeLessThan(declared(slug).length)
  })

  it.each(PORTS.map(({ slug }) => slug).filter((slug) => manifests[slug]!.units.length > 0))('lists exactly the %s units its manifests declare', (slug) => {
    const types = new Set(manifests[slug]!.units.map((unit) => unit.unit))
    const found = published(slug).filter((entry) => entry.within && entry.unit && types.has(entry.unit))
    const pair = (unit: string | undefined, name: string) => `${unit}: ${name}`
    expect(found.map((entry) => pair(entry.unit, entry.label)).sort((a, b) => a.localeCompare(b)))
      .toEqual(manifests[slug]!.units.map((unit) => pair(unit.unit, unit.name)).sort((a, b) => a.localeCompare(b)))
  })

  it('counts an entry that ships inside a distribution once, under the one that holds it', () => {
    for (const [slug, list] of Object.entries(INVENTORY)) {
      for (const entry of list.filter((candidate) => candidate.within)) {
        const holder = list.find((candidate) => candidate.id === entry.within)
        expect(holder, `${slug}:${entry.id} sits inside ${entry.within}`).toBeDefined()
        expect(holder!.within, `${slug}:${entry.id} sits inside a distribution, not another entry`).toBeUndefined()
        expect(holder!.repo, `${slug}:${entry.id}`).toBe(entry.repo)
      }
    }
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

  it('leaves out private workspaces and development tools, which no host serves', () => {
    // From the manifests: npm `private`, Cargo `publish = false`, Go modules of benchmarks, examples and tools, and unpackable projects.
    const development = ['@libtmux/repo', 'libtmux-fuzz', 'mcp-swap', 'mcp_swap', 'libtmux_matrix', 'LibTmux.Engineering', 'LibTmux.McpSwap',
      'integration-tests', 'benchmarks', 'examples', 'internal/tools']
    const named = Object.values(INVENTORY).flat().flatMap((entry) => [entry.label, entry.coordinate, entry.path ?? ''])
    for (const name of development) {
      expect(named.filter((value) => value === name || value.endsWith(`/${name}`)), name).toEqual([])
    }
    // Control: the same comparison finds a name that is inventoried.
    expect(named.filter((value) => value === 'tmux-workspace')).not.toEqual([])
  })

  it('keeps each ecosystem’s own unit of identity', () => {
    const byId = (slug: string, id: string) => entries(slug).find((entry) => entry.id === id)!
    const shape = (slug: string, ids: string[]) => ids.map((id) => [id, byId(slug, id).kind, byId(slug, id).unit, byId(slug, id).within])
    // Go: three modules with a go.mod each; the packages and commands inside a module hold no go.mod of their own.
    expect(shape('go', ['module', 'mcp', 'workspace', 'tmux', 'tmuxq', 'tmuxtest', 'libtmux-mcp', 'tmux-workspace'])).toEqual([
      ['module', 'module', 'module', undefined], ['mcp', 'mcp-server', 'module', undefined], ['workspace', 'companion', 'module', undefined],
      ['tmux', 'library', 'package', 'module'], ['tmuxq', 'companion', 'package', 'module'], ['tmuxtest', 'testing', 'package', 'module'],
      ['libtmux-mcp', 'cli', 'command', 'mcp'], ['tmux-workspace', 'cli', 'command', 'workspace'],
    ])
    expect(entries('go').filter((entry) => entry.unit === 'module').map((entry) => entry.coordinate)).toEqual([GO, `${GO}/mcp`, `${GO}/workspace`])
    // Swift: one package; a target and a product for each library, a fixture and two executables.
    const swift = entries('swift')
    expect(swift.filter((entry) => !entry.within).map((entry) => [entry.unit, entry.label])).toEqual([['package', 'libtmux-swift']])
    expect(swift.filter((entry) => entry.unit === 'product').map((entry) => [entry.kind, entry.label])).toEqual([
      ['module', 'LibTmux'], ['testing', 'TmuxFixture'], ['module', 'LibTmuxMCP'], ['module', 'TmuxWorkspace'],
    ])
    expect(swift.filter((entry) => entry.unit === 'executable product').map((entry) => [entry.kind, entry.label])).toEqual([['cli', 'libtmux-mcp'], ['cli', 'tmux-workspace']])
    expect(swift.filter((entry) => entry.kind === 'target').map((entry) => [entry.unit, entry.label])).toEqual([
      ['target', 'LibTmux'], ['target', 'TmuxFixture'], ['target', 'LibTmuxMCP'], ['executable target', 'libtmux-mcp'],
      ['target', 'TmuxWorkspace'], ['executable target', 'TmuxWorkspaceCLI'],
    ])
    expect(byId('swift', 'target:TmuxFixture').path).toBe('Tests/TmuxFixture')
    expect(byId('swift', 'target:LibTmux').api?.url).toBe('https://swiftpackageindex.com/libtmux/libtmux-swift/documentation/libtmux')
    // Only a target has DocC; a product has none of its own and shares the package page.
    expect(swift.filter((entry) => entry.api).map((entry) => entry.id)).toEqual(['target:LibTmux', 'target:LibTmuxMCP', 'target:TmuxWorkspace'])
    expect(new Set(swift.filter((entry) => entry.package).map((entry) => entry.package!.url)).size).toBe(1)
    // Julia: three packages with their own directories, an embedded module and two extensions, none registered.
    expect(entries('julia').map((entry) => [entry.kind, entry.unit, entry.label, entry.package])).toEqual([
      ['library', 'package', 'LibTmux', undefined], ['source', undefined, 'libtmux-julia', undefined],
      ['module', 'module', 'LibTmux.Filters', undefined], ['module', 'extension', 'LibTmuxJSONExt', undefined],
      ['module', 'extension', 'LibTmuxTablesExt', undefined], ['mcp-server', 'package', 'LibTmuxMCP', undefined],
      ['companion', 'package', 'LibTmuxWorkspace', undefined],
    ])
    expect(byId('julia', 'LibTmuxMCP').path).toBe('packages/LibTmuxMCP')
    expect([byId('julia', 'LibTmuxJSONExt'), byId('julia', 'LibTmuxTablesExt'), byId('julia', 'LibTmux.Filters')].map((entry) => [entry.path, entry.file]))
      .toEqual([['ext/LibTmuxJSONExt.jl', true], ['ext/LibTmuxTablesExt.jl', true], ['src/criteria.jl', true]])
    // C++: a custom vcpkg registry port and CMake targets, so no host page names anything.
    expect(entries('cxx').map((entry) => [entry.kind, entry.label])).toEqual([
      ['library', 'libtmux'], ['source', 'libtmux-cxx'], ['source', 'vcpkg port'], ['target', 'libtmux::libtmux'],
      ['testing', 'libtmux::testing'], ['cli', 'libtmux-mcp-server'], ['cli', 'tmux-workspace'],
    ])
    expect(entries('cxx').filter((entry) => entry.package || entry.api)).toEqual([])
  })

  it('gives every command one kind, whatever it serves', () => {
    const commands = Object.entries(INVENTORY).flatMap(([slug, list]) => list.filter((entry) => /^(?:command|executable|executable product)$/.test(entry.unit ?? ''))
      .map((entry) => [slug, entry.id, entry.kind]))
    expect(commands).toEqual([
      ['go', 'libtmux-mcp', 'cli'], ['go', 'tmux-workspace', 'cli'], ['cxx', 'libtmux-mcp-server', 'cli'], ['cxx', 'tmux-workspace', 'cli'],
      ['swift', 'product:libtmux-mcp', 'cli'], ['swift', 'product:tmux-workspace', 'cli'],
    ])
    // A package that offers a library as well as a command is judged by its role.
    expect(entries('powershell').find((entry) => entry.id === 'LibTmux.Workspace')?.kind).toBe('companion')
    for (const [slug, id] of [['py', 'tmuxp'], ['ruby', 'libtmux-workspace'], ['rs', 'tmux-workspace'], ['julia', 'LibTmuxWorkspace']]) {
      expect(entries(slug!).find((entry) => entry.id === id)?.kind, `${slug}:${id}`).toBe('companion')
    }
    // A package that only installs a command is a command; the BOM is a standalone artifact.
    for (const [slug, id] of [['ts', 'workspace-cli'], ['csharp', 'LibTmux.Workspace.Cli'], ['java', 'libtmux-workspace-cli']]) {
      expect(entries(slug!).find((entry) => entry.id === id)?.kind, `${slug}:${id}`).toBe('cli')
    }
    expect(entries('java').find((entry) => entry.id === 'libtmux-bom')).toMatchObject({ kind: 'companion', unit: 'BOM' })
  })

  it('carries the import names and extensions a reader may type', () => {
    const aliases = (slug: string, id: string) => entries(slug).find((entry) => entry.id === id)!.aliases
    expect(aliases('java', 'libtmux-scala')).toContain('io.github.libtmux.scaladsl')
    expect(aliases('scala', 'libtmux-scala')).toContain('io.github.libtmux.scaladsl')
    expect(aliases('scala', 'libtmux-scala-cats')).toContain('io.github.libtmux.scaladsl.cats')
    expect(aliases('scala', 'libtmux-scala-ox')).toContain('io.github.libtmux.scaladsl.ox')
    expect(entries('py').find((entry) => entry.coordinate === 'libtmux.test')).toMatchObject({ kind: 'testing', path: 'src/libtmux/test' })
    expect(entries('julia').filter((entry) => entry.unit === 'extension').map((entry) => entry.label)).toEqual(['LibTmuxJSONExt', 'LibTmuxTablesExt'])
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
      'tmux-python/libtmux', 'tmux-python/libtmux', 'tmux-python/libtmux', 'tmux-python/tmuxp', 'tmux-python/tmuxp',
      'tmux-python/libtmux-mcp', 'tmux-python/libtmux-mcp',
    ])
    expect(entries('py').find((entry) => entry.id === 'libtmux-mcp')?.ref).toBe('main')
  })

  it('agrees with every field of the port metadata the hero already shows', () => {
    for (const port of PORTS) {
      const [library] = entries(port.slug)
      const list = published(port.slug)
      expect(library!.repo, `${port.slug} repo`).toBe(port.repo)
      // The vcpkg port is `libtmux`; the metadata's package name is the repository's.
      expect(library!.coordinate, `${port.slug} packageName`).toBe(port.slug === 'cxx' ? 'libtmux' : port.packageName)
      if (port.slug === 'cxx') expect(port.packageName).toBe('libtmux-cxx')
      expect(library!.package?.url, `${port.slug} registry url`).toBe(port.registry?.url)
      if (port.registry) {
        expect(PACKAGE_HOSTS[library!.package!.host].name, `${port.slug} registry name`).toBe(port.registry.name)
        expect(PACKAGE_HOSTS[library!.package!.host].icon, `${port.slug} registry icon`).toBe(port.registry.icon)
      }
      // Swift's package documents nothing itself; its reference is its main module's DocC, which the hero's metadata does not name.
      const reference = library!.api ?? list.find((entry) => entry.id === library!.reference)?.api
      if (port.slug !== 'swift') expect(reference?.url, `${port.slug} ecosystem url`).toBe(port.ecosystemHost?.url)
      if (port.ecosystemHost) expect(reference?.tool ?? API_HOSTS[reference!.host].name, `${port.slug} ecosystem name`).toBe(port.ecosystemHost.name)
      if (port.source) {
        expect([library!.path, library!.ref], `${port.slug} source`).toEqual([port.source.path, port.source.ref])
      }
      for (const documented of port.packages ?? []) {
        const where = `${port.slug} ${documented.name}`
        const coordinate = documented.coordinate ?? documented.name
        // Every field the metadata gives is held by an entry that carries it; one entry need not hold them all, as Go's
        // module page and its command directory are separate entries.
        expect(list.some((entry) => entry.coordinate === coordinate || entry.label === documented.name), `${where} name`).toBe(true)
        if (documented.registry) expect(list.some((entry) => entry.package?.url === documented.registry && (entry.coordinate === coordinate || entry.label === documented.name)), `${where} registry`).toBe(true)
        if (documented.reference) expect(list.some((entry) => entry.api?.url === documented.reference), `${where} reference`).toBe(true)
        if (documented.source) {
          const { repo = port.repo, path, ref } = documented.source
          expect(list.some((entry) => entry.repo === repo && entry.path === path && entry.ref === ref), `${where} source`).toBe(true)
        }
        for (const word of [documented.require, documented.executable]) {
          if (word) expect(list.some((entry) => [entry.coordinate, entry.label, ...entry.aliases].includes(word)), `${where} ${word}`).toBe(true)
        }
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
          if (kind === 'package' && host in PACKAGE_HOSTS) expect(servedBy(PACKAGE_HOSTS[host as keyof typeof PACKAGE_HOSTS], parsed.hostname), `${where} ${parsed.hostname}`).toBe(true)
          if (kind === 'api' && host in API_HOSTS) expect(servedBy(API_HOSTS[host as keyof typeof API_HOSTS], parsed.hostname), `${where} ${parsed.hostname}`).toBe(true)
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
      .toEqual(['elixir', 'go', 'java', 'kotlin', 'rs', 'scala', 'swift'])
    // Go’s package page and its API reference are one URL on one host.
    for (const entry of entries('go')) expect(entry.api?.url, entry.id).toBe(entry.package?.url)
  })

  it('names a host’s own subdomain only for a host that gives each package one', () => {
    expect(servedBy(API_HOSTS.hexdocs, 'libtmux.hexdocs.pm')).toBe(true)
    expect(servedBy(API_HOSTS.hexdocs, 'hexdocs.pm')).toBe(true)
    // Control: a lookalike, a suffix of another domain, and a subdomain of a host that serves none.
    expect(servedBy(API_HOSTS.hexdocs, 'libtmux.hexdocs.pm.example.com')).toBe(false)
    expect(servedBy(API_HOSTS.hexdocs, 'nothexdocs.pm')).toBe(false)
    expect(servedBy(PACKAGE_HOSTS.pypi, 'evil.pypi.org')).toBe(false)
    expect(servedBy(PACKAGE_HOSTS.pypi, 'pypi.org')).toBe(true)
  })

  it('lists Elixir’s one Hex package with its HexDocs reference, and records the projects Hex does not carry as planned', () => {
    expect(entries('elixir').map((entry) => [entry.id, entry.kind, entry.status, entry.path, entry.package?.url, entry.api?.url])).toEqual([
      ['libtmux', 'library', 'published', 'lib', 'https://hex.pm/packages/libtmux', 'https://libtmux.hexdocs.pm/'],
      ['repository', 'source', 'published', undefined, undefined, undefined],
      ['libtmux_mcp', 'mcp-server', 'planned', 'packages/mcp', undefined, undefined],
      ['libtmux_workspace', 'companion', 'planned', 'packages/workspace', undefined, undefined],
    ])
    expect(entries('elixir').every((entry) => entry.repo === 'libtmux/libtmux-elixir' && entry.ref === 'main')).toBe(true)
    // Hex names a package for its Mix `app`, so these are the pages that would answer once one is published.
    const planned = entries('elixir').filter((entry) => entry.status === 'planned')
    for (const entry of planned) {
      expect(entry.note, entry.id).toMatch(/-dev version/)
      expect(entryCandidates(entry).map(({ kind, host, url }) => [kind, host, url]), entry.id).toEqual([['package', 'hex', `https://hex.pm/packages/${entry.coordinate}`]])
    }
    // They produce no link, so the header offers only the published entries.
    expect(published('elixir').map((entry) => entry.id)).toEqual(['libtmux', 'repository'])
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

  it('points a package that documents nothing itself at the module that does', () => {
    for (const [slug, list] of Object.entries(INVENTORY)) {
      for (const entry of list.filter((candidate) => candidate.reference)) {
        const documented = list.find((candidate) => candidate.id === entry.reference)
        expect(documented?.api, `${slug}:${entry.id}`).toBeDefined()
        expect(entry.api, `${slug}:${entry.id} documents nothing itself`).toBeUndefined()
        expect(documented?.status).toBe('published')
      }
    }
    expect(entries('swift')[0]!.reference).toBe('target:LibTmux')
  })

  it('builds a source link from a file, a directory, or the repository when there is none', () => {
    expect(sourceUrl({ repo: 'libtmux/libtmux-julia', path: 'ext/LibTmuxJSONExt.jl', file: true, ref: 'master' })).toBe('https://github.com/libtmux/libtmux-julia/blob/master/ext/LibTmuxJSONExt.jl')
    expect(sourceUrl({ repo: 'libtmux/libtmux-julia', path: 'ext', ref: 'master' })).toBe('https://github.com/libtmux/libtmux-julia/tree/master/ext')
    expect(sourceUrl({ repo: 'libtmux/libtmux-rs', path: 'crates/tmux-mcp', ref: 'master' })).toBe('https://github.com/libtmux/libtmux-rs/tree/master/crates/tmux-mcp')
    expect(sourceUrl({ repo: 'libtmux/libtmux-rs', ref: 'master' })).toBe('https://github.com/libtmux/libtmux-rs')
    expect(sourceUrl({ repo: 'tmux-python/libtmux-mcp', path: 'src/libtmux_mcp', ref: 'main' })).toBe('https://github.com/tmux-python/libtmux-mcp/tree/main/src/libtmux_mcp')
    expect(PORT_BY_SLUG.rs).toBeDefined()
  })

  it('opens a file only where the entry names one, and a directory everywhere else', () => {
    const all = Object.entries(INVENTORY).flatMap(([port, list]) => list.map((entry) => ({ port, entry })))
    for (const { port, entry } of all) {
      const leaf = entry.path?.split('/').at(-1) ?? ''
      // A file has an extension and is opened as a blob; none of the directories here do.
      expect(entry.file === true, `${port}:${entry.id} ${entry.path ?? ''}`).toBe(entry.path !== undefined && /\.[a-z]+$/.test(leaf))
      if (entry.path) expect(sourceUrl(entry)).toContain(`/${entry.file ? 'blob' : 'tree'}/`)
    }
    expect(all.filter(({ entry }) => entry.file).map(({ port, entry }) => `${port}:${entry.id}`).sort())
      .toEqual(['julia:LibTmux.Filters', 'julia:LibTmuxJSONExt', 'julia:LibTmuxTablesExt', 'py:pytest-plugin'])
  })
})
