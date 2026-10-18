/**
 * The rows each registered port's header menus should offer, written from the
 * destinations verified against the live hosts rather than computed from
 * `ports.ts`. A row is `[group, label, detail, url]`; the menus list the core
 * library first, then the MCP server, then the workspace manager.
 *
 * Julia and C++ publish no package, so they have no package menu. Only Rust,
 * Go, Java, Kotlin, Scala and Swift have an off-site API reference.
 */
export type ExpectedRow = readonly ['core' | 'mcp' | 'workspace', label: string, detail: string, url: string]

export interface ExpectedPickers {
  github: readonly ExpectedRow[]
  packages?: readonly ExpectedRow[]
  docs?: readonly ExpectedRow[]
}

const repo = (name: string) => `https://github.com/${name}`
const dir = (name: string, path: string) => `https://github.com/${name}/tree/master/${path}`
const spiDocs = (target: string) => `https://swiftpackageindex.com/libtmux/libtmux-swift/documentation/${target}`
const pkgsite = (path: string) => `https://pkg.go.dev/github.com/libtmux/libtmux-go/${path}`
const central = (artifact: string) => `https://central.sonatype.com/artifact/io.github.libtmux/${artifact}`
const javadoc = (artifact: string) => `https://javadoc.io/doc/io.github.libtmux/${artifact}`

export const PICKERS: Record<string, ExpectedPickers> = {
  py: {
    github: [
      ['core', 'libtmux', 'tmux-python/libtmux', repo('tmux-python/libtmux')],
      ['mcp', 'libtmux-mcp', 'tmux-python/libtmux-mcp', repo('tmux-python/libtmux-mcp')],
      ['workspace', 'tmuxp', 'tmux-python/tmuxp', repo('tmux-python/tmuxp')],
    ],
    packages: [
      ['core', 'libtmux', 'PyPI', 'https://pypi.org/project/libtmux/'],
      ['mcp', 'libtmux-mcp', 'PyPI', 'https://pypi.org/project/libtmux-mcp/'],
      ['workspace', 'tmuxp', 'PyPI', 'https://pypi.org/project/tmuxp/'],
    ],
  },
  ruby: {
    github: [
      ['core', 'libtmux-ruby', 'libtmux/libtmux-ruby', repo('libtmux/libtmux-ruby')],
      ['core', 'libtmux', 'libtmux-ruby/gems/libtmux', dir('libtmux/libtmux-ruby', 'gems/libtmux')],
      ['core', 'libtmux-async', 'libtmux-ruby/gems/libtmux-async', dir('libtmux/libtmux-ruby', 'gems/libtmux-async')],
      ['mcp', 'libtmux-mcp', 'libtmux-ruby/gems/libtmux-mcp', dir('libtmux/libtmux-ruby', 'gems/libtmux-mcp')],
      ['workspace', 'libtmux-workspace', 'libtmux-ruby/gems/libtmux-workspace', dir('libtmux/libtmux-ruby', 'gems/libtmux-workspace')],
    ],
    packages: [
      ['core', 'libtmux', 'RubyGems', 'https://rubygems.org/gems/libtmux'],
      ['core', 'libtmux-async', 'RubyGems', 'https://rubygems.org/gems/libtmux-async'],
      ['mcp', 'libtmux-mcp', 'RubyGems', 'https://rubygems.org/gems/libtmux-mcp'],
      ['workspace', 'libtmux-workspace', 'RubyGems', 'https://rubygems.org/gems/libtmux-workspace'],
    ],
  },
  lua: {
    github: [['core', 'libtmux-lua', 'libtmux/libtmux-lua', repo('libtmux/libtmux-lua')]],
    packages: [['core', 'libtmux', 'LuaRocks', 'https://luarocks.org/modules/tony/libtmux']],
  },
  powershell: {
    github: [
      ['core', 'LibTmux', 'libtmux-powershell/src/LibTmux.PowerShell', dir('libtmux/libtmux-powershell', 'src/LibTmux.PowerShell')],
      ['core', 'libtmux-powershell', 'libtmux/libtmux-powershell', repo('libtmux/libtmux-powershell')],
      ['workspace', 'LibTmux.Workspace', 'libtmux-powershell/src/LibTmux.Workspace.PowerShell', dir('libtmux/libtmux-powershell', 'src/LibTmux.Workspace.PowerShell')],
    ],
    packages: [
      ['core', 'LibTmux', 'PowerShell Gallery', 'https://www.powershellgallery.com/packages/LibTmux'],
      ['workspace', 'LibTmux.Workspace', 'PowerShell Gallery', 'https://www.powershellgallery.com/packages/LibTmux.Workspace'],
    ],
  },
  julia: {
    github: [
      ['core', 'LibTmux', 'libtmux-julia/src', dir('libtmux/libtmux-julia', 'src')],
      ['core', 'libtmux-julia', 'libtmux/libtmux-julia', repo('libtmux/libtmux-julia')],
      ['mcp', 'LibTmuxMCP', 'libtmux-julia/packages/LibTmuxMCP', dir('libtmux/libtmux-julia', 'packages/LibTmuxMCP')],
      ['workspace', 'LibTmuxWorkspace', 'libtmux-julia/packages/LibTmuxWorkspace', dir('libtmux/libtmux-julia', 'packages/LibTmuxWorkspace')],
    ],
  },
  ts: {
    github: [
      ['core', 'libtmux-ts', 'libtmux/libtmux-ts', repo('libtmux/libtmux-ts')],
      ['core', 'libtmux', 'libtmux-ts/packages/libtmux', dir('libtmux/libtmux-ts', 'packages/libtmux')],
      ['mcp', '@libtmux/mcp', 'libtmux-ts/packages/mcp', dir('libtmux/libtmux-ts', 'packages/mcp')],
      ['workspace', '@libtmux/workspace', 'libtmux-ts/packages/workspace', dir('libtmux/libtmux-ts', 'packages/workspace')],
      ['workspace', '@libtmux/workspace-cli', 'libtmux-ts/packages/workspace-cli', dir('libtmux/libtmux-ts', 'packages/workspace-cli')],
    ],
    packages: [
      ['core', 'libtmux', 'npm', 'https://www.npmjs.com/package/libtmux'],
      ['mcp', '@libtmux/mcp', 'npm', 'https://www.npmjs.com/package/@libtmux/mcp'],
      ['workspace', '@libtmux/workspace', 'npm', 'https://www.npmjs.com/package/@libtmux/workspace'],
      ['workspace', '@libtmux/workspace-cli', 'npm', 'https://www.npmjs.com/package/@libtmux/workspace-cli'],
    ],
  },
  rs: {
    github: [
      ['core', 'libtmux-rs', 'libtmux/libtmux-rs', repo('libtmux/libtmux-rs')],
      ['core', 'libtmux', 'libtmux-rs/crates/libtmux', dir('libtmux/libtmux-rs', 'crates/libtmux')],
      ['core', 'libtmux-macros', 'libtmux-rs/crates/libtmux-macros', dir('libtmux/libtmux-rs', 'crates/libtmux-macros')],
      ['mcp', 'tmux-mcp', 'libtmux-rs/crates/tmux-mcp', dir('libtmux/libtmux-rs', 'crates/tmux-mcp')],
      ['workspace', 'tmux-workspace', 'libtmux-rs/crates/tmux-workspace', dir('libtmux/libtmux-rs', 'crates/tmux-workspace')],
    ],
    packages: [
      ['core', 'libtmux', 'crates.io', 'https://crates.io/crates/libtmux'],
      ['core', 'libtmux-macros', 'crates.io', 'https://crates.io/crates/libtmux-macros'],
      ['mcp', 'tmux-mcp', 'crates.io', 'https://crates.io/crates/tmux-mcp'],
      ['workspace', 'tmux-workspace', 'crates.io', 'https://crates.io/crates/tmux-workspace'],
    ],
    docs: [
      ['core', 'libtmux', 'docs.rs', 'https://docs.rs/libtmux'],
      ['core', 'libtmux-macros', 'docs.rs', 'https://docs.rs/libtmux-macros'],
      ['mcp', 'tmux-mcp', 'docs.rs', 'https://docs.rs/tmux-mcp'],
      ['workspace', 'tmux-workspace', 'docs.rs', 'https://docs.rs/tmux-workspace'],
    ],
  },
  go: {
    github: [
      ['core', 'libtmux-go', 'libtmux/libtmux-go', repo('libtmux/libtmux-go')],
      ['core', 'tmux', 'libtmux-go/tmux', dir('libtmux/libtmux-go', 'tmux')],
      ['mcp', 'mcp', 'libtmux-go/mcp/cmd/libtmux-mcp', dir('libtmux/libtmux-go', 'mcp/cmd/libtmux-mcp')],
      ['workspace', 'workspace', 'libtmux-go/workspace/cmd/tmux-workspace', dir('libtmux/libtmux-go', 'workspace/cmd/tmux-workspace')],
    ],
    packages: [
      ['core', 'tmux', 'github.com/libtmux/libtmux-go/tmux · pkg.go.dev', pkgsite('tmux')],
      ['mcp', 'mcp', 'github.com/libtmux/libtmux-go/mcp · pkg.go.dev', pkgsite('mcp')],
      ['workspace', 'workspace', 'github.com/libtmux/libtmux-go/workspace · pkg.go.dev', pkgsite('workspace')],
    ],
    docs: [
      ['core', 'tmux', 'github.com/libtmux/libtmux-go/tmux · pkg.go.dev', pkgsite('tmux')],
      ['core', 'tmuxq', 'github.com/libtmux/libtmux-go/tmuxq · pkg.go.dev', pkgsite('tmuxq')],
      ['core', 'tmux/tmuxtest', 'github.com/libtmux/libtmux-go/tmux/tmuxtest · pkg.go.dev', pkgsite('tmux/tmuxtest')],
      ['mcp', 'mcp', 'github.com/libtmux/libtmux-go/mcp · pkg.go.dev', pkgsite('mcp')],
      ['workspace', 'workspace', 'github.com/libtmux/libtmux-go/workspace · pkg.go.dev', pkgsite('workspace')],
    ],
  },
  java: {
    github: [
      ['core', 'libtmux-java', 'libtmux/libtmux-java', repo('libtmux/libtmux-java')],
      ['core', 'libtmux', 'libtmux-java/libtmux', dir('libtmux/libtmux-java', 'libtmux')],
      ['core', 'libtmux-kotlin', 'libtmux-java/libtmux-kotlin', dir('libtmux/libtmux-java', 'libtmux-kotlin')],
      ['core', 'libtmux-scala', 'libtmux-java/libtmux-scala', dir('libtmux/libtmux-java', 'libtmux-scala')],
      ['mcp', 'libtmux-mcp', 'libtmux-java/libtmux-mcp', dir('libtmux/libtmux-java', 'libtmux-mcp')],
      ['workspace', 'libtmux-workspace-cli', 'libtmux-java/libtmux-workspace-cli', dir('libtmux/libtmux-java', 'libtmux-workspace-cli')],
    ],
    packages: [
      ['core', 'libtmux', 'io.github.libtmux:libtmux · Maven Central', central('libtmux')],
      ['mcp', 'libtmux-mcp', 'io.github.libtmux:libtmux-mcp · Maven Central', central('libtmux-mcp')],
      ['workspace', 'libtmux-workspace-cli', 'io.github.libtmux:libtmux-workspace-cli · Maven Central', central('libtmux-workspace-cli')],
    ],
    // javadoc.io has no documentation for libtmux-workspace-cli, so it has no row.
    docs: [
      ['core', 'libtmux', 'io.github.libtmux:libtmux · javadoc.io', javadoc('libtmux')],
      ['mcp', 'libtmux-mcp', 'io.github.libtmux:libtmux-mcp · javadoc.io', javadoc('libtmux-mcp')],
    ],
  },
  kotlin: {
    github: [
      ['core', 'libtmux-kotlin', 'libtmux-java/libtmux-kotlin', dir('libtmux/libtmux-java', 'libtmux-kotlin')],
      ['core', 'libtmux-java', 'libtmux/libtmux-java', repo('libtmux/libtmux-java')],
    ],
    packages: [['core', 'libtmux-kotlin', 'io.github.libtmux:libtmux-kotlin · Maven Central', central('libtmux-kotlin')]],
    docs: [['core', 'libtmux-kotlin', 'io.github.libtmux:libtmux-kotlin · Dokka · javadoc.io', javadoc('libtmux-kotlin')]],
  },
  scala: {
    github: [
      ['core', 'libtmux-scala_3', 'libtmux-java/libtmux-scala', dir('libtmux/libtmux-java', 'libtmux-scala')],
      ['core', 'libtmux-java', 'libtmux/libtmux-java', repo('libtmux/libtmux-java')],
    ],
    packages: [['core', 'libtmux-scala_3', 'io.github.libtmux:libtmux-scala_3 · Maven Central', central('libtmux-scala_3')]],
    docs: [['core', 'libtmux-scala_3', 'io.github.libtmux:libtmux-scala_3 · Scaladoc · javadoc.io', javadoc('libtmux-scala_3')]],
  },
  csharp: {
    github: [
      ['core', 'libtmux-dotnet', 'libtmux/libtmux-dotnet', repo('libtmux/libtmux-dotnet')],
      ['core', 'LibTmux', 'libtmux-dotnet/src/LibTmux', dir('libtmux/libtmux-dotnet', 'src/LibTmux')],
      ['core', 'LibTmux.FSharp', 'libtmux-dotnet/src/LibTmux.FSharp', dir('libtmux/libtmux-dotnet', 'src/LibTmux.FSharp')],
      ['mcp', 'LibTmux.Mcp', 'libtmux-dotnet/src/LibTmux.Mcp', dir('libtmux/libtmux-dotnet', 'src/LibTmux.Mcp')],
      ['workspace', 'LibTmux.Workspace.Cli', 'libtmux-dotnet/src/LibTmux.Workspace.Cli', dir('libtmux/libtmux-dotnet', 'src/LibTmux.Workspace.Cli')],
    ],
    packages: [
      ['core', 'LibTmux', 'NuGet', 'https://www.nuget.org/packages/LibTmux'],
      ['mcp', 'LibTmux.Mcp', 'NuGet', 'https://www.nuget.org/packages/LibTmux.Mcp'],
      ['workspace', 'LibTmux.Workspace.Cli', 'NuGet', 'https://www.nuget.org/packages/LibTmux.Workspace.Cli'],
    ],
  },
  fsharp: {
    github: [
      ['core', 'libtmux-dotnet', 'libtmux/libtmux-dotnet', repo('libtmux/libtmux-dotnet')],
      ['core', 'LibTmux.FSharp', 'libtmux-dotnet/src/LibTmux.FSharp', dir('libtmux/libtmux-dotnet', 'src/LibTmux.FSharp')],
    ],
    packages: [['core', 'LibTmux.FSharp', 'NuGet', 'https://www.nuget.org/packages/LibTmux.FSharp']],
  },
  cxx: {
    github: [
      ['core', 'libtmux-cxx', 'libtmux/libtmux-cxx', repo('libtmux/libtmux-cxx')],
      ['mcp', 'libtmux-mcp-server', 'libtmux-cxx/apps/mcp', dir('libtmux/libtmux-cxx', 'apps/mcp')],
      ['workspace', 'tmux-workspace', 'libtmux-cxx/apps/workspace', dir('libtmux/libtmux-cxx', 'apps/workspace')],
    ],
  },
  swift: {
    github: [
      ['core', 'libtmux-swift', 'libtmux/libtmux-swift', repo('libtmux/libtmux-swift')],
      ['core', 'LibTmux', 'libtmux-swift/Sources/LibTmux', dir('libtmux/libtmux-swift', 'Sources/LibTmux')],
      ['mcp', 'libtmux-mcp', 'libtmux-swift/Sources/LibTmuxMCP', dir('libtmux/libtmux-swift', 'Sources/LibTmuxMCP')],
      ['workspace', 'tmux-workspace', 'libtmux-swift/Sources/TmuxWorkspaceCLI', dir('libtmux/libtmux-swift', 'Sources/TmuxWorkspaceCLI')],
    ],
    // One package page: the workspace and MCP entries share the Swift Package Index URL.
    packages: [['core', 'libtmux-swift', 'Swift Package Index', 'https://swiftpackageindex.com/libtmux/libtmux-swift']],
    docs: [
      ['core', 'LibTmux', 'Swift Package Index', spiDocs('libtmux')],
      ['mcp', 'LibTmuxMCP', 'Swift Package Index', spiDocs('libtmuxmcp')],
      ['workspace', 'TmuxWorkspace', 'Swift Package Index', spiDocs('tmuxworkspace')],
    ],
  },
}
