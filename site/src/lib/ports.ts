/** Port identities, source locations, renderers, and documentation URLs. */

// build-site.sh imports this module with bare Node; local imports need `.ts`.
import { withPortRoot, withRoot } from './site-root.ts'
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
  /**
   * How this port writes its version tags. Python follows PEP 440, which
   * attaches a suffix with no separator and has post-releases; the rest
   * follow SemVer. Reading one with the other's grammar drops the tag.
   */
  tagGrammar: TagGrammar
  renderer: Renderer
  /** An ecosystem-hosted reference offered alongside the reference on this site. */
  ecosystemHost?: EcosystemHost
  /**
   * Where a self-hosted reference is generated from, as a short label for
   * the build script and the docs. Empty for ecosystem ports.
   */
  generator: string
  /** Shown on the port landing page. */
  install: string
}

export const PORTS: readonly Port[] = [
  {
    slug: 'py',
    name: 'Python',
    language: 'Python',
    packageName: 'libtmux',
    repo: 'tmux-python/libtmux',
    checkout: '~/work/python/libtmux',
    worktree: '~/work/python/libtmux-python-docs',
    versionedDocs: true,
    tagGrammar: 'pep440',
    renderer: 'sphinx',
    generator: 'Sphinx + sphinx-gp-theme',
    install: 'pip install libtmux',
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
