/**
 * The eight libtmux ports — the single source of truth for the site.
 *
 * Nav, the port switcher, the sidebar scope, the parity table, sitemap
 * generation and the build script all read this file. Adding a port means
 * editing here and nowhere else.
 */

/** How a port's API reference reaches the reader. */
// Explicit `.ts`, unlike every other import in this project. build-site.sh's
// list_ports() imports this file with bare `node`, whose ESM resolver needs
// the extension; Vite does not care either way. Any future import added here
// needs the same, or the build dies before it renders a page.
import { withPortRoot, withRoot } from './site-root.ts'
import type { TagGrammar } from './versions.ts'


/**
 * Which renderer produces a self-hosted reference.
 * `none` for ports whose reference lives on an ecosystem host.
 */
export type Renderer = 'sphinx' | 'astro' | 'native-skinned' | 'none'

export interface EcosystemHost {
  /** Display name, e.g. "docs.rs". */
  name: string
  /** Landing URL for the port's docs on that host. */
  url: string
  /**
   * Why this host wins. Shown in the UI so the reader understands the
   * hand-off rather than experiencing it as a dead end.
   */
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
  /**
   * Whether this port gets a per-version documentation tree.
   *
   * A choice, not a limitation, and the distinction matters: `gen-versions`
   * finds 2 versions for Rust, 7 for Go and 9 for Java. They ship one
   * unversioned prose tree anyway. That fell out of `referenceMode:
   * 'ecosystem'` back when their reference was somewhere else, and it
   * survived the reference moving here; it is written down as its own field
   * so the next person changing it is changing a decision rather than a
   * side effect.
   */
  versionedDocs: boolean
  /**
   * How this port writes its version tags. Python follows PEP 440, which
   * attaches a suffix with no separator and has post-releases; the rest
   * follow SemVer. Reading one with the other's grammar drops the tag.
   */
  tagGrammar: TagGrammar
  renderer: Renderer
  /**
   * The canonical reference in that language's own ecosystem, where there is
   * one — docs.rs, pkg.go.dev, javadoc.io.
   *
   * Its presence is the whole of that fact; there is no second flag saying
   * the same thing. It no longer decides where a reader is sent: this site
   * extracts and renders a reference for all eight ports, and both are
   * offered.
   */
  ecosystemHost?: EcosystemHost
  /**
   * Where a self-hosted reference is generated from, as a short label for
   * the build script and the docs. Empty for ecosystem ports.
   */
  generator: string
  /** Shown on the port landing page. */
  install: string
}

/**
 * Policy, applied consistently below:
 *
 * Deep-link to an ecosystem host when it is *the* canonical place that
 * language's users already look, it is free, and it stays current on its own
 * — docs.rs, pkg.go.dev, javadoc.io, Swift Package Index. Duplicating those
 * under our own prefix costs CI and earns nothing.
 *
 * Self-host everything else. In particular do NOT hand Python to Read the
 * Docs: that is a generic hosting platform, not a canonical package index,
 * and we already run S3 + CloudFront. Hosting it ourselves gives us the
 * design system, the version scheme and the URLs.
 */
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
        'docs.rs builds and hosts every published crate version automatically, ' +
        'and it is where Rust developers already look. We ship the same ' +
        'rustdoc theme flags via [package.metadata.docs.rs] so the page ' +
        'carries our palette.',
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
        'pkg.go.dev indexes every module version from the proxy with no ' +
        'action from us, and Go tooling links there by convention. It is a ' +
        'server, not a static generator, so it cannot be self-hosted anyway.',
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
        'javadoc.io serves the javadoc JAR already published to Maven ' +
        'Central for every release, at a stable URL, with no build of ours.',
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

/**
 * Where a port's API reference lives.
 *
 * Ours, for all eight. This used to answer "docs.rs" for Rust, Go and Java,
 * which was right when they had no reference here and wrong once they did —
 * the reference this site extracts for those three was reachable from the
 * sidebar and from nowhere else. Where an ecosystem host also exists it is
 * offered alongside, by `referenceEntries` in `lib/sidebar.ts`, rather than
 * instead.
 *
 * `version` is unused and kept in the signature because every caller has one
 * and a reference URL is the kind of thing that acquires a version axis
 * again. Python's upstream gp-sphinx build at `/py/<version>/api/` is a
 * different document, not this one, and `referenceEntries` names it
 * separately.
 */
export function referenceUrl(port: Port, _version?: string): string {
  return withPortRoot(`/reference/${port.slug}/`)
}

/**
 * Where the port switcher should send someone who is *reading a page*.
 *
 * Switching language should keep you on the same document — that is the whole
 * point of the control — so the current path travels across. Ecosystem ports
 * carry prose at an unversioned prefix because their API versions live on
 * docs.rs and friends, so the version segment is dropped for them.
 *
 * `pagePath` is the path within the current port+version, e.g.
 * 'concepts/transports'. An empty path lands on the port's home page.
 */
export function portPageUrl(port: Port, version: string, pagePath = ''): string {
  const rest = pagePath.replace(/^\/+|\/+$/g, '')

  // The reference does not live under the port prefix, so carrying 'api'
  // across produced /rs/api/ and /go/api/, which never existed. referenceUrl()
  // knows where each port's reference is; defer to it rather than assuming the
  // path transfers.
  if (rest === 'api' || rest.startsWith('api/')) return referenceUrl(port, version)

  const tail = rest ? `${rest}/` : ''
  // Only ecosystem ports are unversioned. .NET and Swift have no *reference*
  // yet, but they do get a versioned prose build like every self-hosted port,
  // so dropping the version here pointed at /dotnet/concepts/ — a tree that
  // never existed.
  if (!port.versionedDocs) return withPortRoot(`/${port.slug}/${tail}`)
  return withPortRoot(`/${port.slug}/${version}/${tail}`)
}

/**
 * True when a reference page exists to link to — which is now every port.
 *
 * Kept as a function rather than deleted at the call sites: it is the place
 * this claim is asserted, and a ninth port arriving without an extracted
 * reference should have one line to change rather than five.
 */
export function hasReference(_port: Port): boolean {
  return true
}

/**
 * Where the port switcher should send someone.
 *
 * A port without a version tree has no /rs/latest/ to land on, so it resolves
 * to its landing page.
 */
export function portHomeUrl(port: Port, version: string): string {
  return withPortRoot(port.versionedDocs ? `/${port.slug}/${version}/` : `/${port.slug}/`)
}
