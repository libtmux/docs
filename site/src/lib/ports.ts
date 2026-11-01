/** Port identities, source locations, renderers, and documentation URLs. */

// build-site.sh imports this module with bare Node; local imports need `.ts`.
import { withPortRoot } from './site-root.ts'
import { COOLDOWN_SLOTS } from './cooldown.ts'
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

/** Support scope is independent of a package's release maturity. */
export const CONCEPT_DESCRIPTION = 'A working example of the core library. It can change without notice.'

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
  icon: 'pypi' | 'npm' | 'crates' | 'go' | 'maven' | 'nuget' | 'swift' | 'rubygems' | 'luarocks' | 'powershell' | 'hex'
}

export type PortPackageId = 'core' | 'async' | DocProduct

/** A companion package or application documented inside one language port. */
export interface PortPackage {
  id: PortPackageId
  name: string
  /** What the registry or build tool resolves, when `name` is only the artifact. */
  coordinate?: string
  registry?: string
  /** The package's API reference on an off-site host. */
  reference?: string
  /** Package or CLI directory, with its default branch for latest pages. */
  source?: { path: string; ref: string; repo?: string }
  /** What a program imports; absent for a package that only ships a command. */
  require?: string
  executable?: string
  installs?: readonly InstallCommand[]
}

export type ProductAvailability = 'available' | 'unpublished'

/**
 * One way to add a port's package to a project.
 *
 * Every port has more than one — a Python reader is on pip or uv, a
 * TypeScript reader on one of four, and Java, C++ and Swift cannot be
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
export interface InstallBlock {
  /** Language for highlighting. `console` commands are shown with a `$`. */
  lang: string
  /** The command or file fragment, without a shell prompt. */
  code: string
  /** Destination displayed above a separately copied file fragment. */
  filename?: string
}

export interface InstallCommand extends InstallBlock {
  /** Tab label — the tool, not the language. */
  label: string
  /** Extra fragments required by the same installation method. */
  additionalBlocks?: readonly InstallBlock[]
  /** Exact-version form for a selected historical documentation release. */
  versionedCode?: string
  /** A caveat shown under the block. */
  note?: string
  /** How this command changes when the reader turns on a dependency cooldown. */
  cooldown?: InstallCooldown
}

/**
 * One command's dependency-cooldown forms.
 *
 * A cooldown applies to what the command pulls in, not to the package the
 * reader asked for: `code` exempts that package, and the `libtmux` it pins, so
 * a release published this morning still installs while its dependencies wait
 * out the window. A tool that cannot exempt one package from its own cutoff —
 * pip, Bun, and npx, which ignores `--min-release-age-exclude` — has no
 * `code`; the widget keeps the plain command and shows `note` instead. Each
 * form was run against the live registries before it was written here.
 */
export interface InstallCooldown {
  /** The command with a cooldown; placeholders from `COOLDOWN_SLOTS` carry the day count. */
  code?: string
  /** The command ignoring a cooldown the reader's own configuration sets. */
  bypass?: string
  /** Why a mode this command cannot express runs without one. */
  note?: string
}

/** NuGet library forms shared by C# and F#, with each package's own version. */
function nugetInstalls(packageName: string, pinCli = false): readonly InstallCommand[] {
  return [
    {
      label: '.NET CLI', lang: 'console',
      code: `dotnet package add ${packageName}${pinCli ? ' --version {version}' : ''}`,
      versionedCode: `dotnet package add ${packageName} --version {version}`,
      note: '.NET 10 SDK: run in your project directory. On .NET 8 or 9, use dotnet add package with the same arguments.',
    },
    {
      label: 'PMC', lang: 'powershell', code: `NuGet\\Install-Package ${packageName} -Version {version}`,
      note: 'Run in Visual Studio on Windows, in Tools > NuGet Package Manager > Package Manager Console. Choose the target project in that console.',
    },
    {
      label: 'PackageReference', lang: 'xml',
      code: `<PackageReference Include="${packageName}" Version="{version}" />`,
      note: 'Add this inside an ItemGroup in your .csproj or .fsproj, then run dotnet restore. For central version management, use the CPM tab.',
    },
    {
      label: 'CPM', lang: 'xml', filename: 'Directory.Packages.props',
      code: `<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageVersion Include="${packageName}" Version="{version}" />\n  </ItemGroup>\n</Project>`,
      additionalBlocks: [{ filename: 'Project file (.csproj or .fsproj)', lang: 'xml', code: `<PackageReference Include="${packageName}" />` }],
      note: 'Save Directory.Packages.props at the solution root, or merge these settings into the existing file. Add the versionless reference inside the project’s ItemGroup, then run dotnet restore.',
    },
    {
      label: 'Paket CLI', lang: 'console', code: `paket add ${packageName} --version {version} --interactive`,
      note: 'Requires Paket and a solution initialized with paket init. The interactive prompt selects the projects that should reference the package.',
    },
    {
      label: 'Script & Interactive', lang: 'fsharp', code: `#r "nuget: ${packageName}, {version}"`,
      note: 'Use in an F# .fsx script, dotnet fsi, or a Polyglot Notebook with NuGet support, on .NET 8 or later. This is not a directive for an ordinary compiled project.',
    },
    {
      label: 'File-Based Apps', lang: 'csharp', code: `#:package ${packageName}@{version}`,
      note: 'C# file-based apps require the .NET 10 SDK. Place this at the top of a .cs file, before code, then run dotnet run app.cs. F# scripts use the Script & Interactive tab.',
    },
    {
      label: 'Cake', lang: 'csharp', code: `#addin nuget:?package=${packageName}&version={version}&loaddependencies=true`,
      note: 'Use Cake.Tool 6 or later for a .cake script on .NET 8 or later, with Cake’s in-process NuGet client enabled. This loads the library and its dependencies; it has no Cake task aliases or executable tool. Cake Frosting projects use PackageReference.',
    },
  ]
}

const { days: DAYS, minutes: MINUTES, duration: DURATION } = COOLDOWN_SLOTS

/** For a tool with a cutoff but no way to exempt the package it installs. */
const noExemption = (tool: string, pkg: string) =>
  `${tool} cannot exempt ${pkg} from its own cooldown, so a cooldown here would also hold back the release this installs. This command runs without one.`

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

/** Returned dependency objects that belong in a port's reference navigation. */
export interface ApiDependencyNavigation {
  port: string
  label: string
  package: string
  version: string
  revision: string
  /** The consumer's extracted dependency declaration, reviewed with these pins. */
  declaration: { path: string; sha256: string }
  sections: Readonly<Record<string, readonly string[]>>
}

export interface Port {
  /** URL segment under the site root, e.g. `py` in /py/latest/. */
  slug: string
  /** Artwork palette and compact navigation label. */
  logoLanguage: string
  shortName: string
  /** Wrapper language sharing its parent's source, release and publisher. */
  parentLibrary?: { slug: string; runtime: string }
  /** References returned by an independently released wrapper package. */
  apiDependencies?: readonly string[]
  /** Selected dependency types; their pages remain in the declaring port. */
  apiDependencyNavigation?: readonly ApiDependencyNavigation[]
  /** Human name for nav and headings. */
  name: string
  /** Language shown in the port switcher. */
  language: string
  /** Project title used in browser tabs and search/social metadata. */
  projectName: string
  /** Package name users install. */
  packageName: string
  /** Source repository, `owner/name`. */
  repo: string
  /** Reviewed caller for the central documentation dispatcher. */
  docsDispatch?: {
    workflow: string
    /** Fixed caller branch; absent selects the repository's default branch. */
    ref?: string
    /** Language selector accepted by a library family's caller. */
    language?: string
  }
  /** Library directory and default branch for browser links within a repository. */
  source?: PortPackage['source']
  /** Working checkout, for the build script. Tilde-relative. */
  checkout: string
  /** Where the docs-branch worktree lives. Tilde-relative. */
  worktree: string
  /** Whether this port has a documentation tree for each supported version. */
  versionedDocs: boolean
  /** Command that loads a workspace file. */
  workspaceCli?: string
  /** Whether companion products exist for this language port. */
  productAvailability?: Partial<Record<DocProduct, ProductAvailability>>
  /** Native product descriptions where the generic CLI wording does not apply. */
  productDescriptions?: Partial<Record<DocProduct, string>>
  /** Separately published packages whose APIs belong in this port's docs. */
  packages?: readonly PortPackage[]
  /**
   * `local` builds from a source checkout; `published` installs from the
   * registry but is still in development on the shared native
   * pages; `released` is a finished loader with its own authored pages.
   */
  workspaceCliAvailability?: 'local' | 'published' | 'released'
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
  /** A native guide may link to a package-hosted reference without an API model. */
  referenceKind?: 'model' | 'guide'
  /** Generated Markdown reference with type pages and named member anchors. */
  sourceReferenceDirectory?: string
  renderer: Renderer
  /**
   * Whether this port's own documentation pipeline publishes
   * `<slug>/<version>/api/`. This repository assembles that tree to measure
   * style parity against and must never publish it or anything over it. Every
   * other port answers that path with a redirect to the reference this site
   * renders, which it does publish.
   */
  publishesOwnApi?: boolean
  /** Whether the port publisher owns the complete version subtree. */
  publishesOwnTree?: boolean
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
   * `scripts/gen-registry.mjs` refreshes. A port moves from `prerelease` to
   * `release` when its first final release reaches the registry.
   *
   * The prerelease forms pin explicitly. Not because the bare command fails:
   * measured against the live registries, `cargo add libtmux` resolves
   * 0.1.0-alpha.10 and `go get github.com/libtmux/libtmux-go` resolves
   * v0.0.1-alpha.6, because both resolvers fall back to a prerelease when a
   * package has no release at all. The pin is here because a prompt states the
   * version in prose a line above the command, so the two have to agree, and
   * because an eval that records what it installed needs the command to say
   * it. A bare command also changes what it installs the day a release lands,
   * silently; the generated pin changes visibly.
   *
   * Swift's prerelease form pins `exact:` because its alpha tags sort below
   * `0.1.0`, so a `from:` range had nothing in it; the release form uses
   * `from:`, as the package README does.
   *
   * `{version}` is the registry's newest matching release and `{tag}` the
   * git tag. `composePrompt` substitutes both; `prompts.test.ts` fails on any
   * that survive, which is what keeps a placeholder out of a copied prompt.
   */
  installForms: {
    /** Unpinned, or version-pinned where the ecosystem always pins. */
    release: InstallForm
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

const CORE_PORTS: readonly Port[] = [
  {
    slug: 'py',
    projectName: 'libtmux',
    logoLanguage: 'python',
    shortName: 'Py',
    name: 'Python',
    language: 'Python',
    packageName: 'libtmux',
    packages: [
      { id: 'workspace', name: 'tmuxp', registry: 'https://pypi.org/project/tmuxp/',
        source: { repo: 'tmux-python/tmuxp', path: 'src/tmuxp', ref: 'master' },
        executable: 'tmuxp',
        installs: [
          { label: 'uv tool', lang: 'console', code: 'uv tool install tmuxp', note: 'Installs tmuxp in an isolated Python environment. Run tmuxp load ./workspace.yaml.' },
          { label: 'uvx', lang: 'console', code: 'uvx tmuxp --help', note: 'Runs without a permanent installation. Replace --help with load ./workspace.yaml to load a workspace.' },
          { label: 'pipx', lang: 'console', code: 'pipx install tmuxp', note: 'Installs the tmuxp command in an isolated Python environment.' },
        ] },
      { id: 'mcp', name: 'libtmux-mcp', registry: 'https://pypi.org/project/libtmux-mcp/',
        source: { repo: 'tmux-python/libtmux-mcp', path: 'src/libtmux_mcp', ref: 'main' } },
    ],
    workspaceCli: 'tmuxp load',
    workspaceCliAvailability: 'released',
    repo: 'tmux-python/libtmux',
    docsDispatch: { workflow: 'docs.yml', ref: 'docs-site-deploy' },
    checkout: '~/work/python/libtmux',
    worktree: '~/work/python/libtmux-python-docs',
    versionedDocs: true,
    tagGrammar: 'pep440',
    renderer: 'sphinx',
    publishesOwnApi: true,
    publishesOwnTree: true,
    generator: 'Sphinx + sphinx-gp-theme',
    installs: [
      {
        label: 'pip',
        lang: 'console',
        code: 'pip install libtmux',
        cooldown: { note: noExemption('pip', 'libtmux') },
      },
      {
        label: 'uv',
        lang: 'console',
        code: 'uv add libtmux',
        cooldown: {
          code: `uv add \\\n    --exclude-newer ${DURATION} \\\n    --exclude-newer-package libtmux=2099-01-01 \\\n    libtmux`,
          bypass: 'uv add --no-config libtmux',
        },
      },
      {
        label: 'pipx',
        lang: 'console',
        code: 'pipx install libtmux',
        cooldown: { note: noExemption('pipx', 'libtmux') },
      },
    ],
    registry: { name: 'PyPI', url: 'https://pypi.org/project/libtmux/', icon: 'pypi' },
    initProject: { code: 'uv init', lang: 'console' },
    installForms: {
      // `uv add`, not `pip install`, because the init step above is `uv init`.
      // Pairing the two installed into the ambient environment rather than the
      // project uv had just created, which an agent following the prompt would
      // not notice until an import failed somewhere else.
      release: { code: 'uv add libtmux', lang: 'console' },
      prerelease: { code: "uv add --prerelease=allow 'libtmux=={version}'", lang: 'console' },
      git: { code: 'uv add "libtmux @ git+https://github.com/tmux-python/libtmux@{tag}"', lang: 'console' },
    },
    installNote:
      'If this project already uses pip, Poetry or PDM, add the dependency with that tool instead: the package is the same.',
  },
  {
    slug: 'ruby',
    projectName: 'libtmux-ruby',
    logoLanguage: 'ruby',
    shortName: 'Rb',
    name: 'Ruby',
    language: 'Ruby',
    packageName: 'libtmux',
    workspaceCli: 'libtmux-workspace load',
    workspaceCliAvailability: 'released',
    productAvailability: { workspace: 'available', mcp: 'available' },
    packages: [
      { id: 'core', name: 'libtmux', registry: 'https://rubygems.org/gems/libtmux', require: 'libtmux' },
      {
        id: 'async', name: 'libtmux-async', registry: 'https://rubygems.org/gems/libtmux-async', require: 'libtmux/async',
        source: { path: 'gems/libtmux-async', ref: 'master' },
        installs: [
          { label: 'gem', lang: 'console', code: 'gem install libtmux-async' },
          { label: 'Bundler', lang: 'ruby', code: 'gem "libtmux-async"' },
        ],
      },
      {
        id: 'mcp',
        name: 'libtmux-mcp',
        registry: 'https://rubygems.org/gems/libtmux-mcp',
        source: { path: 'gems/libtmux-mcp', ref: 'master' },
        require: 'libtmux/mcp',
        executable: 'libtmux-mcp',
        installs: [
          { label: 'gem', lang: 'console', code: 'gem install libtmux-mcp' },
          { label: 'Bundler', lang: 'ruby', code: 'gem "libtmux-mcp"' },
        ],
      },
      {
        id: 'workspace',
        name: 'libtmux-workspace',
        registry: 'https://rubygems.org/gems/libtmux-workspace',
        source: { path: 'gems/libtmux-workspace', ref: 'master' },
        require: 'libtmux/workspace',
        executable: 'libtmux-workspace',
        installs: [
          { label: 'gem', lang: 'console', code: 'gem install libtmux-workspace' },
          { label: 'Bundler', lang: 'ruby', code: 'gem "libtmux-workspace"' },
        ],
      },
    ],
    repo: 'libtmux/libtmux-ruby',
    docsDispatch: { workflow: 'docs.yml' },
    checkout: '~/work/libtmux/libtmux-ruby',
    worktree: '~/work/libtmux/libtmux-ruby-docs',
    versionedDocs: true,
    tagGrammar: 'rubygems',
    renderer: 'astro',
    publishesOwnTree: true,
    generator: 'public inventory + YARD JSON + RBS',
    installs: [
      { label: 'gem', lang: 'console', code: 'gem install libtmux' },
      { label: 'Bundler', lang: 'ruby', code: 'gem "libtmux"' },
    ],
    registry: { name: 'RubyGems', url: 'https://rubygems.org/gems/libtmux', icon: 'rubygems' },
    initProject: { code: 'bundle init', lang: 'console' },
    installForms: {
      release: { code: 'bundle add libtmux', lang: 'console' },
      prerelease: { code: 'bundle add libtmux --version {version}', lang: 'console' },
      git: {
        code: 'bundle add libtmux --git https://github.com/libtmux/libtmux-ruby.git --ref {tag}',
        lang: 'console',
      },
    },
  },
  {
    slug: 'lua',
    projectName: 'libtmux-lua',
    logoLanguage: 'lua',
    shortName: 'Lua',
    name: 'Lua',
    language: 'Lua',
    packageName: 'libtmux',
    productAvailability: { workspace: 'unpublished', mcp: 'unpublished' },
    repo: 'libtmux/libtmux-lua',
    docsDispatch: { workflow: 'docs.yml' },
    checkout: '~/work/libtmux/libtmux-lua',
    worktree: '~/work/libtmux/libtmux-lua-docs',
    versionedDocs: true,
    tagGrammar: 'luarocks',
    renderer: 'astro',
    publishesOwnTree: true,
    generator: 'LuaLS JSON',
    installs: [
      {
        label: 'LuaRocks',
        lang: 'console',
        code: 'luarocks --local install libtmux',
      },
    ],
    registry: { name: 'LuaRocks', url: 'https://luarocks.org/modules/tony/libtmux', icon: 'luarocks' },
    initProject: { code: 'luarocks init', lang: 'console' },
    installForms: {
      release: { code: 'luarocks --local install libtmux', lang: 'console' },
      prerelease: { code: 'luarocks --local install libtmux {version}', lang: 'console' },
      git: {
        code: 'git clone --branch {tag} --depth 1 https://github.com/libtmux/libtmux-lua.git vendor/libtmux && ./luarocks make vendor/libtmux/rockspecs/libtmux-scm-1.rockspec',
        lang: 'console',
      },
    },
  },
  {
    slug: 'powershell',
    projectName: 'libtmux-powershell',
    logoLanguage: 'powershell',
    shortName: 'PowerShell',
    name: 'PowerShell',
    language: 'PowerShell',
    packageName: 'LibTmux',
    repo: 'libtmux/libtmux-powershell',
    docsDispatch: { workflow: 'docs.yml' },
    apiDependencies: ['csharp'],
    apiDependencyNavigation: [{
      port: 'csharp', label: '.NET', package: 'LibTmux', version: '0.1.1',
      revision: '8d47af7d89638ad267528ac56897cec67df597f7',
      declaration: { path: 'Directory.Packages.props', sha256: '27cbc11937e1fcabd58f3af8636dda16c11ded4bd4a109895ca3be19f99a825f' },
      sections: {
        server: ['LibTmux.Server'],
        session: ['LibTmux.Session'],
        window: ['LibTmux.Window'],
        pane: ['LibTmux.Pane'],
        client: ['LibTmux.Client', 'LibTmux.ClientAttachment'],
        snapshots: ['LibTmux.CapturedRelation', 'LibTmux.CapturedValue', 'LibTmux.SnapshotDepth'],
        queries: ['LibTmux.Query.QueryDocument', 'LibTmux.Query.QueryPlan', 'LibTmux.Query.QueryResult', 'LibTmux.Query.QueryTarget', 'LibTmux.Query.QueryPushdown'],
        'queries-fields': ['LibTmux.Query.QueryFieldDescriptor'],
      },
    }],
    checkout: '~/work/libtmux/libtmux-powershell',
    worktree: '~/work/libtmux/libtmux-powershell-docs-site',
    source: { path: 'src/LibTmux.PowerShell', ref: 'master' },
    versionedDocs: true,
    tagGrammar: 'semver',
    renderer: 'astro',
    publishesOwnTree: true,
    generator: 'PowerShell command metadata, manifests, PlatyPS and C# source',
    productAvailability: { mcp: 'unpublished' },
    productDescriptions: { workspace: 'Read, validate, plan and load workspace files with the LibTmux.Workspace cmdlets.' },
    packages: [{
      id: 'workspace', name: 'LibTmux.Workspace',
      registry: 'https://www.powershellgallery.com/packages/LibTmux.Workspace',
      source: { path: 'src/LibTmux.Workspace.PowerShell', ref: 'master' },
      installs: [
        { label: 'PowerShellGet', lang: 'powershell', code: 'Install-Module -Name LibTmux.Workspace',
          note: 'Installs the matching LibTmux core dependency. Run PowerShell and tmux on the same Unix host.' },
        { label: 'PSResourceGet', lang: 'powershell', code: 'Install-PSResource -Name LibTmux.Workspace',
          note: 'Installs the matching LibTmux core dependency. Run PowerShell and tmux on the same Unix host.' },
      ],
    }],
    installs: [
      { label: 'PowerShellGet', lang: 'powershell', code: 'Install-Module -Name LibTmux',
        note: 'Requires PowerShell 7.4 or later and tmux on the same Unix host.' },
      { label: 'PSResourceGet', lang: 'powershell', code: 'Install-PSResource -Name LibTmux',
        note: 'Requires PowerShell 7.4 or later and tmux on the same Unix host.' },
    ],
    registry: { name: 'PowerShell Gallery', url: 'https://www.powershellgallery.com/packages/LibTmux', icon: 'powershell' },
    initProject: { code: 'Create a PowerShell script in this directory; no project manifest is required.', lang: 'text' },
    installForms: {
      release: { code: 'Install-Module -Name LibTmux', lang: 'powershell' },
      prerelease: { code: 'Install-Module -Name LibTmux -RequiredVersion {version} -AllowPrerelease', lang: 'powershell' },
      git: { code: 'git clone --branch {tag} --depth 1 https://github.com/libtmux/libtmux-powershell.git\npwsh -NoProfile -File libtmux-powershell/eng/Build.ps1 -Restore', lang: 'console' },
    },
    installNote: 'Import LibTmux after installation. LibTmux.Workspace is a separate module; the .NET MCP tool does not import either module.',
  },
  {
    slug: 'julia',
    projectName: 'LibTmux.jl',
    logoLanguage: 'julia',
    shortName: 'Julia',
    name: 'Julia',
    language: 'Julia',
    packageName: 'LibTmux',
    repo: 'libtmux/libtmux-julia',
    docsDispatch: { workflow: 'docs.yml' },
    checkout: '~/work/libtmux/libtmux-julia',
    worktree: '~/work/libtmux/libtmux-julia-docs-site',
    source: { path: 'src', ref: 'master' },
    versionedDocs: true,
    tagGrammar: 'semver',
    renderer: 'astro',
    publishesOwnTree: true,
    generator: 'Julia syntax, native methods and documentation',
    workspaceCli: 'libtmux-workspace load',
    workspaceCliAvailability: 'local',
    productDescriptions: { workspace: 'Read and plan tmuxp-style workspaces, then load them with LibTmuxWorkspace or its CLI.',
      mcp: 'Run LibTmuxMCP to expose tmux tools to an MCP client.' },
    packages: [
      { id: 'workspace', name: 'LibTmuxWorkspace', source: { path: 'packages/LibTmuxWorkspace', ref: 'master' },
        require: 'LibTmuxWorkspace', executable: 'libtmux-workspace',
        installs: [{ label: 'Pkg (Git)', lang: 'julia',
          code: 'using Pkg\nPkg.activate(".")\nrepo = "https://github.com/libtmux/libtmux-julia.git"\nref = {revision}\nPkg.add([\n    PackageSpec(url=repo, rev=ref),\n    PackageSpec(url=repo, rev=ref, subdir="packages/LibTmuxWorkspace"),\n])',
          note: 'Run in Julia. Neither package is registered in General, so this installs from Git. Add the core and workspace packages in one call so both use the same revision.' }] },
      { id: 'mcp', name: 'LibTmuxMCP', source: { path: 'packages/LibTmuxMCP', ref: 'master' },
        require: 'LibTmuxMCP', executable: 'libtmux-mcp',
        installs: [{ label: 'Pkg (Git)', lang: 'julia',
          code: 'using Pkg\nPkg.activate(".")\nrepo = "https://github.com/libtmux/libtmux-julia.git"\nref = {revision}\nPkg.add([\n    PackageSpec(url=repo, rev=ref),\n    PackageSpec(url=repo, rev=ref, subdir="packages/LibTmuxMCP"),\n])',
          note: 'Run in Julia. Neither package is registered in General, so this installs from Git. Add the core and MCP packages in one call so both use the same revision.' }] },
    ],
    installs: [{ label: 'Pkg (Git)', lang: 'julia',
      code: 'using Pkg\nPkg.activate(".")\nPkg.add(PackageSpec(\n    url="https://github.com/libtmux/libtmux-julia.git",\n    rev={revision},\n))',
      note: 'Run in Julia with tmux on PATH. The package is not registered in General, so this installs from Git; Manifest.toml records the package tree hash.' }],
    initProject: { code: 'using Pkg\nPkg.activate(".")', lang: 'julia' },
    installForms: {
      release: { code: 'using Pkg\nPkg.add("LibTmux")', lang: 'julia' },
      prerelease: { code: 'using Pkg\nPkg.add(PackageSpec(name="LibTmux", version="{version}"))', lang: 'julia' },
      // Unselected source installs follow the default branch.
      git: { code: 'using Pkg\nPkg.add(PackageSpec(url="https://github.com/libtmux/libtmux-julia.git", rev="master"))', lang: 'julia' },
    },
    installNote: 'Requires Julia 1.13.1 and tmux 3.3a or newer. JSON layouts require tmux 3.8. Companion packages install from the same revision as the core.',
  },
  {
    slug: 'elixir',
    projectName: 'libtmux-elixir',
    logoLanguage: 'elixir',
    shortName: 'Ex',
    name: 'Elixir',
    language: 'Elixir',
    packageName: 'libtmux',
    productAvailability: { workspace: 'unpublished', mcp: 'unpublished' },
    repo: 'libtmux/libtmux-elixir',
    docsDispatch: { workflow: 'docs.yml' },
    checkout: '~/work/libtmux/libtmux-elixir',
    worktree: '~/work/libtmux/libtmux-elixir-docs-site',
    source: { path: 'lib', ref: 'main' },
    versionedDocs: true,
    tagGrammar: 'semver',
    renderer: 'astro',
    publishesOwnTree: true,
    // HexDocs publishes ExDoc output with every Hex release. This site renders
    // the same documentation from the compiled package, and links to it.
    ecosystemHost: {
      name: 'HexDocs',
      url: 'https://libtmux.hexdocs.pm/',
      rationale: 'ExDoc API reference and guides for published package versions on HexDocs.',
    },
    generator: 'Elixir documentation chunks and typespecs',
    installs: [
      {
        label: 'mix.exs',
        lang: 'elixir',
        filename: 'mix.exs',
        code: '{:libtmux, "~> {version}"}',
        additionalBlocks: [{ lang: 'console', code: 'mix deps.get' }],
        note: 'Add the tuple to the deps list in mix.exs, then fetch it. Needs Elixir 1.20.4 or newer, Erlang/OTP 29.1.2 or a newer 29.x release, tmux 3.3 or newer (the planned floor), and a C11 compiler on Linux.',
      },
    ],
    registry: { name: 'Hex', url: 'https://hex.pm/packages/libtmux', icon: 'hex' },
    initProject: { code: 'mix new my_app', lang: 'console' },
    installForms: {
      // `~> 0.1.0` accepts every 0.1.N release, as the package README's
      // `~> 0.1` does. A prerelease is pinned exactly.
      release: { code: '{:libtmux, "~> {version}"}', lang: 'elixir' },
      prerelease: { code: '{:libtmux, "== {version}"}', lang: 'elixir' },
      git: { code: '{:libtmux, github: "libtmux/libtmux-elixir", tag: "{tag}"}', lang: 'elixir' },
    },
    installNote:
      'Add the tuple to the deps list in mix.exs and run mix deps.get. Requires Elixir 1.20.4 or newer, Erlang/OTP 29.1.2 or a newer 29.x release, and tmux 3.3 or newer (the planned floor); Linux builds need a C11 compiler.',
  },
  {
    slug: 'ts',
    projectName: 'libtmux-ts',
    logoLanguage: 'typescript',
    shortName: 'TS',
    workspaceCli: 'tmux-workspace load',
    workspaceCliAvailability: 'published',
    name: 'TypeScript',
    language: 'TypeScript',

    packageName: 'libtmux',
    packages: [
      {
        id: 'mcp',
        name: '@libtmux/mcp',
        registry: 'https://www.npmjs.com/package/@libtmux/mcp',
        source: { path: 'packages/mcp', ref: 'master' },
        require: '@libtmux/mcp',
        executable: 'libtmux-mcp',
      },
      {
        id: 'workspace',
        name: '@libtmux/workspace-cli',
        registry: 'https://www.npmjs.com/package/@libtmux/workspace-cli',
        source: { path: 'packages/workspace-cli', ref: 'master' },
        executable: 'tmux-workspace',
        // Runners lead: like `uvx tmuxp`, the command needs no project to be
        // added to. `--help` is the argument because it runs without a
        // workspace file, so every line pastes and runs as shown.
        installs: [
          {
            label: 'npx',
            lang: 'console',
            code: 'npx -y @libtmux/workspace-cli --help',
            note: 'Runs tmux-workspace without installing it. Pass a command such as load ./workspace.yaml in place of --help.',
            cooldown: {
              bypass: 'npx -y --min-release-age=0 @libtmux/workspace-cli --help',
              note: 'npx ignores --min-release-age-exclude, so a cooldown here would also hold back the release this runs. This command runs without one.',
            },
          },
          {
            label: 'bunx',
            lang: 'console',
            code: 'bunx --bun @libtmux/workspace-cli --help',
            note: '--bun runs the command on Bun. Without it, bunx runs the command on Node when Node is installed, because its shebang names node.',
            cooldown: {
              bypass: 'bunx --bun --minimum-release-age=0 @libtmux/workspace-cli --help',
              note: noExemption('Bun', '@libtmux/workspace-cli'),
            },
          },
          {
            label: 'pnpm dlx',
            lang: 'console',
            code: 'pnpm dlx @libtmux/workspace-cli --help',
            cooldown: {
              code: `pnpm_config_minimum_release_age=${MINUTES} \\\n    pnpm_config_minimum_release_age_exclude='["@libtmux/workspace-cli","libtmux"]' \\\n    pnpm dlx @libtmux/workspace-cli --help`,
              bypass: 'pnpm_config_minimum_release_age=0 pnpm dlx @libtmux/workspace-cli --help',
            },
          },
          {
            label: 'yarn dlx',
            lang: 'console',
            code: 'yarn dlx @libtmux/workspace-cli --help',
            note: 'Yarn refuses a release younger than its npmMinimalAgeGate, one day by default.',
            cooldown: {
              code: `YARN_NPM_MINIMAL_AGE_GATE=${DAYS}d \\\n    YARN_NPM_PREAPPROVED_PACKAGES=@libtmux/workspace-cli,libtmux \\\n    yarn dlx @libtmux/workspace-cli --help`,
              bypass: 'YARN_NPM_MINIMAL_AGE_GATE=0 yarn dlx @libtmux/workspace-cli --help',
            },
          },
          {
            label: 'npm -g',
            lang: 'console',
            code: 'npm install -g @libtmux/workspace-cli',
            note: 'Puts tmux-workspace on PATH, so a workspace loads with tmux-workspace load ./workspace.yaml.',
            cooldown: {
              code: `npm install -g \\\n    --min-release-age=${DAYS} \\\n    --min-release-age-exclude=@libtmux/workspace-cli \\\n    --min-release-age-exclude=libtmux \\\n    @libtmux/workspace-cli`,
              bypass: 'npm install -g --min-release-age=0 @libtmux/workspace-cli',
            },
          },
          {
            label: 'pnpm -g',
            lang: 'console',
            code: 'pnpm add -g @libtmux/workspace-cli',
            cooldown: {
              code: `pnpm_config_minimum_release_age=${MINUTES} \\\n    pnpm_config_minimum_release_age_exclude='["@libtmux/workspace-cli","libtmux"]' \\\n    pnpm add -g @libtmux/workspace-cli`,
              bypass: 'pnpm_config_minimum_release_age=0 pnpm add -g @libtmux/workspace-cli',
            },
          },
          {
            label: 'bun -g',
            lang: 'console',
            code: 'bun add -g @libtmux/workspace-cli',
            cooldown: {
              bypass: 'bun add -g --minimum-release-age=0 @libtmux/workspace-cli',
              note: noExemption('Bun', '@libtmux/workspace-cli'),
            },
          },
        ],
      },
    ],
    repo: 'libtmux/libtmux-ts',
    docsDispatch: { workflow: 'docs.yml' },
    checkout: '~/work/libtmux/libtmux-ts',
    worktree: '~/work/libtmux/libtmux-ts-docs',
    versionedDocs: true,
    publishesOwnTree: true,
    tagGrammar: 'semver',
    renderer: 'astro',
    generator: '@microsoft/api-extractor JSON',
    installs: [
      {
        label: 'npm',
        lang: 'console',
        code: 'npm install libtmux',
        cooldown: {
          code: `npm install \\\n    --min-release-age=${DAYS} \\\n    --min-release-age-exclude=libtmux \\\n    libtmux`,
          bypass: 'npm install --min-release-age=0 libtmux',
        },
      },
      {
        label: 'pnpm',
        lang: 'console',
        code: 'pnpm add libtmux',
        cooldown: {
          code: `pnpm_config_minimum_release_age=${MINUTES} \\\n    pnpm_config_minimum_release_age_exclude='["libtmux"]' \\\n    pnpm add libtmux`,
          bypass: 'pnpm_config_minimum_release_age=0 pnpm add libtmux',
        },
      },
      {
        label: 'yarn',
        lang: 'console',
        code: 'yarn add libtmux',
        cooldown: {
          code: `YARN_NPM_MINIMAL_AGE_GATE=${DAYS}d \\\n    YARN_NPM_PREAPPROVED_PACKAGES=libtmux \\\n    yarn add libtmux`,
          bypass: 'YARN_NPM_MINIMAL_AGE_GATE=0 yarn add libtmux',
        },
      },
      {
        label: 'bun',
        lang: 'console',
        code: 'bun add libtmux',
        cooldown: { bypass: 'bun add --minimum-release-age=0 libtmux', note: noExemption('Bun', 'libtmux') },
      },
    ],
    registry: { name: 'npm', url: 'https://www.npmjs.com/package/libtmux', icon: 'npm' },
    initProject: { code: 'bun init', lang: 'console' },
    installForms: {
      release: { code: 'bun add libtmux', lang: 'console' },
      prerelease: { code: 'bun add libtmux@{version}', lang: 'console' },
      // A git install takes the workspace root, which is `@libtmux/repo` and
      // carries no library, so the import fails with "Cannot find module".
      // Depend on the package directory instead.
      git: { code: 'git clone --branch {tag} https://github.com/libtmux/libtmux-ts && bun add ./libtmux-ts/packages/libtmux', lang: 'console' },
    },
  },
  {
    slug: 'rs',
    projectName: 'libtmux-rs',
    packages: [
      { id: 'workspace', name: 'tmux-workspace', registry: 'https://crates.io/crates/tmux-workspace',
        reference: 'https://docs.rs/tmux-workspace',
        source: { path: 'crates/tmux-workspace', ref: 'master' },
        executable: 'tmux-workspace',
        installs: [{ label: 'cargo', lang: 'console', code: 'cargo install --locked tmux-workspace',
          note: 'Needs Rust 1.85 or newer. This builds and installs the native CLI; run tmux-workspace --help afterward.' }] },
      { id: 'mcp', name: 'tmux-mcp', registry: 'https://crates.io/crates/tmux-mcp',
        reference: 'https://docs.rs/tmux-mcp',
        source: { path: 'crates/tmux-mcp', ref: 'master' } },
    ],
    logoLanguage: 'rust',
    shortName: 'Rs',
    workspaceCli: 'tmux-workspace load',
    workspaceCliAvailability: 'published',
    name: 'Rust',
    language: 'Rust',
    packageName: 'libtmux',
    repo: 'libtmux/libtmux-rs',
    docsDispatch: { workflow: 'docs.yml' },
    checkout: '~/work/libtmux/libtmux-rs',
    worktree: '~/work/libtmux/libtmux-rs-docs',
    versionedDocs: true,
    tagGrammar: 'semver',
    tagPrefix: 'libtmux@',
    renderer: 'none',
    publishesOwnTree: true,
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
      release: { code: 'cargo add libtmux', lang: 'console' },
      // Pinned so the command matches the version the prompt names. Cargo
      // resolves the alpha without it, having no release to prefer.
      prerelease: { code: 'cargo add libtmux@{version}', lang: 'console' },
      git: { code: 'cargo add libtmux --git https://github.com/libtmux/libtmux-rs --tag {tag}', lang: 'console' },
    },
  },
  {
    slug: 'go',
    projectName: 'libtmux-go',
    logoLanguage: 'go',
    shortName: 'Go',
    workspaceCli: 'tmux-workspace load',
    workspaceCliAvailability: 'published',
    name: 'Go',
    language: 'Go',
    packageName: 'github.com/libtmux/libtmux-go/tmux',
    packages: [
      { id: 'mcp', name: 'github.com/libtmux/libtmux-go/mcp', registry: 'https://pkg.go.dev/github.com/libtmux/libtmux-go/mcp',
        reference: 'https://pkg.go.dev/github.com/libtmux/libtmux-go/mcp',
        source: { path: 'mcp/cmd/libtmux-mcp', ref: 'master' } },
      {
        id: 'workspace',
        name: 'github.com/libtmux/libtmux-go/workspace',
        registry: 'https://pkg.go.dev/github.com/libtmux/libtmux-go/workspace',
        reference: 'https://pkg.go.dev/github.com/libtmux/libtmux-go/workspace',
        source: { path: 'workspace/cmd/tmux-workspace', ref: 'master' },
        require: 'github.com/libtmux/libtmux-go/workspace',
        executable: 'tmux-workspace',
        installs: [
          {
            label: 'go install',
            lang: 'console',
            code: 'go install github.com/libtmux/libtmux-go/workspace/cmd/tmux-workspace@latest',
            note: 'Needs Go 1.26 or newer. Puts tmux-workspace in $(go env GOBIN), or in $(go env GOPATH)/bin when GOBIN is unset; rerunning it upgrades.',
          },
        ],
      },
    ],
    repo: 'libtmux/libtmux-go',
    docsDispatch: { workflow: 'docs.yml' },
    checkout: '~/work/libtmux/libtmux-go',
    worktree: '~/work/libtmux/libtmux-go-docs',
    versionedDocs: true,
    publishesOwnTree: true,
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
      release: { code: 'go get github.com/libtmux/libtmux-go', lang: 'console' },
      // Pinned for the same reason as Rust. The proxy serves the alpha to a
      // bare `go get` too, since the module has no release yet.
      prerelease: { code: 'go get github.com/libtmux/libtmux-go@{version}', lang: 'console' },
      git: { code: 'go get github.com/libtmux/libtmux-go@{tag}', lang: 'console' },
    },
  },
  {
    slug: 'java',
    projectName: 'libtmux-java',
    packages: [
      { id: 'workspace', name: 'libtmux-workspace-cli', coordinate: 'io.github.libtmux:libtmux-workspace-cli',
        registry: 'https://central.sonatype.com/artifact/io.github.libtmux/libtmux-workspace-cli',
        source: { path: 'libtmux-workspace-cli', ref: 'master' },
        executable: 'tmux-workspace',
        installs: [{ label: 'Gradle', lang: 'console', code: './gradlew \\\n    --max-workers=2 \\\n    --no-parallel \\\n    :libtmux-workspace-cli:installDist',
          note: 'Run from a libtmux-java checkout with JDK 25 or newer. The launcher is libtmux-workspace-cli/build/install/tmux-workspace/bin/tmux-workspace; keep its adjacent libraries.' }] },
      { id: 'mcp', name: 'libtmux-mcp', coordinate: 'io.github.libtmux:libtmux-mcp',
        registry: 'https://central.sonatype.com/artifact/io.github.libtmux/libtmux-mcp',
        reference: 'https://javadoc.io/doc/io.github.libtmux/libtmux-mcp',
        source: { path: 'libtmux-mcp', ref: 'master' } },
    ],
    logoLanguage: 'java',
    shortName: 'Java',
    workspaceCli: 'tmux-workspace load',
    workspaceCliAvailability: 'local',
    name: 'Java',
    language: 'Java',
    packageName: 'io.github.libtmux:libtmux',
    repo: 'libtmux/libtmux-java',
    docsDispatch: { workflow: 'docs.yml', language: 'java' },
    checkout: '~/work/libtmux/libtmux-java',
    worktree: '~/work/libtmux/libtmux-java-docs',
    versionedDocs: true,
    publishesOwnTree: true,
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
    implementation(platform("io.github.libtmux:libtmux-bom:0.1.0"))

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
      <version>0.1.0</version>
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
      release: { code: 'implementation("io.github.libtmux:libtmux:{version}")', lang: 'kotlin' },
      prerelease: { code: 'implementation("io.github.libtmux:libtmux:{version}")', lang: 'kotlin' },
      git: { code: 'git clone --branch {tag} https://github.com/libtmux/libtmux-java && (cd libtmux-java && ./gradlew publishToMavenLocal)', lang: 'console' },
    },
  },
  {
    slug: 'csharp',
    projectName: 'libtmux-dotnet',
    logoLanguage: 'csharp',
    shortName: 'C#',
    workspaceCli: 'tmux-workspace load',
    workspaceCliAvailability: 'published',
    name: 'C#',
    language: 'C#',
    packageName: 'LibTmux',
    repo: 'libtmux/libtmux-dotnet',
    docsDispatch: { workflow: 'docs.yml', language: 'csharp' },
    checkout: '~/work/libtmux/libtmux-dotnet',
    worktree: '~/work/libtmux/libtmux-dotnet-docs',
    versionedDocs: true,
    publishesOwnTree: true,
    tagGrammar: 'semver',
    renderer: 'astro',
    generator: 'docfx metadata (--outputFormat markdown)',
    installs: nugetInstalls('LibTmux'),
    registry: { name: 'NuGet', url: 'https://www.nuget.org/packages/LibTmux', icon: 'nuget' },
    initProject: { code: 'dotnet new console', lang: 'console' },
    installForms: {
      release: { code: 'dotnet add package LibTmux', lang: 'console' },
      // `--version` rather than `--prerelease`: the latter takes whatever is
      // newest, which moves under a reader following a prompt that named a
      // version.
      prerelease: { code: 'dotnet add package LibTmux --version {version}', lang: 'console' },
      git: { code: 'dotnet add reference ../libtmux-dotnet/src/LibTmux/LibTmux.csproj', lang: 'console' },
    },
    packages: [
      { id: 'mcp', name: 'LibTmux.Mcp', registry: 'https://www.nuget.org/packages/LibTmux.Mcp',
        source: { path: 'src/LibTmux.Mcp', ref: 'master' } },
      {
        id: 'workspace',
        name: 'LibTmux.Workspace.Cli',
        registry: 'https://www.nuget.org/packages/LibTmux.Workspace.Cli',
        source: { path: 'src/LibTmux.Workspace.Cli', ref: 'master' },
        require: 'LibTmux.Workspace',
        executable: 'tmux-workspace',
        installs: [
          {
            label: 'dotnet tool',
            lang: 'console',
            code: 'dotnet tool install --global LibTmux.Workspace.Cli',
            note: 'Add $HOME/.dotnet/tools to PATH if the shell cannot find tmux-workspace.',
          },
          {
            label: 'dnx',
            lang: 'console',
            code: 'dnx LibTmux.Workspace.Cli --yes -- --help',
            note: 'Runs it once from NuGet without installing anything; needs the .NET 10 SDK.',
          },
          {
            label: 'Tool manifest',
            lang: 'console',
            code: 'dotnet tool install LibTmux.Workspace.Cli',
            note: 'Run at a repository root: it writes dotnet-tools.json, which pins the version for everyone who clones it. Run it as dotnet tmux-workspace.',
          },
        ],
      },
    ],
  },
  {
    slug: 'cxx',
    projectName: 'libtmux-cxx',
    packages: [
      { id: 'workspace', name: 'tmux-workspace', source: { path: 'apps/workspace', ref: 'master' },
        executable: 'tmux-workspace',
        installs: [{ label: 'CMake', lang: 'console', code: 'cmake --preset cxx-dev -DLIBTMUX_BUILD_WORKSPACE_CLI=ON && \\\n    cmake --build --preset cxx-dev --target tmux-workspace --parallel 2',
          note: 'Run from a libtmux-cxx checkout with Clang 18.1.3, libc++ 18.1, CMake 3.25 or newer, and Ninja. The command is build/cxx-dev/apps/workspace/tmux-workspace.' }] },
      { id: 'mcp', name: 'libtmux-mcp-server', source: { path: 'apps/mcp', ref: 'master' } },
    ],
    logoLanguage: 'cpp',
    shortName: 'C++',
    workspaceCli: 'tmux-workspace load',
    workspaceCliAvailability: 'local',
    name: 'C++',
    language: 'C++',
    packageName: 'libtmux-cxx',
    repo: 'libtmux/libtmux-cxx',
    docsDispatch: { workflow: 'docs.yml' },
    checkout: '~/work/libtmux/libtmux-cxx',
    worktree: '~/work/libtmux/libtmux-cxx-docs',
    versionedDocs: true,
    publishesOwnTree: true,
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
  GIT_TAG        v0.1.0-alpha.10
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
        code: 'git submodule add \\\n  https://github.com/libtmux/libtmux-cxx.git \\\n  third_party/libtmux',
        note: 'Then add_subdirectory(third_party/libtmux) and link libtmux::libtmux.',
      },
    ],
    initProject: {
      // CMake has no scaffolding command, so this step is an instruction.
      code: 'write a CMakeLists.txt declaring cmake_minimum_required and project(), targeting C++23.',
      lang: 'text',
    },
    installForms: {
      release: { code: 'vcpkg install libtmux-cxx', lang: 'console' },
      prerelease: { code: 'vcpkg install libtmux-cxx', lang: 'console' },
      // There is no vcpkg port yet, so this is the only form that works today.
      // FetchContent rather than a clone: it pins the tag in the build file,
      // where the next reader of the repository can see it.
      git: { code: 'include(FetchContent)\nFetchContent_Declare(libtmux-cxx\n  GIT_REPOSITORY https://github.com/libtmux/libtmux-cxx\n  GIT_TAG {tag})\nFetchContent_MakeAvailable(libtmux-cxx)', lang: 'cmake' },
    },
  },
  {
    slug: 'swift',
    projectName: 'libtmux-swift',
    packages: [
      { id: 'workspace', name: 'tmux-workspace', registry: 'https://swiftpackageindex.com/libtmux/libtmux-swift',
        source: { path: 'Sources/TmuxWorkspaceCLI', ref: 'master' },
        executable: 'tmux-workspace',
        installs: [{ label: 'SwiftPM', lang: 'console', code: 'swift build \\\n    --jobs 2 \\\n    --traits YAMLWorkspaces \\\n    --force-resolved-versions \\\n    --product tmux-workspace',
          note: 'Run from a libtmux-swift checkout with Swift 6.2 or newer on Linux, or Xcode Swift 6.3 or newer on macOS. The command is .build/debug/tmux-workspace.' }] },
      { id: 'mcp', name: 'libtmux-mcp', registry: 'https://swiftpackageindex.com/libtmux/libtmux-swift',
        source: { path: 'Sources/LibTmuxMCP', ref: 'master' } },
    ],
    logoLanguage: 'swift',
    shortName: 'Sw',
    workspaceCli: 'tmux-workspace load',
    workspaceCliAvailability: 'local',
    name: 'Swift',
    language: 'Swift',
    packageName: 'libtmux-swift',
    repo: 'libtmux/libtmux-swift',
    docsDispatch: { workflow: 'docs.yml' },
    checkout: '~/work/libtmux/libtmux-swift',
    worktree: '~/work/libtmux/libtmux-swift-docs',
    versionedDocs: true,
    publishesOwnTree: true,
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
    from: "0.1.0"
)`,
        note: 'A range from 0.1.0 up to the next major version. Any 0.1.N release may change the API, so pin `exact:` instead to avoid a break.',
      },
    ],
    // SwiftPM resolves from the repository itself, so the repository is the
    // registry page a reader checks for versions.
    initProject: { code: 'swift package init --type executable', lang: 'console' },
    installForms: {
      // `from: "0.1.0"` means ">= 0.1.0, < 1.0.0", the form the package
      // README recommends for a final release.
      release: { code: '.package(url: "https://github.com/libtmux/libtmux-swift", from: "{version}")', lang: 'swift' },
      // A prerelease sorts below its final, so a `from:` range skips it and
      // `exact:` is the only form that resolves one.
      prerelease: { code: '.package(url: "https://github.com/libtmux/libtmux-swift", exact: "{version}")', lang: 'swift' },
      git: { code: '.package(url: "https://github.com/libtmux/libtmux-swift", exact: "{tag}")', lang: 'swift' },
    },
    installNote:
      'A target depends on the product, not the package: write .product(name: "LibTmux", package: "libtmux-swift"). The library is `LibTmux` while the package identity SwiftPM derives from the URL is `libtmux-swift`, which is neither the product name nor the `name:` in the package manifest.',
  },
] as const

type WrapperLibrary = Omit<Port, 'repo' | 'checkout' | 'worktree' | 'tagGrammar' | 'tagPrefix' | 'versionedDocs' | 'renderer' | 'generator'> & {
  parentLibrary: { slug: string; runtime: string }
}

const WRAPPER_LIBRARIES: readonly WrapperLibrary[] = [
  {
    slug: 'kotlin', logoLanguage: 'kotlin', shortName: 'Kt', name: 'Kotlin', language: 'Kotlin',
    projectName: 'libtmux-kotlin',
    parentLibrary: { slug: 'java', runtime: 'JVM' },
    source: { path: 'libtmux-kotlin', ref: 'master' },
    packageName: 'io.github.libtmux:libtmux-kotlin',
    registry: { name: 'Maven Central', url: 'https://central.sonatype.com/artifact/io.github.libtmux/libtmux-kotlin', icon: 'maven' },
    ecosystemHost: { name: 'Dokka', url: 'https://javadoc.io/doc/io.github.libtmux/libtmux-kotlin', rationale: 'Kotlin API documentation from the Dokka archive published with the package.' },
    installs: [
      { label: 'Gradle', lang: 'kotlin', code: 'implementation("io.github.libtmux:libtmux-kotlin:{version}")' },
      { label: 'Maven', lang: 'xml', code: '<dependency>\n  <groupId>io.github.libtmux</groupId>\n  <artifactId>libtmux-kotlin</artifactId>\n  <version>{version}</version>\n</dependency>' },
    ],
    initProject: { code: 'gradle init --type kotlin-application --dsl kotlin', lang: 'console' },
    installForms: {
      release: { code: 'implementation("io.github.libtmux:libtmux-kotlin:{version}")', lang: 'kotlin' },
      prerelease: { code: 'implementation("io.github.libtmux:libtmux-kotlin:{version}")', lang: 'kotlin' },
      git: { code: 'git clone --branch {tag} https://github.com/libtmux/libtmux-java && (cd libtmux-java && ./gradlew :libtmux:publishToMavenLocal :libtmux-kotlin:publishToMavenLocal)', lang: 'console' },
    },
  },
  {
    slug: 'scala', logoLanguage: 'scala', shortName: 'Sc', name: 'Scala', language: 'Scala',
    projectName: 'libtmux-scala',
    parentLibrary: { slug: 'java', runtime: 'JVM' },
    source: { path: 'libtmux-scala', ref: 'master' },
    packageName: 'io.github.libtmux:libtmux-scala_3',
    registry: { name: 'Maven Central', url: 'https://central.sonatype.com/artifact/io.github.libtmux/libtmux-scala_3', icon: 'maven' },
    ecosystemHost: { name: 'Scaladoc', url: 'https://javadoc.io/doc/io.github.libtmux/libtmux-scala_3', rationale: 'Scala 3 API documentation from the Scaladoc archive published with the package.' },
    installs: [
      { label: 'sbt', lang: 'scala', code: 'libraryDependencies += "io.github.libtmux" %% "libtmux-scala" % "{version}"' },
      { label: 'Gradle', lang: 'kotlin', code: 'implementation("io.github.libtmux:libtmux-scala_3:{version}")' },
      { label: 'Maven', lang: 'xml', code: '<dependency>\n  <groupId>io.github.libtmux</groupId>\n  <artifactId>libtmux-scala_3</artifactId>\n  <version>{version}</version>\n</dependency>' },
    ],
    initProject: { code: 'sbt new scala/scala3.g8', lang: 'console' },
    installForms: {
      release: { code: 'libraryDependencies += "io.github.libtmux" %% "libtmux-scala" % "{version}"', lang: 'scala' },
      prerelease: { code: 'libraryDependencies += "io.github.libtmux" %% "libtmux-scala" % "{version}"', lang: 'scala' },
      git: { code: 'git clone --branch {tag} https://github.com/libtmux/libtmux-java && (cd libtmux-java && ./gradlew :libtmux:publishToMavenLocal :libtmux-scala:publishToMavenLocal)', lang: 'console' },
    },
  },
  {
    slug: 'fsharp', logoLanguage: 'fsharp', shortName: 'F#', name: 'F#', language: 'F#',
    projectName: 'libtmux-fsharp',
    parentLibrary: { slug: 'csharp', runtime: '.NET' },
    sourceReferenceDirectory: 'docs/fsharp-reference/reference',
    packageName: 'LibTmux.FSharp',
    registry: { name: 'NuGet', url: 'https://www.nuget.org/packages/LibTmux.FSharp', icon: 'nuget' },
    installs: nugetInstalls('LibTmux.FSharp', true),
    initProject: { code: 'dotnet new console --language F#', lang: 'console' },
    installForms: {
      release: { code: 'dotnet package add LibTmux.FSharp', lang: 'console' },
      prerelease: { code: 'dotnet package add LibTmux.FSharp --version {version}', lang: 'console' },
      git: { code: 'dotnet add reference ../libtmux-dotnet/src/LibTmux.FSharp/LibTmux.FSharp.fsproj', lang: 'console' },
    },
  },
]

/** Keep a library family adjacent without inheriting its companion products. */
export const PORTS: readonly Port[] = CORE_PORTS.flatMap((parent) => [
  parent,
  ...WRAPPER_LIBRARIES.filter((library) => library.parentLibrary.slug === parent.slug).map((library): Port => ({
    repo: parent.repo, checkout: parent.checkout, worktree: parent.worktree,
    docsDispatch: parent.docsDispatch && { ...parent.docsDispatch, language: library.slug },
    tagGrammar: parent.tagGrammar, tagPrefix: parent.tagPrefix,
    versionedDocs: parent.versionedDocs, renderer: 'none', generator: '', referenceKind: 'model',
    publishesOwnTree: true,
    ...library,
  })),
])

export const API_MODEL_PORTS = PORTS.filter((port) => port.referenceKind !== 'guide')

export const PORT_BY_SLUG: Readonly<Record<string, Port>> = Object.fromEntries(
  PORTS.map((p) => [p.slug, p]),
)

/** The tag a numeric docs version names, with the library's tag prefix. */
function releaseTag(port: Port, version: string): string | undefined {
  return /^v?\d/.test(version) ? `${port.tagPrefix ?? ''}${version}` : undefined
}

/** Where a library's directory is read: a revision, else its release tag, else its default branch. */
function portSourceRef(port: Port, version: string, revision?: string): string | undefined {
  return port.source && (revision ?? releaseTag(port, version) ?? port.source.ref)
}

/** Open a library's directory at its documented revision, tag, or default branch. */
export function portSourceUrl(port: Port, version = 'latest', revision?: string): string {
  const root = `https://github.com/${port.repo}`
  const ref = portSourceRef(port, version, revision)
  return port.source && ref ? `${root}/tree/${encodeURIComponent(ref)}/${port.source.path}` : root
}

/** A project outside the port catalog, such as tmux, that a links row can name. */
export interface ProjectLinks {
  name: string
  /** Source repository, `owner/name`. */
  repo: string
  homepage: string
}

export interface DestinationRequest {
  port?: Port
  /** Names the project's repository instead of a port's. */
  project?: ProjectLinks
  /** A companion product, whose own directory and package replace the library's. */
  product?: DocProduct
  version?: string
  /** Commit that the page's source citations are bound to. */
  revision?: string
}

export interface SourceDestination {
  url: string
  /** Repository the link opens, `owner/name`. */
  repo: string
  /** Directory within that repository, when the link opens one. */
  path?: string
  /** Branch, tag or commit of `path`. */
  ref?: string
}

/** Where a page's reader goes to read the source, install the package, or browse its API. */
export interface PortDestinations {
  source: SourceDestination
  /** The package's page on its registry, never a versioned release. */
  registry?: PackageRegistry
  /** An API host that is not the registry itself. */
  ecosystem?: EcosystemHost
}

/** A product's directory, or its repository when it has none of its own. */
function productSource(port: Port, source: PortPackage['source'], version: string, revision?: string): SourceDestination {
  const repo = source?.repo ?? port.repo
  if (!source) return { url: `https://github.com/${repo}`, repo }
  // An app in a separate repository has its own release history.
  const tag = repo === port.repo ? releaseTag(port, version) : undefined
  const ref = version === 'latest' ? source.ref : tag ?? revision ?? source.ref
  return { url: `https://github.com/${repo}/tree/${ref}/${source.path}`, repo, path: source.path, ref }
}

/**
 * The source, package and API destinations for a port, product or project.
 *
 * Every URL is external and carries no locale or preview prefix, so it is the
 * same from `/en/`, `/ja/` and `/pr-42/`. Registry and API URLs name the
 * package's page, not a release: the version this site documents is not
 * evidence that a package of that version exists.
 */
export function portDestinations({ port, project, product, version = 'latest', revision }: DestinationRequest): PortDestinations {
  if (!port && !project) throw new Error('portDestinations: a port or project is required')
  const pkg = product ? port?.packages?.find((entry) => entry.id === product) : undefined
  const source: SourceDestination = project ? { url: `https://github.com/${project.repo}`, repo: project.repo }
    : product ? productSource(port!, pkg?.source, version, revision)
      : { url: portSourceUrl(port!, version, revision), repo: port!.repo,
          ...(port!.source && { path: port!.source.path, ref: portSourceRef(port!, version, revision) }) }
  const registry = product
    ? pkg?.registry && port?.registry ? { ...port.registry, url: pkg.registry } : undefined
    : port?.registry

  return {
    source,
    registry,
    // Go's registry and reference host are the same destination.
    ecosystem: !product && port?.ecosystemHost && port.ecosystemHost.url !== registry?.url ? port.ecosystemHost : undefined,
  }
}

export type PickerGroup = 'core' | DocProduct

export const PICKER_GROUP_LABEL: Readonly<Record<PickerGroup, string>> = {
  core: 'Core Library', mcp: DOC_PRODUCTS.mcp.label, workspace: DOC_PRODUCTS.workspace.label,
}
/** The line under a group's name in every picker, so a product reads the same in each. */
export const PICKER_GROUP_SUMMARY: Readonly<Record<PickerGroup, string>> = {
  core: 'API reference and guides', mcp: 'Tools for connected assistants', workspace: 'Repeatable development environments',
}

/** Whether a companion product has a published implementation for a port. */
export function productAvailable(port: Port, product: DocProduct): boolean {
  return !port.parentLibrary && port.productAvailability?.[product] !== 'unpublished'
}

/** Non-Python companions dogfood their core library as concept examples. */
export function productIsConcept(port: Port, product: DocProduct): boolean {
  return port.slug !== 'py' && productAvailable(port, product)
}

export function productConceptNotice(port: Port, product: DocProduct): { title: string; body: string } | undefined {
  return productIsConcept(port, product)
    ? { title: `${DOC_PRODUCTS[product].label} concept example`, body: CONCEPT_DESCRIPTION }
    : undefined
}

/** Whether the package picker has a concrete install form for this package. */
export function hasPackageInstalls(port: Port, packageId: PortPackageId): boolean {
  if (packageId === 'core') return port.installs.length > 0
  return Boolean(port.packages?.find((entry) => entry.id === packageId)?.installs?.length)
}

/**
 * User-facing workspace loaders are distinct from unfinished builder
 * libraries, and local loader availability does not establish release
 * readiness.
 */
export function productInDevelopment(port: Port, product: DocProduct): boolean {
  if (!productAvailable(port, product)) return false
  return product === 'mcp' || port.workspaceCliAvailability !== 'released'
}

/** Workspace overview support scope and installation prerequisites. */
export function workspaceOverviewNotice(port: Port): { title: string; body: string } | undefined {
  if (!productAvailable(port, 'workspace')) return undefined
  const concept = productConceptNotice(port, 'workspace')
  if (!port.workspaceCli) return concept
  const title = concept?.title ?? `Workspace Manager for ${port.name} is in development.`
  const scope = concept ? `${concept.body} ` : ''
  const command = port.workspaceCli.split(/\s+/)[0]
  if (port.workspaceCliAvailability === 'published') {
    return {
      title,
      body: scope + `The \`${command}\` CLI is published to ${port.registry?.name ?? 'the package registry'}, `
        + 'numbered 0.1.N. Pin its version when automation depends on its output.',
    }
  }
  if (port.workspaceCliAvailability !== 'local') return concept
  return {
    title,
    body: scope + `Build \`${command}\` from the source revision in the installation guide. `
      + 'Its CLI and workspace library have separate installation and configuration contracts.',
  }
}

export function productDescription(port: Port, product: DocProduct): string {
  if (!productAvailable(port, product)) return 'Not available for this language port.'
  if (port.productDescriptions?.[product]) return port.productDescriptions[product]!
  if (product === 'workspace') {
    if (port.workspaceCliAvailability === 'local')
      return `Build the CLI from source and load workspace files with ${port.workspaceCli}.`
    if (port.workspaceCliAvailability === 'published')
      return `Load workspace files with the published ${port.workspaceCli} CLI.`
    return port.workspaceCli
      ? `Load workspace configuration files with ${port.workspaceCli}.`
      : 'In development. Workspace builder internals; no workspace loader CLI.'
  }
  return `In development. ${DOC_PRODUCTS.mcp.description}`
}

/**
 * Where a reference tree sits under a port and version.
 *
 * Three packages, three trees. The core library answers at `reference/`, and
 * the Workspace Manager and the MCP server — separately versioned packages
 * that happen to be documented beside it — answer under their own section.
 * One spelling for all three, because a reader who has found one should be
 * able to guess the others.
 */
export function referenceSegment(product: DocProduct | 'core'): string {
  return product === 'core' ? 'reference' : `${product}/reference`
}

/** Language APIs for workspace builders belong to implementation documentation. */
export function productApiPath(product: DocProduct): string {
  return referenceSegment(product)
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

/**
 * URL of the reference extracted and rendered by this site.
 *
 * Versioned like every other page under a port, because it documents one
 * release of one package: `/go/latest/reference/` is the Go core library's
 * API, and its Workspace Manager and MCP server answer beside it rather than
 * inside it.
 */
export function referenceUrl(port: Port, version: string, product: DocProduct | 'core' = 'core'): string {
  return portPageUrl(port, version, referenceSegment(product))
}

/** URL of a prose page within a port and version; callers check availability. */
export function portPageUrl(port: Port, version: string, pagePath = ''): string {
  const rest = pagePath.replace(/^\/+|\/+$/g, '')

  // A port's own `api` page is the reference it now sits beside.
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
export type RegistryStatus = 'release' | 'prerelease' | 'unpublished'

/**
 * A final release's series: its major number and `.x`, such as `0.x`. Any
 * libtmux release may change the API, so a badge names the series a release
 * belongs to and promises nothing about it.
 */
export type ReleaseSeries = `${number}.x`

/** How far along a package's releases are, as its registry or its version names the stage. */
export type Maturity = 'pre-alpha' | 'alpha' | 'beta' | 'rc' | ReleaseSeries | 'unreleased'

export interface RegistryEntry {
  status: RegistryStatus
  /** Newest installable version, or null when the registry has no package. */
  version: string | null
  /** Newest final release, or null when there has never been one. */
  release: string | null
  /** Newest release tag in the repository, prefix included where one is used. */
  tag: string | null
  /** The stage the registry itself declares, such as PyPI's Development Status classifier. */
  maturity?: Maturity
  /** Independently published packages documented under this port. */
  packages?: Record<string, RegistryEntry>
}

export interface RegistryData {
  schema: 2
  ports: Record<string, RegistryEntry>
}

/**
 * A final release name: `MAJOR.MINOR.PATCH` without leading zeros, an optional
 * `v`, and an optional package label ending in `@` or `/`, as in
 * `libtmux@v0.1.0` or `workspace/v0.1.0`. Nothing may follow the patch number,
 * so a prerelease, dev, post or build marker never matches.
 */
const FINAL_RELEASE = /^(?:[A-Za-z][\w.-]*[@/])?v?(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}$/

/** A final release's major number, label and `v` allowed, as in `libtmux@v0.1.0` or `0.1.0-1`. */
const MAJOR = /^(?:[A-Za-z][\w.-]*[@/])?v?(\d+)\./

/** The series a final release belongs to, `0.x` for `0.1.0`. */
const releaseSeries = (name: string | null): ReleaseSeries => `${Number(MAJOR.exec(name ?? '')?.[1] ?? 0)}.x`

/** Whether a maturity names a final release's series rather than a prerelease stage. */
export const isReleaseSeries = (maturity: Maturity): maturity is ReleaseSeries => /^\d+\.x$/.test(maturity)

/**
 * A package's release maturity: the stage its registry declares, else the one
 * its version or repository tag names. A final release reads as its series,
 * such as `0.x`, whether or not a registry carries it yet. A package with no
 * release and no tag is unreleased. Throws on a name whose marker is neither a
 * stage nor absent, so a new spelling fails a test rather than a reader's badge.
 */
export function releaseMaturity(entry: RegistryEntry): Maturity {
  if (entry.maturity) return entry.maturity
  if (entry.status === 'release') return releaseSeries(entry.release ?? entry.version ?? entry.tag)
  const name = entry.version ?? entry.tag
  if (!name) return 'unreleased'
  // Before the stage search, so a stage word in a package label is not the release's stage.
  if (FINAL_RELEASE.test(name)) return releaseSeries(name)
  const stage = /alpha|beta|rc(?=[\d.-]|$)|(?<=\d)[ab](?=\d)/i.exec(name)?.[0].toLowerCase()
  if (stage === 'alpha' || stage === 'a') return 'alpha'
  if (stage === 'beta' || stage === 'b') return 'beta'
  if (stage === 'rc') return 'rc'
  throw new Error(`releaseMaturity: no release stage in "${name}"`)
}

/** What a product's badge states: its release maturity, or `concept` for a working example. */
export type ProductStatus = 'concept' | Maturity

const STAGE_LINE: Readonly<Record<Exclude<ProductStatus, ReleaseSeries>, string>> = {
  concept: 'Working example; may change without notice.',
  'pre-alpha': 'Early development; expect breaking changes.',
  alpha: 'Alpha release; the API may change.',
  beta: 'Beta release; the API may still change.',
  rc: 'Release candidate; close to final.',
  unreleased: 'Not published yet; install from source.',
}

/**
 * The one short line under each badge's toggletip and in the picker's
 * description. The full explanation lives on the page that the toggletip links to.
 */
export function productStatusLine(status: ProductStatus): string {
  return status === 'concept' || !isReleaseSeries(status) ? STAGE_LINE[status as keyof typeof STAGE_LINE] : 'Released; the API may change.'
}

/** The link under every toggletip line. */
export const PRODUCT_STATUS_LINK = 'Read more'

/** The page that explains each badge, and the section that does. */
export const PRODUCT_STATUS_GUIDE = '/meta/support/#concept-and-alpha'

/**
 * The badge a product row carries, from the same data as its install command.
 *
 * A companion in a port other than Python is a concept example, so `concept`
 * leads its release stage. Python's own companions state the stage their PyPI
 * project declares. The core library states its registry stage.
 */
export function productStatus(port: Port, product: 'core' | DocProduct, registry: RegistryData): ProductStatus | undefined {
  if (product !== 'core' && productIsConcept(port, product)) return 'concept'
  const entry = registry.ports[port.slug]
  const found = product === 'core' ? entry : entry?.packages?.[port.packages?.find((item) => item.id === product)?.name ?? '']
  return found ? releaseMaturity(found) : undefined
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
  if (entry.status === 'release' && entry.release) return fill(forms.release, '{version}', entry.release)
  if (entry.status === 'prerelease' && entry.version) {
    return fill(forms.prerelease, '{version}', entry.version)
  }
  // Unpublished, or published with nothing resolvable. The repository is the
  // only place the code exists, so the tag is the version.
  if (!entry.tag) {
    // A repository with no release tag installs its default branch, and the
    // git form then names that branch instead of taking a `{tag}`.
    if (!forms.git.code.includes('{tag}')) return forms.git
    throw new Error(
      `installCommand: ${port.slug} has no registry version and no release tag; ` +
        'run node scripts/gen-registry.mjs',
    )
  }
  return fill(forms.git, '{tag}', entry.tag)
}

/** How to say what the reader is installing, for a prompt that must not overclaim. */
export function releaseWording(port: Port, entry: RegistryEntry): string {
  if (entry.status === 'release') {
    return `${port.packageName} ${entry.release} is the current release on ${port.registry?.name ?? 'its registry'}.`
  }
  if (entry.status === 'prerelease') {
    return `${port.packageName} has no final release. ${entry.version} is the newest prerelease on ${port.registry?.name ?? 'its registry'}, and the command below names it because the resolver skips prereleases otherwise.`
  }
  const registry = port.registry?.name ?? 'its registry'
  if (!entry.tag) {
    return `${port.packageName} is not published to ${registry} yet and the repository has no release tag, so this installs from its default branch.`
  }
  // A git form with no `{tag}` installs a fixed ref, so the tag is not what runs.
  if (!port.installForms.git.code.includes('{tag}')) {
    return `${port.packageName} is not published to ${registry} yet, so this installs from the repository's default branch. The newest release tag is ${entry.tag}.`
  }
  return `${port.packageName} is not published to ${registry} yet, so this installs from the repository at tag ${entry.tag}.`
}

/** Artwork identity for a port page, reference, or shared product landing. */
export function pageBrand(portSlug?: string, pagePath = ''): { language: string; variant: 'library' | 'workspace' | 'mcp' } {
  const segments = pagePath.toLowerCase().split('/').filter(Boolean)
  const port = PORT_BY_SLUG[portSlug ?? ''] ?? PORT_BY_SLUG[segments[0] === 'reference' ? segments[1] ?? '' : '']
  let language = port?.logoLanguage ?? 'python'
  if (port?.slug === 'java') {
    if (segments.some((segment) => /(^|[-.])kotlin($|[-.])/.test(segment))) language = 'kotlin'
    else if (segments.some((segment) => /(^|[-.])scala($|[-.])/.test(segment))) language = 'scala'
  } else if (port?.slug === 'csharp' && segments.some((segment) => /(^|[-.])fsharp($|[-.])/.test(segment))) {
    language = 'fsharp'
  }
  const variant = segments.some((segment) => /^(?:libtmux[-.]|tmux-)?mcp(?:[.-]|$)/.test(segment)) ? 'mcp'
    : segments.some((segment) => /^(?:libtmux[-.]|tmux-)?workspace(?:[.-]|$)/.test(segment)) ? 'workspace' : 'library'
  return { language, variant }
}
