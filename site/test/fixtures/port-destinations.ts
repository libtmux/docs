/**
 * The source, package and API link each registered port should offer, with the
 * accessible name a header link carries. Julia and C++ have no registry, so
 * their repository is the destination; Go's reference host is its registry.
 */
export interface ExpectedLink {
  url: string
  /** Display name of the registry or API host. */
  name?: string
  icon?: string
  label: string
}

export interface ExpectedDestinations {
  source: ExpectedLink
  registry?: ExpectedLink
  api?: ExpectedLink
}

const github = (url: string, name: string): ExpectedLink => ({ url, label: `${name} on GitHub` })

export const DESTINATIONS: Record<string, ExpectedDestinations> = {
  py: {
    source: github('https://github.com/tmux-python/libtmux', 'libtmux'),
    registry: { name: 'PyPI', url: 'https://pypi.org/project/libtmux/', icon: 'pypi', label: 'libtmux on PyPI' },
  },
  ruby: {
    source: github('https://github.com/libtmux/libtmux-ruby', 'libtmux-ruby'),
    registry: { name: 'RubyGems', url: 'https://rubygems.org/gems/libtmux', icon: 'rubygems', label: 'libtmux on RubyGems' },
  },
  lua: {
    source: github('https://github.com/libtmux/libtmux-lua', 'libtmux-lua'),
    registry: { name: 'LuaRocks', url: 'https://luarocks.org/modules/tony/libtmux', icon: 'luarocks', label: 'libtmux on LuaRocks' },
  },
  powershell: {
    source: github('https://github.com/libtmux/libtmux-powershell/tree/master/src/LibTmux.PowerShell', 'libtmux-powershell/src/LibTmux.PowerShell'),
    registry: { name: 'PowerShell Gallery', url: 'https://www.powershellgallery.com/packages/LibTmux', icon: 'powershell', label: 'LibTmux on PowerShell Gallery' },
  },
  julia: {
    source: github('https://github.com/libtmux/libtmux-julia/tree/master/src', 'libtmux-julia/src'),
  },
  elixir: {
    source: github('https://github.com/libtmux/libtmux-elixir/tree/main/lib', 'libtmux-elixir/lib'),
    registry: { name: 'Hex', url: 'https://hex.pm/packages/libtmux', icon: 'hex', label: 'libtmux on Hex' },
    api: { name: 'HexDocs', url: 'https://libtmux.hexdocs.pm/', label: 'libtmux API reference on HexDocs' },
  },
  ts: {
    source: github('https://github.com/libtmux/libtmux-ts', 'libtmux-ts'),
    registry: { name: 'npm', url: 'https://www.npmjs.com/package/libtmux', icon: 'npm', label: 'libtmux on npm' },
  },
  rs: {
    source: github('https://github.com/libtmux/libtmux-rs', 'libtmux-rs'),
    registry: { name: 'crates.io', url: 'https://crates.io/crates/libtmux', icon: 'crates', label: 'libtmux on crates.io' },
    api: { name: 'docs.rs', url: 'https://docs.rs/libtmux', label: 'libtmux API reference on docs.rs' },
  },
  go: {
    source: github('https://github.com/libtmux/libtmux-go', 'libtmux-go'),
    registry: {
      name: 'pkg.go.dev', url: 'https://pkg.go.dev/github.com/libtmux/libtmux-go/tmux', icon: 'go',
      label: 'github.com/libtmux/libtmux-go/tmux on pkg.go.dev',
    },
  },
  java: {
    source: github('https://github.com/libtmux/libtmux-java', 'libtmux-java'),
    registry: {
      name: 'Maven Central', url: 'https://central.sonatype.com/artifact/io.github.libtmux/libtmux', icon: 'maven',
      label: 'io.github.libtmux:libtmux on Maven Central',
    },
    api: {
      name: 'javadoc.io', url: 'https://javadoc.io/doc/io.github.libtmux/libtmux',
      label: 'io.github.libtmux:libtmux API reference on javadoc.io',
    },
  },
  kotlin: {
    source: github('https://github.com/libtmux/libtmux-java/tree/master/libtmux-kotlin', 'libtmux-java/libtmux-kotlin'),
    registry: {
      name: 'Maven Central', url: 'https://central.sonatype.com/artifact/io.github.libtmux/libtmux-kotlin', icon: 'maven',
      label: 'io.github.libtmux:libtmux-kotlin on Maven Central',
    },
    api: {
      name: 'Dokka', url: 'https://javadoc.io/doc/io.github.libtmux/libtmux-kotlin',
      label: 'io.github.libtmux:libtmux-kotlin API reference on Dokka',
    },
  },
  scala: {
    source: github('https://github.com/libtmux/libtmux-java/tree/master/libtmux-scala', 'libtmux-java/libtmux-scala'),
    registry: {
      name: 'Maven Central', url: 'https://central.sonatype.com/artifact/io.github.libtmux/libtmux-scala_3', icon: 'maven',
      label: 'io.github.libtmux:libtmux-scala_3 on Maven Central',
    },
    api: {
      name: 'Scaladoc', url: 'https://javadoc.io/doc/io.github.libtmux/libtmux-scala_3',
      label: 'io.github.libtmux:libtmux-scala_3 API reference on Scaladoc',
    },
  },
  csharp: {
    source: github('https://github.com/libtmux/libtmux-dotnet', 'libtmux-dotnet'),
    registry: { name: 'NuGet', url: 'https://www.nuget.org/packages/LibTmux', icon: 'nuget', label: 'LibTmux on NuGet' },
  },
  fsharp: {
    source: github('https://github.com/libtmux/libtmux-dotnet', 'libtmux-dotnet'),
    registry: { name: 'NuGet', url: 'https://www.nuget.org/packages/LibTmux.FSharp', icon: 'nuget', label: 'LibTmux.FSharp on NuGet' },
  },
  cxx: {
    source: github('https://github.com/libtmux/libtmux-cxx', 'libtmux-cxx'),
  },
  swift: {
    source: github('https://github.com/libtmux/libtmux-swift', 'libtmux-swift'),
    registry: {
      name: 'Swift Package Index', url: 'https://swiftpackageindex.com/libtmux/libtmux-swift', icon: 'swift',
      label: 'libtmux-swift on Swift Package Index',
    },
  },
}
