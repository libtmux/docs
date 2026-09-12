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
 * one of those. C++ has none to link: it is served from this project's own
 * vcpkg git registry rather than the curated one, so the repository link
 * already is the registry URL — the install picker's vcpkg panel is where
 * that gets explained, because it takes a `vcpkg-configuration.json` to say.
 */
export interface PackageRegistry {
  /** Display name, e.g. "PyPI". */
  name: string
  /** This package's page on that registry. */
  url: string
  /** Which mark `components/icons/RegistryIcon.astro` draws. */
  icon: 'pypi' | 'npm' | 'crates' | 'go' | 'maven' | 'nuget' | 'swift'
}

/**
 * One way to add a port's package to a project.
 *
 * Every port has more than one — a Python reader is on pip or uv, a
 * TypeScript reader on one of five, and Java, C++ and Swift cannot be
 * installed from a command line at all — and a single `install` string chose
 * for all of them. Worse, two of those strings had stopped resolving: npm has
 * `libtmux`, not `@libtmux/libtmux`, and C++ is served from this project's own
 * vcpkg git registry rather than the curated one, so `vcpkg install
 * libtmux-cxx` matched nothing.
 *
 * Versions appear only where the tool cannot find a prerelease without one.
 * `pip install libtmux`, `cargo add libtmux`, `go get …@latest` and
 * `npm install libtmux` all resolve the current release on their own, so
 * pinning them here would be a number to keep in step for no gain. Gradle,
 * Maven, SwiftPM and CMake each need the release named, so those snippets
 * carry one, and say where it came from.
 */
export interface InstallCommand {
  /** Tab label — the tool, not the language. */
  label: string
  /** Language for highlighting. `console` commands are shown with a `$`. */
  lang: string
  /** The command or file fragment, without a shell prompt. */
  code: string
  /** A caveat shown under the block. */
  note?: string
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
  /** How to add this package to a project, in the tools its readers use. */
  installs: readonly InstallCommand[]
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
    installs: [
      {
        label: 'pip',
        lang: 'console',
        code: 'pip install libtmux',
      },
      {
        label: 'uv',
        lang: 'console',
        code: 'uv add libtmux',
      },
      {
        label: 'pipx',
        lang: 'console',
        code: 'pipx install libtmux',
      },
    ],
    registry: { name: 'PyPI', url: 'https://pypi.org/project/libtmux/', icon: 'pypi' },
  },
  {
    slug: 'ts',
    name: 'TypeScript',
    language: 'TypeScript',
    packageName: 'libtmux',
    repo: 'libtmux/libtmux-ts',
    checkout: '~/work/libtmux/libtmux-ts',
    worktree: '~/work/libtmux/libtmux-ts-docs',
    versionedDocs: true,
    tagGrammar: 'semver',
    renderer: 'astro',
    generator: '@microsoft/api-extractor JSON',
    installs: [
      {
        label: 'npm',
        lang: 'console',
        code: 'npm install libtmux',
      },
      {
        label: 'pnpm',
        lang: 'console',
        code: 'pnpm add libtmux',
      },
      {
        label: 'yarn',
        lang: 'console',
        code: 'yarn add libtmux',
      },
      {
        label: 'bun',
        lang: 'console',
        code: 'bun add libtmux',
      },
      {
        label: 'deno',
        lang: 'console',
        code: 'deno add npm:libtmux',
      },
    ],
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
    installs: [
      {
        label: 'cargo',
        lang: 'console',
        code: 'cargo add libtmux',
      },
    ],
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
    installs: [
      {
        label: 'go get',
        lang: 'console',
        code: 'go get github.com/libtmux/libtmux-go/tmux@latest',
      },
    ],
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
    installs: [
      {
        label: 'Gradle',
        lang: 'kotlin',
        code: `dependencies {
    implementation(platform("io.github.libtmux:libtmux-bom:0.0.1-alpha.10"))

    implementation("io.github.libtmux:libtmux")
    testImplementation("io.github.libtmux:libtmux-junit5")
}`,
        note: 'The platform BOM names the version once and every other coordinate follows it, which is what stops a project mixing two releases of modules built against each other.',
      },
      {
        label: 'Maven',
        lang: 'xml',
        code: `<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>io.github.libtmux</groupId>
      <artifactId>libtmux-bom</artifactId>
      <version>0.0.1-alpha.10</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependency>
  <groupId>io.github.libtmux</groupId>
  <artifactId>libtmux</artifactId>
</dependency>`,
      },
    ],
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
    installs: [
      {
        label: 'dotnet',
        lang: 'console',
        code: 'dotnet package add LibTmux --prerelease',
        note: '--prerelease is required: every release so far carries an -alpha tag, and NuGet skips those unless asked.',
      },
    ],
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
    installs: [
      {
        label: 'CMake',
        lang: 'cmake',
        code: `include(FetchContent)
FetchContent_Declare(
  libtmux
  GIT_REPOSITORY https://github.com/libtmux/libtmux-cxx.git
  GIT_TAG        v0.1.0-alpha.7
)
FetchContent_MakeAvailable(libtmux)
target_link_libraries(your_target PRIVATE libtmux::libtmux)`,
        note: 'Name a tag or a commit, never a moving branch. Built this way the library brings nothing else: its tests, examples and MCP server all default off when it is not the top-level project.',
      },
      {
        label: 'vcpkg',
        lang: 'json',
        code: `{
  "registries": [
    {
      "kind": "git",
      "repository": "https://github.com/libtmux/libtmux-cxx",
      "baseline": "",
      "packages": ["libtmux"]
    }
  ]
}`,
        note: 'This repository is a vcpkg git registry, not a curated-registry port. Put this in vcpkg-configuration.json, add "libtmux" to your manifest, and run vcpkg x-update-baseline to fill the baseline.',
      },
      {
        label: 'Submodule',
        lang: 'console',
        code: 'git submodule add https://github.com/libtmux/libtmux-cxx.git third_party/libtmux',
        note: 'Then add_subdirectory(third_party/libtmux) and link libtmux::libtmux.',
      },
    ],
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
    // SwiftPM resolves from the git URL, so this is not where the package is
    // fetched from — it is where a Swift reader goes to see its platforms,
    // its versions and whether the last release built. `.spi.yml` in the
    // repository is the opt-in, and the package is in SwiftPackageIndex's
    // PackageList.
    registry: {
      name: 'Swift Package Index',
      url: 'https://swiftpackageindex.com/libtmux/libtmux-swift',
      icon: 'swift',
    },
    installs: [
      {
        label: 'Package.swift',
        lang: 'swift',
        code: `.package(
    url: "https://github.com/libtmux/libtmux-swift.git",
    exact: "0.1.0-alpha.4"
)`,
        note: 'An exact version, not a range. Every tag before 0.1.0 is a prerelease: SwiftPM keeps prereleases out of a `from: "0.1.0"` range, and `from: "0.1.0-alpha.4"` resolves forward into every prerelease after it.',
      },
    ],
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

/**
 * The install command a port leads with.
 *
 * The first entry, by construction: the lists are written in the order a
 * reader of that language would try them, so the head of each is the one that
 * belongs in a card with room for a single line.
 */
export function primaryInstall(port: Port): InstallCommand {
  const first = port.installs[0]
  if (!first) throw new Error(`ports.ts: ${port.slug} lists no install command`)
  return first
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
