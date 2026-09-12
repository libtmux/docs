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

/**
 * One way to depend on a port, and what language it is written in.
 *
 * The language is not decoration. Half these forms are not shell commands at
 * all: Gradle and SwiftPM take a manifest line, and the C++ git form is a
 * CMake block. They were previously rendered with a `$ ` prompt in front of
 * them, which tells a reader to paste `implementation("...")` into a shell.
 * Carrying the language means the widget, the prompt and the highlighter all
 * make the same distinction instead of each guessing.
 */
export interface InstallForm {
  code: string
  /** Shiki language id. `console` means a shell command and takes the `$`. */
  lang: string
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
  /**
   * What a release tag for *this library* is prefixed with, when the
   * repository tags more than one thing.
   *
   * Rust is a Cargo workspace and tags every crate separately, so its release
   * reads `libtmux@v0.1.0-alpha.10` and the grammar above rejects it outright.
   * Go is the mirror-image hazard: it is a multi-module repository whose
   * submodules tag as `mcp/v0.0.1-alpha.9` while the library itself tags bare,
   * so stripping an undeclared prefix would happily select the MCP server's
   * version as the library's.
   *
   * Absent means the library tags bare, and a tag carrying `/` or `@` is
   * something else in the same repository and is not a candidate.
   */
  tagPrefix?: string
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
  /**
   * What turns an empty directory into a project this port can be added to.
   *
   * The agent prompts need it because "add libtmux to this repository" has two
   * cases, and only one of them is an install command. A reader running the
   * prompt in an empty directory gets a manifest first; one running it in an
   * existing project skips this.
   *
   * An `InstallForm` rather than a string because C++ has no init command to
   * name. Its entry is an instruction, and `lang: 'text'` is what stops it
   * being indented into a code block that a reader would try to paste.
   */
  initProject: InstallForm
  /**
   * The three ways to depend on this port, so a prompt can name the one that
   * matches the registry rather than the one we wish were true.
   *
   * Which form applies is not a property of the port, it is the current state
   * of its registry, which `site/src/data/registry.json` records and
   * `scripts/gen-registry.mjs` refreshes. Seven of the eight have no stable
   * release.
   *
   * The prerelease forms pin explicitly. Not because the bare command fails:
   * measured against the live registries, `cargo add libtmux` resolves
   * 0.1.0-alpha.10 and `go get github.com/libtmux/libtmux-go` resolves
   * v0.0.1-alpha.6, because both resolvers fall back to a prerelease when a
   * package has no release at all. The pin is here because a prompt states the
   * version in prose a line above the command, so the two have to agree, and
   * because an eval that records what it installed needs the command to say
   * it. A bare command also changes what it installs the day a stable lands,
   * silently; the generated pin changes visibly.
   *
   * Swift is the one case where the spelling is forced. Its tags are
   * prereleases, and `0.1.0-alpha.4` sorts below `0.1.0`, so `from: "0.1.0"`
   * has nothing in range and `exact:` is the only form that resolves.
   *
   * `{version}` is the registry's newest matching release and `{tag}` the
   * git tag. `composePrompt` substitutes both; `prompts.test.ts` fails on any
   * that survive, which is what keeps a placeholder out of a copied prompt.
   */
  installForms: {
    /** Unpinned, or version-pinned where the ecosystem always pins. */
    stable: InstallForm
    /** Names the prerelease explicitly, because these resolvers skip it otherwise. */
    prerelease: InstallForm
    /** Straight from the repository, for a port the registry does not carry. */
    git: InstallForm
  }
  /**
   * One caveat a reader cannot infer from the install command alone.
   *
   * Swift is the case that earned it: a target has to name the product
   * `LibTmux` and the package `libtmux-swift`, and neither is the `name:` its
   * package manifest declares. Getting it wrong fails at build time with
   * "unknown package", which is the error that corrected this line.
   */
  installNote?: string
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
    initProject: { code: 'uv init', lang: 'console' },
    installForms: {
      // `uv add`, not `pip install`, because the init step above is `uv init`.
      // Pairing the two installed into the ambient environment rather than the
      // project uv had just created, which an agent following the prompt would
      // not notice until an import failed somewhere else.
      stable: { code: 'uv add libtmux', lang: 'console' },
      prerelease: { code: "uv add --prerelease=allow 'libtmux=={version}'", lang: 'console' },
      git: { code: 'uv add "libtmux @ git+https://github.com/tmux-python/libtmux@{tag}"', lang: 'console' },
    },
    installNote:
      'If this project already uses pip, Poetry or PDM, add the dependency with that tool instead: the package is the same.',
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
    initProject: { code: 'bun init', lang: 'console' },
    installForms: {
      stable: { code: 'bun add libtmux', lang: 'console' },
      prerelease: { code: 'bun add libtmux@{version}', lang: 'console' },
      // A git install takes the workspace root, which is `@libtmux/repo` and
      // carries no library, so the import fails with "Cannot find module".
      // Depend on the package directory instead.
      git: { code: 'git clone --branch {tag} https://github.com/libtmux/libtmux-ts && bun add ./libtmux-ts/packages/libtmux', lang: 'console' },
    },
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
    tagPrefix: 'libtmux@',
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
    initProject: { code: 'cargo init', lang: 'console' },
    installForms: {
      stable: { code: 'cargo add libtmux', lang: 'console' },
      // Pinned so the command matches the version the prompt names. Cargo
      // resolves the alpha without it, having no release to prefer.
      prerelease: { code: 'cargo add libtmux@{version}', lang: 'console' },
      git: { code: 'cargo add libtmux --git https://github.com/libtmux/libtmux-rs --tag {tag}', lang: 'console' },
    },
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
    initProject: { code: 'go mod init example.com/tmuxdemo', lang: 'console' },
    installForms: {
      stable: { code: 'go get github.com/libtmux/libtmux-go', lang: 'console' },
      // Pinned for the same reason as Rust. The proxy serves the alpha to a
      // bare `go get` too, since the module has no release yet.
      prerelease: { code: 'go get github.com/libtmux/libtmux-go@{version}', lang: 'console' },
      git: { code: 'go get github.com/libtmux/libtmux-go@{tag}', lang: 'console' },
    },
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
    initProject: { code: 'gradle init --type java-application --dsl kotlin', lang: 'console' },
    installForms: {
      // Gradle has no unpinned form, so every spelling carries the version.
      // This is the field that used to read `:VERSION` and shipped that word
      // to readers as if it were a command.
      stable: { code: 'implementation("io.github.libtmux:libtmux:{version}")', lang: 'kotlin' },
      prerelease: { code: 'implementation("io.github.libtmux:libtmux:{version}")', lang: 'kotlin' },
      git: { code: 'git clone --branch {tag} https://github.com/libtmux/libtmux-java && (cd libtmux-java && ./gradlew publishToMavenLocal)', lang: 'console' },
    },
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
    initProject: { code: 'dotnet new console', lang: 'console' },
    installForms: {
      stable: { code: 'dotnet add package LibTmux', lang: 'console' },
      // `--version` rather than `--prerelease`: the latter takes whatever is
      // newest, which moves under a reader following a prompt that named a
      // version.
      prerelease: { code: 'dotnet add package LibTmux --version {version}', lang: 'console' },
      git: { code: 'dotnet add reference ../libtmux-dotnet/src/LibTmux/LibTmux.csproj', lang: 'console' },
    },
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
    initProject: {
      // CMake has no scaffolding command, so this step is an instruction.
      code: 'write a CMakeLists.txt declaring cmake_minimum_required and project(), targeting C++23.',
      lang: 'text',
    },
    installForms: {
      stable: { code: 'vcpkg install libtmux-cxx', lang: 'console' },
      prerelease: { code: 'vcpkg install libtmux-cxx', lang: 'console' },
      // There is no vcpkg port yet, so this is the only form that works today.
      // FetchContent rather than a clone: it pins the tag in the build file,
      // where the next reader of the repository can see it.
      git: { code: 'include(FetchContent)\nFetchContent_Declare(libtmux-cxx\n  GIT_REPOSITORY https://github.com/libtmux/libtmux-cxx\n  GIT_TAG {tag})\nFetchContent_MakeAvailable(libtmux-cxx)', lang: 'cmake' },
    },
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
    // SwiftPM resolves from the repository itself, so the repository is the
    // registry page a reader checks for versions.
    initProject: { code: 'swift package init --type executable', lang: 'console' },
    installForms: {
      stable: { code: '.package(url: "https://github.com/libtmux/libtmux-swift", from: "{version}")', lang: 'swift' },
      // `from: "0.1.0"` means ">= 0.1.0, < 1.0.0", and `0.1.0-alpha.4` sorts
      // below `0.1.0`, so nothing in the repository is in range. This is the
      // one port where the spelling is forced rather than chosen.
      prerelease: { code: '.package(url: "https://github.com/libtmux/libtmux-swift", exact: "{version}")', lang: 'swift' },
      git: { code: '.package(url: "https://github.com/libtmux/libtmux-swift", exact: "{tag}")', lang: 'swift' },
    },
    installNote:
      'A target depends on the product, not the package: write .product(name: "LibTmux", package: "libtmux-swift"). The library is `LibTmux` while the package identity SwiftPM derives from the URL is `libtmux-swift`, which is neither the product name nor the `name:` in the package manifest.',
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

/**
 * What a port's registry carries, as `scripts/gen-registry.mjs` recorded it.
 *
 * `site/src/data/registry.json` is the instance. The type lives here because
 * `installCommand` below is the only thing that reads it, and because this
 * module must stay importable by bare Node for `build-site.sh` — so it takes
 * the entry as an argument rather than importing the JSON itself.
 */
export type RegistryStatus = 'stable' | 'prerelease' | 'unpublished'

export interface RegistryEntry {
  status: RegistryStatus
  /** Newest installable version, or null when the registry has no package. */
  version: string | null
  /** Newest non-prerelease, or null when there has never been one. */
  stable: string | null
  /** Newest release tag in the repository, prefix included where one is used. */
  tag: string | null
}

export interface RegistryData {
  schema: 1
  ports: Record<string, RegistryEntry>
}

/**
 * The install command that actually resolves today.
 *
 * Derived rather than stored. The literal this replaces had gone wrong three
 * different ways at once: C++ advertised `vcpkg install libtmux-cxx` against a
 * vcpkg port that does not exist, Swift advertised `from: "0.1.0"` against a
 * version that was never tagged and a range that excludes prereleases anyway,
 * and Java shipped the word `VERSION` to readers as if it were a command.
 * Each was correct when typed and silently stopped being so; nothing in the
 * build could tell, because a string is always a valid string.
 *
 * Composing the spelling (`ports.ts`) with the state (`registry.json`) means
 * the only way to be wrong now is for the generated data to be stale, which
 * `gen-registry.mjs --check` reports.
 */
export function installCommand(port: Port, entry: RegistryEntry): InstallForm {
  const { installForms: forms } = port
  const fill = (form: InstallForm, token: string, value: string): InstallForm => ({
    code: form.code.replaceAll(token, value),
    lang: form.lang,
  })
  if (entry.status === 'stable' && entry.stable) return fill(forms.stable, '{version}', entry.stable)
  if (entry.status === 'prerelease' && entry.version) {
    return fill(forms.prerelease, '{version}', entry.version)
  }
  // Unpublished, or published with nothing resolvable. The repository is the
  // only place the code exists, so the tag is the version.
  if (!entry.tag) {
    throw new Error(
      `installCommand: ${port.slug} has no registry version and no release tag; ` +
        'run node scripts/gen-registry.mjs',
    )
  }
  return fill(forms.git, '{tag}', entry.tag)
}

/** How to say what the reader is installing, for a prompt that must not overclaim. */
export function releaseWording(port: Port, entry: RegistryEntry): string {
  if (entry.status === 'stable') {
    return `${port.packageName} ${entry.stable} is the current release on ${port.registry?.name ?? 'its registry'}.`
  }
  if (entry.status === 'prerelease') {
    return `${port.packageName} has no stable release. ${entry.version} is the newest prerelease on ${port.registry?.name ?? 'its registry'}, and the command below names it because the resolver skips prereleases otherwise.`
  }
  return `${port.packageName} is not published to ${port.registry?.name ?? 'its registry'} yet, so this installs from the repository at tag ${entry.tag}.`
}
