/**
 * What each port ships and where a reader finds it.
 *
 * One entry names one thing a reader can depend on, run or read: a library, a
 * companion package, a command, an MCP server, a testing product, an importable
 * module, a build target or a source directory. Entries come from the owning
 * manifests (`pyproject.toml`, `Cargo.toml`, `go.mod`, Gradle conventions,
 * `Package.swift`, `*.csproj`, CMake and vcpkg files) and their release
 * configuration, not from the documentation products, which group artifacts by
 * purpose rather than by distribution.
 *
 * A destination is real or absent. A package host or API host an entry does
 * not name is one the ecosystem does not provide, and no URL is derived for it:
 * Julia has no registry page, the C++ port is a vcpkg port in this project's own
 * registry rather than the curated one, and a Swift product has no page apart
 * from its package.
 */

import type { DocProduct } from './ports.ts'

/**
 * What an entry is to a reader. One rule applies in every port: an entry that
 * is a command (an executable target or product, a Go `cmd/` package, a CMake
 * executable, or a package that exists only to install one) is `cli`, whether
 * the program is a workspace loader or an MCP server. A package that offers a
 * library as well as a command is judged by its role instead.
 */
export type InventoryKind =
  /** The port's own library: the package the install widget adds. */
  | 'library'
  /** Another distribution released with, or on top of, the library. */
  | 'companion'
  /** A command a shell runs. */
  | 'cli'
  /** An MCP server distributed as a package or module, which may also install a command. */
  | 'mcp-server'
  /** Test support kept out of the library, such as a fixture or a plugin. */
  | 'testing'
  /** An importable module that ships inside another distribution. */
  | 'module'
  /** A build-system target a project links, such as a CMake imported target or a SwiftPM target. */
  | 'target'
  /** A repository or directory that is read rather than installed. */
  | 'source'

export const INVENTORY_KIND_LABEL: Readonly<Record<InventoryKind, string>> = {
  library: 'library', companion: 'companion package', cli: 'command line', 'mcp-server': 'MCP server',
  testing: 'testing', module: 'module', target: 'build target', source: 'source',
}

/**
 * Words a reader may type for a kind. A kind answers to its synonyms, so
 * `cli` and `command line` find the same entries.
 */
export const KIND_TERMS: Readonly<Record<InventoryKind, readonly string[]>> = {
  library: ['library'],
  companion: ['companion', 'companion package', 'package'],
  cli: ['cli', 'command line', 'command', 'executable'],
  'mcp-server': ['mcp', 'mcp server', 'server'],
  testing: ['testing', 'test', 'tests', 'fixture'],
  module: ['module'],
  target: ['target', 'build target'],
  source: ['source', 'directory'],
}

/**
 * Whether an entry may be linked.
 *
 * `published` means a public release of the entry's own distribution: a
 * registry release, or for a port installed straight from Git a public
 * repository. `configured-unpublished` is set up to publish but the host does
 * not carry it yet. `planned` is a development input or a private workspace.
 * Only `published` entries produce links; the other two are kept so the
 * omission is on record and a test notices when a host starts serving one.
 */
export type PublicationStatus = 'published' | 'configured-unpublished' | 'planned'

export type PackageHostId =
  | 'pypi' | 'rubygems' | 'luarocks' | 'powershell-gallery' | 'npm' | 'crates' | 'pkg-go-dev'
  | 'maven-central' | 'nuget' | 'swift-package-index'
export type ApiHostId = 'docs-rs' | 'pkg-go-dev' | 'javadoc-io' | 'swift-package-index'
export type HostIcon = 'github' | 'pypi' | 'npm' | 'crates' | 'go' | 'maven' | 'nuget' | 'swift' | 'rubygems' | 'luarocks'
  | 'powershell' | 'docsrs' | 'javadoc' | 'docc'

export interface HostIdentity {
  name: string
  hostname: string
  icon: HostIcon
}

export const PACKAGE_HOSTS: Readonly<Record<PackageHostId, HostIdentity>> = {
  pypi: { name: 'PyPI', hostname: 'pypi.org', icon: 'pypi' },
  rubygems: { name: 'RubyGems', hostname: 'rubygems.org', icon: 'rubygems' },
  luarocks: { name: 'LuaRocks', hostname: 'luarocks.org', icon: 'luarocks' },
  'powershell-gallery': { name: 'PowerShell Gallery', hostname: 'www.powershellgallery.com', icon: 'powershell' },
  npm: { name: 'npm', hostname: 'www.npmjs.com', icon: 'npm' },
  crates: { name: 'crates.io', hostname: 'crates.io', icon: 'crates' },
  'pkg-go-dev': { name: 'pkg.go.dev', hostname: 'pkg.go.dev', icon: 'go' },
  'maven-central': { name: 'Maven Central', hostname: 'central.sonatype.com', icon: 'maven' },
  nuget: { name: 'NuGet', hostname: 'www.nuget.org', icon: 'nuget' },
  'swift-package-index': { name: 'Swift Package Index', hostname: 'swiftpackageindex.com', icon: 'swift' },
}

export const API_HOSTS: Readonly<Record<ApiHostId, HostIdentity>> = {
  'docs-rs': { name: 'docs.rs', hostname: 'docs.rs', icon: 'docsrs' },
  'pkg-go-dev': { name: 'pkg.go.dev', hostname: 'pkg.go.dev', icon: 'go' },
  'javadoc-io': { name: 'javadoc.io', hostname: 'javadoc.io', icon: 'javadoc' },
  // The package page wears the Swift mark; its DocC reference wears a document, so the two chips differ at icon size.
  'swift-package-index': { name: 'Swift Package Index', hostname: 'swiftpackageindex.com', icon: 'docc' },
}

export type InventoryProduct = 'core' | DocProduct

export interface InventoryEntry {
  /** Unique within its port. */
  id: string
  kind: InventoryKind
  /** The documentation product the entry belongs to; it orders rows. */
  product: InventoryProduct
  /**
   * The ecosystem's own word for the entry where `kind` is too coarse: a Go
   * module and a Go package, a Swift product and a Swift target. It leads the
   * row's detail line and is searchable.
   */
  unit?: string
  /**
   * The distribution this entry ships inside, by id, when it is not one of
   * its own: a Go package in its module, a Swift target in its package.
   */
  within?: string
  /** What a reader calls it. */
  label: string
  /** The name a resolver, build tool or compiler uses; `label` when they agree. */
  coordinate: string
  /** What code imports or a shell runs, when that differs from the coordinate. */
  aliases: readonly string[]
  /** Owning repository, `owner/name`. */
  repo: string
  /** Directory within that repository; absent opens the repository itself. */
  path?: string
  /** Branch of `path`. */
  ref: string
  /** The page that names this package on its registry. */
  package?: { host: PackageHostId; url: string }
  /** An API reference hosted off site. */
  api?: { host: ApiHostId; url: string; /** What the host calls the output when it is not Javadoc, such as Dokka. */ tool?: string }
  /**
   * The entry whose `api` is this entry's reference, when the entry is a
   * package that documents none of its own: a Swift package's reference is
   * the DocC of its main module.
   */
  reference?: string
  status: PublicationStatus
  /** Why a configured or planned entry has no link. */
  note?: string
  /**
   * Destinations the entry's ecosystem suggests but the host does not serve.
   * They are never linked. The verifier requests them and expects a failure, so
   * the day a host starts serving one it reports that the destination can move
   * to `package` or `api`.
   */
  unavailable?: readonly Candidate[]
}

export interface Candidate {
  kind: 'package' | 'api'
  /** The host's name, which need not be one the site links to. */
  host: string
  url: string
  reason: string
}

type Draft = Omit<InventoryEntry, 'aliases' | 'ref' | 'status' | 'coordinate' | 'repo'>
  & Partial<Pick<InventoryEntry, 'aliases' | 'ref' | 'status' | 'coordinate'>>

/** Entries of one repository share its name, branch and default status. */
function family(repo: string, ref = 'master') {
  return (draft: Draft & { repo?: string }): InventoryEntry => ({
    aliases: [], status: 'published', coordinate: draft.label, ref, repo, ...draft,
  })
}

type Located = Pick<InventoryEntry, 'coordinate' | 'package'>
const pypi = (name: string): Located => ({ coordinate: name, package: { host: 'pypi', url: `https://pypi.org/project/${name}/` } })
const rubygem = (name: string): Located => ({ coordinate: name, package: { host: 'rubygems', url: `https://rubygems.org/gems/${name}` } })
const luarock = (name: string): Located => ({ coordinate: name, package: { host: 'luarocks', url: `https://luarocks.org/modules/tony/${name}` } })
const gallery = (name: string): Located => ({ coordinate: name, package: { host: 'powershell-gallery', url: `https://www.powershellgallery.com/packages/${name}` } })
const npm = (name: string): Located => ({ coordinate: name, package: { host: 'npm', url: `https://www.npmjs.com/package/${name}` } })
const nuget = (name: string): Located => ({ coordinate: name, package: { host: 'nuget', url: `https://www.nuget.org/packages/${name}` } })
const crate = (name: string): Located & Pick<InventoryEntry, 'api'> => ({
  coordinate: name,
  package: { host: 'crates', url: `https://crates.io/crates/${name}` },
  api: { host: 'docs-rs', url: `https://docs.rs/${name}` },
})
/** pkg.go.dev serves a path as both the package page and its API reference. */
const pkgsite = (path: string): Located & Pick<InventoryEntry, 'api'> => ({
  coordinate: path,
  package: { host: 'pkg-go-dev', url: `https://pkg.go.dev/${path}` },
  api: { host: 'pkg-go-dev', url: `https://pkg.go.dev/${path}` },
})
const MAVEN_GROUP = 'io.github.libtmux'
const central = (artifact: string): Located => ({
  coordinate: `${MAVEN_GROUP}:${artifact}`,
  package: { host: 'maven-central', url: `https://central.sonatype.com/artifact/${MAVEN_GROUP}/${artifact}` },
})
const javadoc = (artifact: string, tool?: string): Pick<InventoryEntry, 'api'> => ({
  api: { host: 'javadoc-io', url: `https://javadoc.io/doc/${MAVEN_GROUP}/${artifact}`, ...(tool && { tool }) },
})

const SPI = 'https://swiftpackageindex.com/libtmux/libtmux-swift'
const spiPackage: Located = { coordinate: 'libtmux-swift', package: { host: 'swift-package-index', url: SPI } }
/** DocC output for one target; the index lowercases the module name. */
const spiTarget = (target: string): Pick<InventoryEntry, 'api'> => ({
  api: { host: 'swift-package-index', url: `${SPI}/documentation/${target.toLowerCase()}`, tool: 'DocC' },
})

const PY = 'tmux-python/libtmux'
const py = family(PY)
const tmuxp = family('tmux-python/tmuxp')
const pyMcp = family('tmux-python/libtmux-mcp', 'main')
const ruby = family('libtmux/libtmux-ruby')
const lua = family('libtmux/libtmux-lua')
const powershell = family('libtmux/libtmux-powershell')
const julia = family('libtmux/libtmux-julia')
const ts = family('libtmux/libtmux-ts')
const rs = family('libtmux/libtmux-rs')
const go = family('libtmux/libtmux-go')
const jvm = family('libtmux/libtmux-java')
const dotnet = family('libtmux/libtmux-dotnet')
const cxx = family('libtmux/libtmux-cxx')
const swift = family('libtmux/libtmux-swift')

export type DestinationKind = 'source' | 'package' | 'api'

/** One URL an entry may be reached at, and the host that serves it. */
export interface Destination {
  kind: DestinationKind
  url: string
  host: string
}

/** The entry's directory on GitHub, or its repository when it owns no directory. */
export function sourceUrl({ repo, path, ref }: Pick<InventoryEntry, 'repo' | 'path' | 'ref'>): string {
  return path ? `https://github.com/${repo}/tree/${encodeURIComponent(ref)}/${path}` : `https://github.com/${repo}`
}

/** The destinations an entry's ecosystem suggests and its hosts do not serve. */
export function entryCandidates(entry: InventoryEntry): Destination[] {
  return (entry.unavailable ?? []).map(({ kind, url, host }) => ({ kind, url, host }))
}

/** Every destination an entry names, whatever its status; callers decide which statuses to follow. */
export function entryDestinations(entry: InventoryEntry): Destination[] {
  return [
    { kind: 'source', url: sourceUrl(entry), host: 'github' },
    ...(entry.package ? [{ kind: 'package' as const, url: entry.package.url, host: entry.package.host }] : []),
    ...(entry.api ? [{ kind: 'api' as const, url: entry.api.url, host: entry.api.host }] : []),
  ]
}

const GO = 'github.com/libtmux/libtmux-go'

/**
 * Per port, the library first and then its repository, companions, commands and
 * testing products in the order a reader reaches for them.
 */
export const INVENTORY: Readonly<Record<string, readonly InventoryEntry[]>> = {
  py: [
    py({ id: 'libtmux', kind: 'library', product: 'core', label: 'libtmux', ...pypi('libtmux'), aliases: ['libtmux'] }),
    // The pytest plugin is an entry point of the libtmux distribution, not a package of its own.
    py({ id: 'pytest-plugin', kind: 'testing', product: 'core', unit: 'plugin', within: 'libtmux', label: 'pytest plugin',
      ...pypi('libtmux'), aliases: ['libtmux.pytest_plugin', 'pytest11', 'pytest'] }),
    py({ id: 'test-module', kind: 'testing', product: 'core', unit: 'module', within: 'libtmux', label: 'libtmux.test',
      ...pypi('libtmux'), coordinate: 'libtmux.test', path: 'src/libtmux/test', aliases: ['libtmux.test'] }),
    // A library and a command: judged by its role. Each companion has a repository of its own, so its root is listed beside its package.
    tmuxp({ id: 'tmuxp', kind: 'companion', product: 'workspace', label: 'tmuxp', ...pypi('tmuxp'), path: 'src/tmuxp', aliases: ['tmuxp'] }),
    tmuxp({ id: 'tmuxp-repository', kind: 'source', product: 'workspace', label: 'tmuxp', coordinate: 'tmux-python/tmuxp' }),
    pyMcp({ id: 'libtmux-mcp', kind: 'mcp-server', product: 'mcp', label: 'libtmux-mcp', ...pypi('libtmux-mcp'),
      path: 'src/libtmux_mcp', aliases: ['libtmux_mcp'] }),
    pyMcp({ id: 'libtmux-mcp-repository', kind: 'source', product: 'mcp', label: 'libtmux-mcp', coordinate: 'tmux-python/libtmux-mcp' }),
  ],
  ruby: [
    ruby({ id: 'libtmux', kind: 'library', product: 'core', label: 'libtmux', ...rubygem('libtmux'), path: 'gems/libtmux',
      aliases: ['libtmux'] }),
    ruby({ id: 'repository', kind: 'source', product: 'core', label: 'libtmux-ruby', coordinate: 'libtmux/libtmux-ruby' }),
    ruby({ id: 'libtmux-async', kind: 'companion', product: 'core', label: 'libtmux-async', ...rubygem('libtmux-async'),
      path: 'gems/libtmux-async', aliases: ['libtmux/async'] }),
    ruby({ id: 'libtmux-mcp', kind: 'mcp-server', product: 'mcp', label: 'libtmux-mcp', ...rubygem('libtmux-mcp'),
      path: 'gems/libtmux-mcp', aliases: ['libtmux/mcp'] }),
    ruby({ id: 'libtmux-workspace', kind: 'companion', product: 'workspace', label: 'libtmux-workspace', ...rubygem('libtmux-workspace'),
      path: 'gems/libtmux-workspace', aliases: ['libtmux/workspace'] }),
  ],
  lua: [
    lua({ id: 'libtmux', kind: 'library', product: 'core', label: 'libtmux', ...luarock('libtmux'), aliases: ['libtmux'] }),
    // Development rockspecs the publish workflow does not upload.
    lua({ id: 'libtmux-mcp', kind: 'mcp-server', product: 'mcp', label: 'libtmux-mcp', coordinate: 'libtmux-mcp',
      status: 'planned', note: 'Only a development rockspec exists; the release workflow uploads libtmux alone.',
      unavailable: [{ kind: 'package', host: 'luarocks', url: 'https://luarocks.org/modules/tony/libtmux-mcp', reason: 'not uploaded' }] }),
    lua({ id: 'libtmux-workspace', kind: 'companion', product: 'workspace', label: 'libtmux-workspace', coordinate: 'libtmux-workspace',
      status: 'planned', note: 'Only a development rockspec exists; the release workflow uploads libtmux alone.',
      unavailable: [{ kind: 'package', host: 'luarocks', url: 'https://luarocks.org/modules/tony/libtmux-workspace', reason: 'not uploaded' }] }),
  ],
  powershell: [
    powershell({ id: 'LibTmux', kind: 'library', product: 'core', label: 'LibTmux', ...gallery('LibTmux'),
      path: 'src/LibTmux.PowerShell', aliases: ['Import-Module LibTmux'] }),
    powershell({ id: 'repository', kind: 'source', product: 'core', label: 'libtmux-powershell',
      coordinate: 'libtmux/libtmux-powershell' }),
    // The module manifest exports cmdlets and no command.
    powershell({ id: 'LibTmux.Workspace', kind: 'companion', product: 'workspace', label: 'LibTmux.Workspace',
      ...gallery('LibTmux.Workspace'), path: 'src/LibTmux.Workspace.PowerShell', aliases: ['Import-Module LibTmux.Workspace'] }),
  ],
  julia: [
    // None of the three packages is registered in General; they install from the repository by URL and subdirectory.
    julia({ id: 'LibTmux', kind: 'library', product: 'core', unit: 'package', label: 'LibTmux', path: 'src', aliases: ['using LibTmux'] }),
    julia({ id: 'repository', kind: 'source', product: 'core', label: 'libtmux-julia', coordinate: 'libtmux/libtmux-julia' }),
    // Defined in src/criteria.jl and loaded with LibTmux.
    julia({ id: 'LibTmux.Filters', kind: 'module', product: 'core', unit: 'module', within: 'LibTmux', label: 'LibTmux.Filters',
      path: 'src', aliases: ['using LibTmux.Filters'] }),
    // Package extensions, loaded when JSON or Tables is.
    julia({ id: 'LibTmuxJSONExt', kind: 'module', product: 'core', unit: 'extension', within: 'LibTmux', label: 'LibTmuxJSONExt',
      path: 'ext', aliases: ['JSON'] }),
    julia({ id: 'LibTmuxTablesExt', kind: 'module', product: 'core', unit: 'extension', within: 'LibTmux', label: 'LibTmuxTablesExt',
      path: 'ext', aliases: ['Tables'] }),
    julia({ id: 'LibTmuxMCP', kind: 'mcp-server', product: 'mcp', unit: 'package', label: 'LibTmuxMCP', path: 'packages/LibTmuxMCP',
      aliases: ['using LibTmuxMCP', 'libtmux-mcp'] }),
    julia({ id: 'LibTmuxWorkspace', kind: 'companion', product: 'workspace', unit: 'package', label: 'LibTmuxWorkspace',
      path: 'packages/LibTmuxWorkspace', aliases: ['using LibTmuxWorkspace', 'libtmux-workspace'] }),
  ],
  ts: [
    ts({ id: 'libtmux', kind: 'library', product: 'core', label: 'libtmux', ...npm('libtmux'), path: 'packages/libtmux',
      aliases: ['libtmux'] }),
    ts({ id: 'repository', kind: 'source', product: 'core', label: 'libtmux-ts', coordinate: 'libtmux/libtmux-ts' }),
    // A subpath export of libtmux, not a distribution.
    ts({ id: 'libtmux-testing', kind: 'testing', product: 'core', unit: 'export', within: 'libtmux', label: 'libtmux/testing', ...npm('libtmux'),
      path: 'packages/libtmux', coordinate: 'libtmux/testing', aliases: ['libtmux/testing'] }),
    ts({ id: 'mcp', kind: 'mcp-server', product: 'mcp', label: '@libtmux/mcp', ...npm('@libtmux/mcp'), path: 'packages/mcp',
      aliases: ['libtmux-mcp'] }),
    ts({ id: 'workspace', kind: 'companion', product: 'workspace', label: '@libtmux/workspace', ...npm('@libtmux/workspace'),
      path: 'packages/workspace', aliases: ['@libtmux/workspace/config', '@libtmux/workspace/ownership'] }),
    ts({ id: 'workspace-cli', kind: 'cli', product: 'workspace', label: '@libtmux/workspace-cli', ...npm('@libtmux/workspace-cli'),
      path: 'packages/workspace-cli', aliases: ['tmux-workspace'] }),
  ],
  rs: [
    rs({ id: 'libtmux', kind: 'library', product: 'core', label: 'libtmux', ...crate('libtmux'), path: 'crates/libtmux',
      aliases: ['libtmux'] }),
    rs({ id: 'repository', kind: 'source', product: 'core', label: 'libtmux-rs', coordinate: 'libtmux/libtmux-rs' }),
    rs({ id: 'libtmux-macros', kind: 'companion', product: 'core', label: 'libtmux-macros', ...crate('libtmux-macros'),
      path: 'crates/libtmux-macros', aliases: ['libtmux_macros'] }),
    rs({ id: 'tmux-mcp', kind: 'mcp-server', product: 'mcp', label: 'tmux-mcp', ...crate('tmux-mcp'), path: 'crates/tmux-mcp',
      aliases: ['tmux_mcp'] }),
    rs({ id: 'tmux-workspace', kind: 'companion', product: 'workspace', label: 'tmux-workspace', ...crate('tmux-workspace'),
      path: 'crates/tmux-workspace', aliases: ['tmux_workspace'] }),
  ],
  go: [
    go({ id: 'tmux', kind: 'library', product: 'core', unit: 'package', within: 'module', label: 'tmux', ...pkgsite(`${GO}/tmux`),
      path: 'tmux', aliases: ['tmux'] }),
    go({ id: 'repository', kind: 'source', product: 'core', label: 'libtmux-go', coordinate: GO }),
    // The root module versions tmux, tmuxq and tmux/tmuxtest together; mcp and workspace have their own go.mod and tags.
    go({ id: 'module', kind: 'module', product: 'core', unit: 'module', label: 'libtmux-go', ...pkgsite(GO) }),
    go({ id: 'tmuxq', kind: 'companion', product: 'core', unit: 'package', within: 'module', label: 'tmuxq', ...pkgsite(`${GO}/tmuxq`),
      path: 'tmuxq', aliases: ['tmuxq'] }),
    go({ id: 'tmuxtest', kind: 'testing', product: 'core', unit: 'package', within: 'module', label: 'tmux/tmuxtest',
      ...pkgsite(`${GO}/tmux/tmuxtest`), path: 'tmux/tmuxtest', aliases: ['tmuxtest'] }),
    go({ id: 'mcp', kind: 'mcp-server', product: 'mcp', unit: 'module', label: 'mcp', ...pkgsite(`${GO}/mcp`), path: 'mcp' }),
    go({ id: 'libtmux-mcp', kind: 'cli', product: 'mcp', unit: 'command', within: 'mcp', label: 'libtmux-mcp',
      ...pkgsite(`${GO}/mcp/cmd/libtmux-mcp`), path: 'mcp/cmd/libtmux-mcp' }),
    go({ id: 'workspace', kind: 'companion', product: 'workspace', unit: 'module', label: 'workspace', ...pkgsite(`${GO}/workspace`),
      path: 'workspace' }),
    go({ id: 'tmux-workspace', kind: 'cli', product: 'workspace', unit: 'command', within: 'workspace', label: 'tmux-workspace',
      ...pkgsite(`${GO}/workspace/cmd/tmux-workspace`), path: 'workspace/cmd/tmux-workspace' }),
  ],
  java: [
    jvm({ id: 'libtmux', kind: 'library', product: 'core', label: 'libtmux', ...central('libtmux'), ...javadoc('libtmux'),
      path: 'libtmux', aliases: ['io.github.libtmux'] }),
    jvm({ id: 'repository', kind: 'source', product: 'core', label: 'libtmux-java', coordinate: 'libtmux/libtmux-java' }),
    // A platform artifact: it names versions and ships no classes, so javadoc.io lists its versions and nothing else.
    jvm({ id: 'libtmux-bom', kind: 'companion', product: 'core', unit: 'BOM', label: 'libtmux-bom', ...central('libtmux-bom'),
      path: 'libtmux-bom', aliases: ['BOM', 'platform'],
      unavailable: [{ kind: 'api', host: 'javadoc-io', url: 'https://javadoc.io/doc/io.github.libtmux/libtmux-bom', reason: 'no documentation jar' }] }),
    jvm({ id: 'libtmux-jackson', kind: 'companion', product: 'core', label: 'libtmux-jackson', ...central('libtmux-jackson'),
      ...javadoc('libtmux-jackson'), path: 'libtmux-jackson', aliases: ['io.github.libtmux.jackson'] }),
    jvm({ id: 'libtmux-junit5', kind: 'testing', product: 'core', label: 'libtmux-junit5', ...central('libtmux-junit5'),
      ...javadoc('libtmux-junit5'), path: 'libtmux-junit5', aliases: ['io.github.libtmux.junit5', 'JUnit'] }),
    jvm({ id: 'libtmux-kotlin', kind: 'companion', product: 'core', label: 'libtmux-kotlin', ...central('libtmux-kotlin'),
      ...javadoc('libtmux-kotlin', 'Dokka'), path: 'libtmux-kotlin', aliases: ['io.github.libtmux.kotlin'] }),
    jvm({ id: 'libtmux-scala', kind: 'companion', product: 'core', label: 'libtmux-scala_3', ...central('libtmux-scala_3'),
      ...javadoc('libtmux-scala_3', 'Scaladoc'), path: 'libtmux-scala', aliases: ['libtmux-scala', 'io.github.libtmux.scaladsl'] }),
    jvm({ id: 'libtmux-scala-cats', kind: 'companion', product: 'core', label: 'libtmux-scala-cats_3',
      ...central('libtmux-scala-cats_3'), ...javadoc('libtmux-scala-cats_3', 'Scaladoc'), path: 'libtmux-scala-cats',
      aliases: ['libtmux-scala-cats', 'io.github.libtmux.scaladsl.cats', 'Cats Effect'] }),
    jvm({ id: 'libtmux-scala-ox', kind: 'companion', product: 'core', label: 'libtmux-scala-ox_3',
      ...central('libtmux-scala-ox_3'), ...javadoc('libtmux-scala-ox_3', 'Scaladoc'), path: 'libtmux-scala-ox',
      aliases: ['libtmux-scala-ox', 'io.github.libtmux.scaladsl.ox', 'Ox'] }),
    jvm({ id: 'libtmux-mcp', kind: 'mcp-server', product: 'mcp', label: 'libtmux-mcp', ...central('libtmux-mcp'),
      ...javadoc('libtmux-mcp'), path: 'libtmux-mcp', aliases: ['io.github.libtmux.mcp'] }),
    jvm({ id: 'libtmux-workspace', kind: 'companion', product: 'workspace', label: 'libtmux-workspace',
      ...central('libtmux-workspace'), ...javadoc('libtmux-workspace'), path: 'libtmux-workspace',
      aliases: ['io.github.libtmux.workspace'] }),
    jvm({ id: 'libtmux-workspace-cli', kind: 'cli', product: 'workspace', label: 'libtmux-workspace-cli',
      ...central('libtmux-workspace-cli'), path: 'libtmux-workspace-cli', aliases: ['tmux-workspace'],
      unavailable: [{ kind: 'api', host: 'javadoc-io', url: 'https://javadoc.io/doc/io.github.libtmux/libtmux-workspace-cli',
        reason: 'javadoc.io lists versions and has no documentation for this artifact' }] }),
  ],
  kotlin: [
    jvm({ id: 'libtmux-kotlin', kind: 'library', product: 'core', label: 'libtmux-kotlin', ...central('libtmux-kotlin'),
      ...javadoc('libtmux-kotlin', 'Dokka'), path: 'libtmux-kotlin', aliases: ['io.github.libtmux.kotlin'] }),
    jvm({ id: 'repository', kind: 'source', product: 'core', label: 'libtmux-java', coordinate: 'libtmux/libtmux-java' }),
    // The Kotlin facade depends on the Java library, which keeps its own repository directory and release.
    jvm({ id: 'libtmux', kind: 'companion', product: 'core', label: 'libtmux', ...central('libtmux'), ...javadoc('libtmux'),
      path: 'libtmux', aliases: ['io.github.libtmux'] }),
  ],
  scala: [
    jvm({ id: 'libtmux-scala', kind: 'library', product: 'core', label: 'libtmux-scala_3', ...central('libtmux-scala_3'),
      ...javadoc('libtmux-scala_3', 'Scaladoc'), path: 'libtmux-scala', aliases: ['libtmux-scala', 'io.github.libtmux.scaladsl'] }),
    jvm({ id: 'repository', kind: 'source', product: 'core', label: 'libtmux-java', coordinate: 'libtmux/libtmux-java' }),
    jvm({ id: 'libtmux-scala-cats', kind: 'companion', product: 'core', label: 'libtmux-scala-cats_3',
      ...central('libtmux-scala-cats_3'), ...javadoc('libtmux-scala-cats_3', 'Scaladoc'), path: 'libtmux-scala-cats',
      aliases: ['libtmux-scala-cats', 'io.github.libtmux.scaladsl.cats', 'Cats Effect'] }),
    jvm({ id: 'libtmux-scala-ox', kind: 'companion', product: 'core', label: 'libtmux-scala-ox_3',
      ...central('libtmux-scala-ox_3'), ...javadoc('libtmux-scala-ox_3', 'Scaladoc'), path: 'libtmux-scala-ox',
      aliases: ['libtmux-scala-ox', 'io.github.libtmux.scaladsl.ox', 'Ox'] }),
    jvm({ id: 'libtmux', kind: 'companion', product: 'core', label: 'libtmux', ...central('libtmux'), ...javadoc('libtmux'),
      path: 'libtmux', aliases: ['io.github.libtmux'] }),
  ],
  csharp: [
    dotnet({ id: 'LibTmux', kind: 'library', product: 'core', label: 'LibTmux', ...nuget('LibTmux'), path: 'src/LibTmux',
      aliases: ['LibTmux'] }),
    dotnet({ id: 'repository', kind: 'source', product: 'core', label: 'libtmux-dotnet', coordinate: 'libtmux/libtmux-dotnet' }),
    dotnet({ id: 'LibTmux.Query.Json', kind: 'companion', product: 'core', label: 'LibTmux.Query.Json',
      ...nuget('LibTmux.Query.Json'), path: 'src/LibTmux.Query.Json' }),
    dotnet({ id: 'LibTmux.Extensions.DependencyInjection', kind: 'companion', product: 'core',
      label: 'LibTmux.Extensions.DependencyInjection', ...nuget('LibTmux.Extensions.DependencyInjection'),
      path: 'src/LibTmux.Extensions.DependencyInjection' }),
    dotnet({ id: 'LibTmux.Testing', kind: 'testing', product: 'core', label: 'LibTmux.Testing', ...nuget('LibTmux.Testing'),
      path: 'src/LibTmux.Testing' }),
    dotnet({ id: 'LibTmux.FSharp', kind: 'companion', product: 'core', label: 'LibTmux.FSharp', ...nuget('LibTmux.FSharp'),
      path: 'src/LibTmux.FSharp' }),
    dotnet({ id: 'LibTmux.Mcp', kind: 'mcp-server', product: 'mcp', label: 'LibTmux.Mcp', ...nuget('LibTmux.Mcp'),
      path: 'src/LibTmux.Mcp', aliases: ['libtmux-mcp'] }),
    dotnet({ id: 'LibTmux.Workspace', kind: 'companion', product: 'workspace', label: 'LibTmux.Workspace',
      ...nuget('LibTmux.Workspace'), path: 'src/LibTmux.Workspace' }),
    dotnet({ id: 'LibTmux.Workspace.Cli', kind: 'cli', product: 'workspace', label: 'LibTmux.Workspace.Cli',
      ...nuget('LibTmux.Workspace.Cli'), path: 'src/LibTmux.Workspace.Cli', aliases: ['tmux-workspace'] }),
  ],
  fsharp: [
    dotnet({ id: 'LibTmux.FSharp', kind: 'library', product: 'core', label: 'LibTmux.FSharp', ...nuget('LibTmux.FSharp'),
      path: 'src/LibTmux.FSharp', aliases: ['LibTmux.FSharp'] }),
    dotnet({ id: 'repository', kind: 'source', product: 'core', label: 'libtmux-dotnet', coordinate: 'libtmux/libtmux-dotnet' }),
    // The F# package pins the C# library it wraps, which has its own package page and release.
    dotnet({ id: 'LibTmux', kind: 'companion', product: 'core', label: 'LibTmux', ...nuget('LibTmux'), path: 'src/LibTmux',
      aliases: ['LibTmux'] }),
  ],
  cxx: [
    // Served from this project's own vcpkg registry, so the repository is the registry and no host page exists.
    cxx({ id: 'libtmux', kind: 'library', product: 'core', unit: 'vcpkg port', label: 'libtmux', aliases: ['find_package(libtmux)'],
      unavailable: [
        { kind: 'package', host: 'vcpkg', url: 'https://vcpkg.io/en/package/libtmux', reason: 'not in the curated registry' },
        { kind: 'package', host: 'conan-center', url: 'https://conan.io/center/recipes/libtmux', reason: 'no Conan recipe' },
      ] }),
    cxx({ id: 'repository', kind: 'source', product: 'core', label: 'libtmux-cxx', coordinate: 'libtmux/libtmux-cxx' }),
    cxx({ id: 'vcpkg-registry', kind: 'source', product: 'core', unit: 'registry', label: 'vcpkg port', coordinate: 'libtmux (vcpkg)',
      path: 'ports/libtmux', aliases: ['vcpkg', 'registry', 'vcpkg-configuration.json'] }),
    cxx({ id: 'libtmux-target', kind: 'target', product: 'core', unit: 'target', within: 'libtmux', label: 'libtmux::libtmux',
      path: 'src', aliases: ['target_link_libraries', 'CMake'] }),
    cxx({ id: 'libtmux-testing', kind: 'testing', product: 'core', unit: 'component', within: 'libtmux', label: 'libtmux::testing',
      path: 'src/testing', aliases: ['COMPONENTS testing', 'CMake'] }),
    cxx({ id: 'libtmux-mcp-server', kind: 'cli', product: 'mcp', unit: 'executable', within: 'libtmux', label: 'libtmux-mcp-server',
      path: 'apps/mcp', aliases: ['vcpkg feature mcp', 'libtmux-mcp'] }),
    cxx({ id: 'tmux-workspace', kind: 'cli', product: 'workspace', unit: 'executable', within: 'libtmux', label: 'tmux-workspace',
      path: 'apps/workspace', aliases: ['workspace-cli'] }),
  ],
  // One package of six targets, exposed as four library products and two executables.
  swift: [
    swift({ id: 'libtmux-swift', kind: 'library', product: 'core', unit: 'package', label: 'libtmux-swift', ...spiPackage,
      reference: 'target:LibTmux', aliases: ['libtmux'] }),
    swift({ id: 'target:LibTmux', kind: 'target', product: 'core', unit: 'target', within: 'libtmux-swift', label: 'LibTmux',
      coordinate: 'LibTmux', ...spiTarget('LibTmux'), path: 'Sources/LibTmux' }),
    swift({ id: 'product:LibTmux', kind: 'module', product: 'core', unit: 'product', within: 'libtmux-swift', label: 'LibTmux',
      ...spiPackage, coordinate: 'LibTmux', path: 'Sources/LibTmux', aliases: ['import LibTmux'] }),
    swift({ id: 'target:TmuxFixture', kind: 'target', product: 'core', unit: 'target', within: 'libtmux-swift', label: 'TmuxFixture',
      coordinate: 'TmuxFixture', path: 'Tests/TmuxFixture' }),
    swift({ id: 'product:TmuxFixture', kind: 'testing', product: 'core', unit: 'product', within: 'libtmux-swift', label: 'TmuxFixture',
      ...spiPackage, coordinate: 'TmuxFixture', path: 'Tests/TmuxFixture', aliases: ['import TmuxFixture'] }),
    swift({ id: 'target:LibTmuxMCP', kind: 'target', product: 'mcp', unit: 'target', within: 'libtmux-swift', label: 'LibTmuxMCP',
      coordinate: 'LibTmuxMCP', ...spiTarget('LibTmuxMCP'), path: 'Sources/LibTmuxMCP' }),
    swift({ id: 'product:LibTmuxMCP', kind: 'module', product: 'mcp', unit: 'product', within: 'libtmux-swift', label: 'LibTmuxMCP',
      ...spiPackage, coordinate: 'LibTmuxMCP', path: 'Sources/LibTmuxMCP', aliases: ['import LibTmuxMCP'] }),
    swift({ id: 'target:libtmux-mcp', kind: 'target', product: 'mcp', unit: 'executable target', within: 'libtmux-swift',
      label: 'libtmux-mcp', coordinate: 'libtmux-mcp', path: 'Sources/libtmux-mcp' }),
    swift({ id: 'product:libtmux-mcp', kind: 'cli', product: 'mcp', unit: 'executable product', within: 'libtmux-swift', label: 'libtmux-mcp',
      ...spiPackage, coordinate: 'libtmux-mcp', path: 'Sources/libtmux-mcp' }),
    swift({ id: 'target:TmuxWorkspace', kind: 'target', product: 'workspace', unit: 'target', within: 'libtmux-swift',
      label: 'TmuxWorkspace', coordinate: 'TmuxWorkspace', ...spiTarget('TmuxWorkspace'), path: 'Sources/TmuxWorkspace' }),
    swift({ id: 'product:TmuxWorkspace', kind: 'module', product: 'workspace', unit: 'product', within: 'libtmux-swift',
      label: 'TmuxWorkspace', ...spiPackage, coordinate: 'TmuxWorkspace', path: 'Sources/TmuxWorkspace', aliases: ['import TmuxWorkspace'] }),
    swift({ id: 'target:TmuxWorkspaceCLI', kind: 'target', product: 'workspace', unit: 'executable target', within: 'libtmux-swift',
      label: 'TmuxWorkspaceCLI', coordinate: 'TmuxWorkspaceCLI', path: 'Sources/TmuxWorkspaceCLI' }),
    swift({ id: 'product:tmux-workspace', kind: 'cli', product: 'workspace', unit: 'executable product', within: 'libtmux-swift',
      label: 'tmux-workspace', ...spiPackage, coordinate: 'tmux-workspace', path: 'Sources/TmuxWorkspaceCLI' }),
  ],
}
