/** Port identities, source locations, renderers, and documentation URLs. */

// build-site.sh imports this module with bare Node; local imports need `.ts`.
import { withPortRoot } from './site-root.ts'
import type { TagGrammar } from './versions.ts'


/**
 * Which renderer produces a self-hosted reference.
 * `none` for ports whose reference lives on an ecosystem host.
 */
export type Renderer = 'sphinx' | 'astro' | 'native-skinned' | 'none'

/** Documentation products layered on each language library. */
export const DOC_PRODUCTS = {
  workspace: { label: 'Workspace Manager', description: 'Define and build tmux sessions from workspace configuration.' },
  mcp: { label: 'MCP', description: 'Connect an MCP client to tmux tools and inspect the server API.' },
} as const

export type DocProduct = keyof typeof DOC_PRODUCTS

/**
 * Where a port's package is published, for the links row on its pages.
 *
 * One entry per port, not a list: a reader looking for "where do I get this"
 * wants the registry their toolchain resolves from, and every port has exactly
 * one of those. The ports with no such place say so by having none — C++ is
 * served from this project's own vcpkg git registry rather than the curated
 * one, and Swift resolves from the git URL, so for both of them the repository
 * link already is the distribution link.
 */
export interface PackageRegistry {
  /** Display name, e.g. "PyPI". */
  name: string
  /** This package's page on that registry. */
  url: string
  /** Which mark `components/icons/RegistryIcon.astro` draws. */
  icon: 'pypi' | 'npm' | 'crates' | 'go' | 'maven' | 'nuget'
}

export interface EcosystemHost {
  /** Display name, e.g. "docs.rs". */
  name: string
  /** Landing URL for the port's docs on that host. */
  url: string
  /** Description shown beside the ecosystem reference link. */
  rationale: string
}

export interface Port {
  /** URL segment under the site root, e.g. `py` in /py/stable/. */
  slug: string
  /** Human name for nav and headings. */
  name: string
  /** Language shown in the port switcher. */
  language: string
  /** Package name users install. */
  packageName: string
  /** Source repository, `owner/name`. */
  repo: string
  /** Working checkout, for the build script. Tilde-relative. */
  checkout: string
  /** Where the docs-branch worktree lives. Tilde-relative. */
  worktree: string
  /** Whether this port has a documentation tree for each supported version. */
  versionedDocs: boolean
  /** Installed command that loads a workspace file, when this port has one. */
  workspaceCli?: string
  /**
   * How this port writes its version tags. Python follows PEP 440, which
   * attaches a suffix with no separator and has post-releases; the rest
   * follow SemVer. Reading one with the other's grammar drops the tag.
   */
  tagGrammar: TagGrammar
  renderer: Renderer
  /**
   * Whether this port's own documentation pipeline publishes
   * `<slug>/<version>/api/`. This repository assembles that tree to measure
   * style parity against and must never publish it or anything over it. Every
   * other port answers that path with a redirect to the reference this site
   * renders, which it does publish.
   */
  publishesOwnApi?: boolean
  /** An ecosystem-hosted reference offered alongside the reference on this site. */
  ecosystemHost?: EcosystemHost
  /**
   * Where a self-hosted reference is generated from, as a short label for
   * the build script and the docs. Empty for ecosystem ports.
   */
  generator: string
  /** Shown on the port landing page. */
  install: string
  /** Where this port's package is published. */
  registry?: PackageRegistry
}

export const PORTS: readonly Port[] = [
  {
    slug: 'py',
    name: 'Python',
    language: 'Python',
    packageName: 'libtmux',
    workspaceCli: 'tmuxp load',
    repo: 'tmux-python/libtmux',
    checkout: '~/work/python/libtmux',
    worktree: '~/work/python/libtmux-python-docs',
    versionedDocs: true,
    tagGrammar: 'pep440',
    renderer: 'sphinx',
    publishesOwnApi: true,
    generator: 'Sphinx + sphinx-gp-theme',
    install: 'pip install libtmux',
    registry: { name: 'PyPI', url: 'https://pypi.org/project/libtmux/', icon: 'pypi' },
  },
  {
    slug: 'ts',
    name: 'TypeScript',
    language: 'TypeScript',
    packageName: '@libtmux/libtmux',
    repo: 'libtmux/libtmux-ts',
    checkout: '~/work/libtmux/libtmux-ts',
    worktree: '~/work/libtmux/libtmux-ts-docs',
    versionedDocs: true,
    tagGrammar: 'semver',
    renderer: 'astro',
    generator: '@microsoft/api-extractor JSON',
    install: 'bun add @libtmux/libtmux',
    registry: { name: 'npm', url: 'https://www.npmjs.com/package/libtmux', icon: 'npm' },
  },
  {
    slug: 'rs',
    name: 'Rust',
    language: 'Rust',
    packageName: 'libtmux',
    repo: 'libtmux/libtmux-rs',
    checkout: '~/work/libtmux/libtmux-rs',
    worktree: '~/work/libtmux/libtmux-rs-docs',
    versionedDocs: true,
    tagGrammar: 'semver',
    renderer: 'none',
    ecosystemHost: {
      name: 'docs.rs',
      url: 'https://docs.rs/libtmux',
      rationale:
        'Rust API documentation for published crate versions on docs.rs.',
    },
    generator: '',
    install: 'cargo add libtmux',
    registry: { name: 'crates.io', url: 'https://crates.io/crates/libtmux', icon: 'crates' },
  },
  {
    slug: 'go',
    name: 'Go',
    language: 'Go',
    packageName: 'github.com/libtmux/libtmux-go/tmux',
    repo: 'libtmux/libtmux-go',
    checkout: '~/work/libtmux/libtmux-go',
    worktree: '~/work/libtmux/libtmux-go-docs',
    versionedDocs: true,
    tagGrammar: 'semver',
    renderer: 'none',
    ecosystemHost: {
      name: 'pkg.go.dev',
      url: 'https://pkg.go.dev/github.com/libtmux/libtmux-go/tmux',
      rationale:
        'Go API documentation for published module versions on pkg.go.dev.',
    },
    generator: '',
    install: 'go get github.com/libtmux/libtmux-go',
    registry: { name: 'pkg.go.dev', url: 'https://pkg.go.dev/github.com/libtmux/libtmux-go/tmux', icon: 'go' },
  },
  {
    slug: 'java',
    name: 'Java',
    language: 'Java and Kotlin',
    packageName: 'io.github.libtmux:libtmux',
    repo: 'libtmux/libtmux-java',
    checkout: '~/work/libtmux/libtmux-java',
    worktree: '~/work/libtmux/libtmux-java-docs',
    versionedDocs: true,
    tagGrammar: 'semver',
    renderer: 'none',
    ecosystemHost: {
      name: 'javadoc.io',
      url: 'https://javadoc.io/doc/io.github.libtmux/libtmux',
      rationale:
        'Java API documentation from the Javadoc JAR published to Maven Central.',
    },
    generator: '',
    install: 'implementation("io.github.libtmux:libtmux:VERSION")',
    registry: { name: 'Maven Central', url: 'https://central.sonatype.com/artifact/io.github.libtmux/libtmux', icon: 'maven' },
  },
  {
    slug: 'dotnet',
    name: '.NET',
    language: 'C#',
    packageName: 'LibTmux',
    repo: 'libtmux/libtmux-dotnet',
    checkout: '~/work/libtmux/libtmux-dotnet',
    worktree: '~/work/libtmux/libtmux-dotnet-docs',
    versionedDocs: true,
    tagGrammar: 'semver',
    renderer: 'astro',
    generator: 'docfx metadata (--outputFormat markdown)',
    install: 'dotnet add package LibTmux',
    registry: { name: 'NuGet', url: 'https://www.nuget.org/packages/LibTmux', icon: 'nuget' },
  },
  {
    slug: 'cxx',
    name: 'C++',
    language: 'C++',
    packageName: 'libtmux-cxx',
    repo: 'libtmux/libtmux-cxx',
    checkout: '~/work/libtmux/libtmux-cxx',
    worktree: '~/work/libtmux/libtmux-cxx-docs',
    versionedDocs: true,
    tagGrammar: 'semver',
    renderer: 'sphinx',
    generator: 'Doxygen XML to Breathe to Sphinx',
    install: 'vcpkg install libtmux-cxx',
  },
  {
    slug: 'swift',
    name: 'Swift',
    language: 'Swift',
    packageName: 'libtmux-swift',
    repo: 'libtmux/libtmux-swift',
    checkout: '~/work/libtmux/libtmux-swift',
    worktree: '~/work/libtmux/libtmux-swift-docs',
    versionedDocs: true,
    tagGrammar: 'semver',
    renderer: 'native-skinned',
    generator: 'DocC (swift-docc-plugin)',
    install: '.package(url: "https://github.com/libtmux/libtmux-swift", from: "0.1.0")',
  },
] as const

export const PORT_BY_SLUG: Readonly<Record<string, Port>> = Object.fromEntries(
  PORTS.map((p) => [p.slug, p]),
)

/** User-facing workspace loaders are distinct from unfinished builder libraries. */
export function productInDevelopment(port: Port, product: DocProduct): boolean {
  return product === 'mcp' || !port.workspaceCli
}

export function productDescription(port: Port, product: DocProduct): string {
  if (product === 'workspace') return port.workspaceCli
    ? `Load workspace configuration files with ${port.workspaceCli}.`
    : 'In development. Workspace builder internals; no workspace loader CLI.'
  return `In development. ${DOC_PRODUCTS.mcp.description}`
}

/** Language APIs for workspace builders belong to implementation documentation. */
export function productApiPath(product: DocProduct): string {
  return product === 'workspace' ? 'workspace/internals/api' : 'mcp/api'
}

/** Ports that get a per-version documentation tree. */
export const VERSIONED_PORTS = PORTS.filter((p) => p.versionedDocs)

/** Ports whose language has a canonical reference of its own, too. */
export const ECOSYSTEM_PORTS = PORTS.filter((p) => p.ecosystemHost)

/** URL of the reference extracted and rendered by this site. */
export function referenceUrl(port: Port, _version?: string): string {
  return withPortRoot(`/reference/${port.slug}/`)
}

/** URL of a prose page within a port and version; callers check availability. */
export function portPageUrl(port: Port, version: string, pagePath = ''): string {
  const rest = pagePath.replace(/^\/+|\/+$/g, '')

  // Native API paths have no shared spelling; use the unified reference index.
  if (rest === 'api' || rest.startsWith('api/')) return referenceUrl(port, version)

  const tail = rest ? `${rest}/` : ''
  if (!port.versionedDocs) return withPortRoot(`/${port.slug}/${tail}`)
  return withPortRoot(`/${port.slug}/${version}/${tail}`)
}

/** Whether the port publishes a unified reference. */
export function hasReference(_port: Port): boolean {
  return true
}

/** Landing page for a port and version. */
export function portHomeUrl(port: Port, version: string): string {
  return withPortRoot(port.versionedDocs ? `/${port.slug}/${version}/` : `/${port.slug}/`)
}
