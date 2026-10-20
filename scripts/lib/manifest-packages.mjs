/**
 * What a port's owning manifests and publication configuration say it ships.
 *
 * Each reader takes a read-only view of one repository at one revision and
 * returns the distributions it publishes (the unit a registry versions) and the
 * units that ship inside them (Go packages and commands, SwiftPM products and
 * targets, Julia extensions and embedded modules). A distribution counts as
 * published by the ecosystem's own switch: a non-private `package.json`, a
 * Cargo package without `publish = false`, a Go module with a release tag
 * series, a Gradle module that applies a publication plugin, a `.csproj` that is
 * packable, a module manifest, a release file.
 *
 * Nothing here runs a build tool. The files are parsed as text.
 */
import { execFileSync } from 'node:child_process'

/** A read-only view of one repository at one revision. */
export function repositoryAt(checkout, revision) {
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  let files
  return {
    revision,
    /** Every path in the tree. */
    files: () => (files ??= git('ls-tree', '-r', '--name-only', revision).split('\n').filter(Boolean)),
    read: (path) => git('show', `${revision}:${path}`),
    has: (path) => { try { git('cat-file', '-e', `${revision}:${path}`); return true } catch { return false } },
    /** Whether the checkout holds the revision at all. */
    exists: () => { try { git('cat-file', '-e', `${revision}^{commit}`); return true } catch { return false } },
    /** Tags reachable from the revision: a release is a tag its history contains. */
    tags: () => git('tag', '--merged', revision).split('\n').filter(Boolean),
  }
}

const quoted = (text, key) => new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm').exec(text)?.[1]
/** The lines of one `[section]` of a TOML file, up to the next table. */
function section(text, name) {
  const start = text.split('\n').findIndex((line) => line.trim() === `[${name}]`)
  if (start < 0) return ''
  const rest = text.split('\n').slice(start + 1)
  const end = rest.findIndex((line) => /^\s*\[/.test(line))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** Order two semantic versions, releases above their own prereleases. */
export function compareSemver(a, b) {
  const [, ...x] = SEMVER.exec(a) ?? []
  const [, ...y] = SEMVER.exec(b) ?? []
  for (let i = 0; i < 3; i += 1) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i])
  if (!x[3] || !y[3]) return x[3] ? -1 : y[3] ? 1 : 0
  const left = x[3].split('.')
  const right = y[3].split('.')
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] === undefined) return -1
    if (right[i] === undefined) return 1
    const numeric = /^\d+$/.test(left[i]) && /^\d+$/.test(right[i])
    const order = numeric ? Number(left[i]) - Number(right[i]) : left[i].localeCompare(right[i])
    if (order !== 0) return order
  }
  return 0
}

/** The newest tag of one series: `v` for the root module, `mcp/v` for a nested one. */
function newestTag(tags, prefix) {
  const versions = tags.filter((tag) => tag.startsWith(prefix) && SEMVER.test(tag.slice(prefix.length))).map((tag) => tag.slice(prefix.length))
  return versions.sort(compareSemver).at(-1)
}

const READERS = {
  /** `[project] name` and `version`. */
  py(repo, { repository, manifest = 'pyproject.toml' }) {
    const project = section(repo.read(manifest), 'project')
    return { repository, distributions: [{ name: quoted(project, 'name'), version: quoted(project, 'version'), manifest }], units: [] }
  },

  /** One gemspec per gem; the version is the constant in the gem's version file. */
  ruby(repo) {
    const distributions = repo.files().filter((path) => /^gems\/[^/]+\/[^/]+\.gemspec$/.test(path)).map((manifest) => {
      const directory = manifest.slice(0, manifest.lastIndexOf('/'))
      const version = repo.files().filter((path) => path.startsWith(`${directory}/lib/`) && path.endsWith('/version.rb'))
        .map((path) => /VERSION\s*=\s*"([^"]+)"/.exec(repo.read(path))?.[1]).find(Boolean)
      return { name: quoted(repo.read(manifest), 'spec\\.name'), version, manifest }
    })
    return { distributions, units: [] }
  },

  /** The release file names the one rock the publish workflow uploads; the other rockspecs are development inputs. */
  lua(repo) {
    const release = JSON.parse(repo.read('release.json'))
    return { distributions: [{ name: release.package, version: release.version, manifest: 'release.json' }], units: [] }
  },

  /** A module manifest versions with `ModuleVersion` and, for a prerelease, `Prerelease`. */
  powershell(repo) {
    const distributions = repo.files().filter((path) => /^module\/([^/]+)\/\1\.psd1$/.test(path)).map((manifest) => {
      const text = repo.read(manifest)
      const prerelease = quoted(text, 'Prerelease')
      return { name: manifest.split('/')[1], version: `${quoted(text, 'ModuleVersion')}${prerelease ? `-${prerelease}` : ''}`, manifest }
    })
    return { distributions, units: [] }
  },

  /** Each `Project.toml` is a package; `[extensions]` and nested `module` blocks ship inside the core. */
  julia(repo) {
    const manifests = repo.files().filter((path) => path === 'Project.toml' || /^packages\/[^/]+\/Project\.toml$/.test(path))
    const distributions = manifests.map((manifest) => ({ name: quoted(repo.read(manifest), 'name'), version: quoted(repo.read(manifest), 'version'), manifest }))
    const core = distributions.find((entry) => entry.manifest === 'Project.toml').name
    const extensions = [...section(repo.read('Project.toml'), 'extensions').matchAll(/^\s*(\w+)\s*=/gm)].map((match) => match[1])
    const embedded = repo.files().filter((path) => /^src\/[^/]+\.jl$/.test(path) && path !== `src/${core}.jl`)
      .flatMap((path) => [...repo.read(path).matchAll(/^module\s+(\w+)/gm)].map((match) => `${core}.${match[1]}`))
    return { distributions, units: [...extensions.map((name) => ({ unit: 'extension', name })), ...embedded.map((name) => ({ unit: 'module', name }))] }
  },

  /** A package is published unless it is private; `release_policy.ts` names the same four. */
  ts(repo) {
    const distributions = repo.files().filter((path) => /^packages\/[^/]+\/package\.json$/.test(path)).flatMap((manifest) => {
      const json = JSON.parse(repo.read(manifest))
      return json.private ? [] : [{ name: json.name, version: json.version, manifest }]
    })
    return { distributions, units: [] }
  },

  /** A crate is published unless `publish = false`; the version may come from the workspace. */
  rs(repo) {
    const workspaceVersion = quoted(section(repo.read('Cargo.toml'), 'workspace.package'), 'version')
    const distributions = repo.files().filter((path) => /^crates\/[^/]+\/Cargo\.toml$/.test(path)).flatMap((manifest) => {
      const pkg = section(repo.read(manifest), 'package')
      if (/^\s*publish\s*=\s*false/m.test(pkg)) return []
      return [{ name: quoted(pkg, 'name'), version: quoted(pkg, 'version') ?? (/^\s*version\.workspace\s*=\s*true/m.test(pkg) ? workspaceVersion : undefined), manifest }]
    })
    return { distributions, units: [] }
  },

  /**
   * A module is published when it has a tag series: `v*` for the root and
   * `mcp/v*` for the module in `mcp/`. The packages and commands inside are the
   * directories that hold Go code and are not internal, an example or a benchmark.
   */
  go(repo) {
    const tags = repo.tags()
    const modules = repo.files().filter((path) => path === 'go.mod' || path.endsWith('/go.mod')).map((manifest) => ({
      manifest, directory: manifest === 'go.mod' ? '' : manifest.slice(0, -'/go.mod'.length), path: /^module\s+(\S+)/m.exec(repo.read(manifest))[1],
    }))
    const distributions = modules.flatMap(({ manifest, directory, path }) => {
      const version = newestTag(tags, directory ? `${directory}/v` : 'v')
      return version ? [{ name: path, version, manifest }] : []
    })
    const roots = new Set(modules.map((module) => module.directory))
    const code = new Set(repo.files().filter((path) => path.endsWith('.go') && !path.endsWith('_test.go') && path.includes('/')
      && !/(^|\/)(internal|testdata|examples|benchmarks|scripts|\.agents)\//.test(path)).map((path) => path.slice(0, path.lastIndexOf('/'))))
    // A module's root package is the module itself, so only the directories below a root are units.
    const units = [...code].filter((directory) => !roots.has(directory)).map((directory) => {
      const command = /(^|\/)cmd\/[^/]+$/.test(directory)
      return { unit: command ? 'command' : 'package', name: command ? directory.split('/').pop() : directory, path: directory }
    })
    return { distributions, units }
  },

  /** A Gradle module is published when it applies one of the publication plugins; Scala artifacts carry their binary suffix. */
  java(repo) {
    const properties = repo.read('gradle.properties')
    const version = /^libtmuxVersion=(\S+)/m.exec(properties)?.[1].replace(/-SNAPSHOT$/, '')
    const modules = [...repo.read('settings.gradle.kts').matchAll(/^include\("([^":]+)"\)/gm)].map((match) => match[1])
    const distributions = modules.flatMap((directory) => {
      const manifest = `${directory}/build.gradle.kts`
      if (!repo.has(manifest)) return []
      const build = repo.read(manifest)
      const scala = build.includes('libtmux.published-scala-library')
      if (!scala && !/libtmux\.(?:published-library|publication)\b/.test(build)) return []
      return [{ name: `io.github.libtmux:${directory}${scala ? '_3' : ''}`, version, manifest }]
    })
    return { distributions, units: [] }
  },

  /** A project is a package when it is packable; its id is `PackageId`. */
  dotnet(repo) {
    const props = repo.read('Directory.Build.props')
    const suffix = /<VersionSuffix>([^<]+)</.exec(props)?.[1]
    const version = `${/<VersionPrefix>([^<]+)</.exec(props)?.[1]}${suffix ? `-${suffix}` : ''}`
    const distributions = repo.files().filter((path) => /^src\/[^/]+\/[^/]+\.(?:cs|fs)proj$/.test(path)).flatMap((manifest) => {
      const text = repo.read(manifest)
      return /<IsPackable>true</.test(text) ? [{ name: /<PackageId>([^<]+)</.exec(text)?.[1], version, manifest }] : []
    })
    return { distributions, units: [] }
  },

  /** The vcpkg port is the one distribution; a CMake component or executable ships inside it. */
  cxx(repo) {
    const manifest = 'ports/libtmux/vcpkg.json'
    const json = JSON.parse(repo.read(manifest))
    return { distributions: [{ name: json.name, version: json['version-semver'], manifest }], units: [] }
  },

  /**
   * One package versions by Git tag. Its products are what a project depends
   * on and its targets are what the package builds; a test target ships nothing.
   */
  swift(repo, { identity }) {
    const text = repo.read('Package.swift')
    const version = newestTag(repo.tags(), '')
    const products = [...text.matchAll(/\.(library|executable)\(\s*name:\s*"([^"]+)"/g)].map((match) => ({
      unit: match[1] === 'executable' ? 'executable product' : 'product', name: match[2] }))
    const targets = [...text.matchAll(/\.(target|executableTarget)\(\s*name:\s*"([^"]+)"/g)].map((match) => ({
      unit: match[1] === 'executableTarget' ? 'executable target' : 'target', name: match[2] }))
    return { distributions: [{ name: identity, version, manifest: 'Package.swift' }], units: [...products, ...targets] }
  },
}

/** Which reader a port uses: a wrapper port reads its parent's repository. */
const READER_FOR = {
  py: 'py', ruby: 'ruby', lua: 'lua', powershell: 'powershell', julia: 'julia', ts: 'ts', rs: 'rs', go: 'go',
  java: 'java', kotlin: 'java', scala: 'java', csharp: 'dotnet', fsharp: 'dotnet', cxx: 'cxx', swift: 'swift',
}

/**
 * Read one port's manifests at one revision. `options` names the repository's other inputs.
 * @param {string} slug
 * @param {{ revision: string, files(): string[], read(path: string): string, has(path: string): boolean, tags(): string[] }} repo
 * @param {{ identity?: string, repository?: string, manifest?: string }} [options]
 * @returns {{ distributions: { name: string, version?: string, manifest: string }[], units: { unit: string, name: string, path?: string }[] }}
 */
export function readPort(slug, repo, options = {}) {
  const reader = READERS[READER_FOR[slug]]
  if (!reader) throw new Error(`no manifest reader for ${slug}`)
  return reader(repo, options)
}
