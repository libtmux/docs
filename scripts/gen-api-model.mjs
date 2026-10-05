#!/usr/bin/env node
/**
 * Extract versioned source provenance and the public API model for each port.
 * Run once before assembly; Astro reads the generated JSON in every build.
 * Usage: node scripts/gen-api-model.mjs [--port py] [--check | --nav]
 *        [--skip-native-model-ports ruby,lua]
 *        --project tmux --version 3.7c [--source-root CONFIGURED_ARCHIVE] [--check]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS as PORT_DEFS } from '../site/src/lib/ports.ts'
import { extractDoxygen } from '../packages/api-model/src/languages/doxygen.ts'
import { extractLua } from '../packages/api-model/src/languages/lua.ts'
import { extractRuby } from '../packages/api-model/src/languages/ruby.ts'
import { attachCompleteGoExamples, readCompleteGoExamples } from '../packages/api-model/src/languages/go-examples.ts'
import { attachCompleteCSharpExamples } from '../packages/api-model/src/languages/csharp-examples.ts'
import { attachCompleteFSharpExamples } from '../packages/api-model/src/languages/fsharp-examples.ts'
import { attachCompleteRustExamples } from '../packages/api-model/src/languages/rust-examples.ts'
import { attachCompleteCxxExamples } from '../packages/api-model/src/languages/cxx-examples.ts'
import { attachCompleteJvmExamples } from '../packages/api-model/src/languages/jvm-examples.ts'
import { attachCompleteSwiftExamples } from '../packages/api-model/src/languages/swift-examples.ts'
import { mapLine, parseHunks } from '../packages/api-model/src/source-lines.ts'
import { extractProject } from '../packages/api-model/src/project.ts'
import { scopeProductSymbols } from '../packages/api-model/src/product-exports.ts'
import { inheritProductFromOwners } from '../packages/api-model/src/products.ts'
import { pageSlug } from '../packages/api-model/src/prose.ts'
import { navSidecar } from '../packages/api-model/src/nav-sidecar.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const portBySlug = Object.fromEntries(PORT_DEFS.map((port) => [port.slug, port]))

/** The newest modification time anywhere under a directory. */
function newestMtime(dir) {
  let newest = 0
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else newest = Math.max(newest, statSync(full).mtimeMs)
    }
  }
  if (existsSync(dir)) walk(dir)
  return newest
}

/** Four base-36 characters of a string, enough to separate 96 collisions. */
function shortHash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).slice(0, 4)
}
const expand = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

/** One git command, or undefined when it fails — several are expected to. */
function git(repo, ...args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

/** Read package versions from their owning manifest, independent of docs URL labels. */
function packageVersion(checkout, port, product) {
  const read = (file) => existsSync(join(checkout, file)) ? readFileSync(join(checkout, file), 'utf8') : ''
  if (port === 'py') return /^version\s*=\s*"([^"]+)"/m.exec(read('pyproject.toml'))?.[1]
  if (port === 'ts') return JSON.parse(read(`packages/${product === 'core' ? 'libtmux' : product}/package.json`)).version
  if (port === 'rs') {
    const crate = product === 'core' ? 'libtmux' : product === 'workspace' ? 'tmux-workspace' : 'tmux-mcp'
    return /^version\s*=\s*"([^"]+)"/m.exec(read(`crates/${crate}/Cargo.toml`))?.[1]
      ?? /^version\s*=\s*"([^"]+)"/m.exec(read('Cargo.toml'))?.[1]
  }
  if (['java', 'kotlin', 'scala'].includes(port)) return /^libtmuxVersion=(.+)$/m.exec(read('gradle.properties'))?.[1]
  if (['csharp', 'fsharp'].includes(port)) {
    const props = read('Directory.Build.props')
    const prefix = /<VersionPrefix>([^<]+)</.exec(props)?.[1]
    const suffix = /<VersionSuffix>([^<]+)</.exec(props)?.[1]
    return prefix ? `${prefix}${suffix ? `-${suffix}` : ''}` : undefined
  }
  if (port === 'cxx') return read('VERSION').trim() || undefined
  if (port === 'swift') return /static let current = "([^"]+)"/.exec(read('Sources/LibTmux/LibTmuxVersion.swift'))?.[1]
  return undefined
}

/**
 * The newest ancestor of `head` that exists in the public repository.
 *
 * Source links point at `github.com/<repo>/blob/<revision>/…`, and `revision`
 * was `rev-parse HEAD`. Several ports are extracted from a `-docs` worktree
 * whose head lives only on the private `tony` fork, so that URL 404s for
 * every reader — measured across the estate, three of eight ports were
 * publishing links to commits the public repository has never seen, and
 * `check-links.mjs` cannot see it because these are external URLs.
 *
 * `merge-base` with the public default branch is the newest commit that is
 * both an ancestor of what was extracted and something a reader can open.
 * Resolved through `origin/HEAD` rather than a hardcoded `master`, because
 * this estate has both `master` and `main` ports.
 *
 * Falls back to `head` loudly. A dead link is worse than a live one, but a
 * silently missing source link is worse than both.
 */
function publicRevision(checkout, head, port, repo) {
  if (!head) return undefined

  // The blob URL and the merge-base have to name the same repository;
  // nothing else ties the `repo` field to the checkout it is paired with.
  const origin = git(checkout, 'remote', 'get-url', 'origin')
  if (origin && repo && !origin.replace(/\.git$/, '').endsWith(repo)) {
    console.error(`gen-api-model: ${port} origin is ${origin}, but repo says ${repo}`)
    process.exit(1)
  }

  const ref =
    git(checkout, 'symbolic-ref', 'refs/remotes/origin/HEAD') ??
    ['refs/remotes/origin/master', 'refs/remotes/origin/main'].find((r) =>
      git(checkout, 'rev-parse', '--verify', '--quiet', r),
    )
  if (!ref) {
    console.warn(`gen-api-model: ${port} has no public branch; source links may 404`)
    return head
  }
  const base = git(checkout, 'merge-base', head, ref)
  if (!base) {
    console.warn(`gen-api-model: ${port} head shares no history with ${ref}`)
    return head
  }
  return base
}

/**
 * Carry each symbol's line from the extracted commit to the public one.
 *
 * The public ancestor's line numbers are its own. Where a docs branch added
 * comment lines above a declaration the declaration did not change but its
 * line did, and pointing at the old number would put the reader somewhere
 * else in the file with nothing to show it. `git diff -U0` says how far each
 * line moved; a line the diff rewrote has no counterpart and loses its number
 * rather than getting a wrong one.
 */
function remapLines(checkout, symbols, from, to) {
  if (!from || !to || from === to) return { shifted: 0, dropped: 0 }
  const maps = new Map()
  let shifted = 0
  let dropped = 0
  for (const s of symbols) {
    const { file, line } = s.source
    if (!file || !line) continue
    if (!maps.has(file)) {
      const diff = git(checkout, 'diff', '-U0', `${from}..${to}`, '--', file)
      maps.set(file, diff ? parseHunks(diff) : [])
    }
    const mapped = mapLine(maps.get(file), line)
    if (mapped === null) {
      const { line: _drop, ...rest } = s.source
      s.source = rest
      dropped++
    } else if (mapped !== line) {
      s.source = { ...s.source, line: mapped }
      shifted++
    }
  }
  return { shifted, dropped }
}

/** Where each port's sources live, and what to feed the extractor. */
const PORTS = {
  py: {
    checkout: '~/work/python/libtmux',
    root: 'src',
    repo: 'tmux-python/libtmux',
    // libtmux's own conf.py passes both; specialMembers is ours, because
    // `__enter__` and `__getitem__` are part of how the library is used.
    //
    // `privateMembers` is about those dunders, not about private packages.
    // `_vendor` is bundled third-party code whose documentation is somebody
    // else's, and `_compat` is shims for Python versions rather than API.
    //
    // `_internal` stays. It is spelled private and is not in `__all__`, but
    // `Server.sessions` returns a `QueryList` from it, so a caller holds one
    // and needs its page — excluding it cost 161 cross-references from public
    // signatures. Whether to move it is libtmux's decision.
    //
    // No rule for a leading underscore on a class. `_DefaultOptionScope` is
    // spelled private and is named in 97 public type annotations as the
    // default scope, so removing it rendered all 97 as plain text. The
    // reference is better with a page for it than without one.
    options: {
      privateMembers: true,
      specialMembers: true,
      inheritedMembers: true,
      excludePaths: [/(^|\.)_vendor\./, /(^|\.)_compat\./],
    },
  },
  ruby: {
    checkout: '~/work/libtmux/libtmux-ruby-docs',
    root: '.',
    nativeArtifact: 'docs/_build/api.json',
    repo: 'libtmux/libtmux-ruby',
    options: {},
  },
  lua: {
    checkout: '~/work/libtmux/libtmux-lua-docs',
    root: '.',
    nativeArtifact: 'docs/_build/api.json',
    repo: 'libtmux/libtmux-lua',
    options: {},
  },
  ts: {
    checkout: '~/work/libtmux/libtmux-ts',
    roots: ['packages/libtmux/src', 'packages/workspace/src'],
    repo: 'libtmux/libtmux-ts',
    // `_internal` is 1,426 of this port's 2,242 symbols — generated graph
    // projections and normalisers no consumer can import.
    options: { inheritedMembers: true, excludePaths: [/^_internal\./, /^_generated\./] },
  },
  rs: {
    checkout: '~/work/libtmux/libtmux-rs',
    roots: ['crates/libtmux/src', 'crates/tmux-workspace/src'],
    repo: 'libtmux/libtmux-rs',
    options: { inheritedMembers: false, excludePaths: [/^internal\./] },
  },
  go: {
    checkout: '~/work/libtmux/libtmux-go',
    roots: ['tmux', 'tmuxq', 'workspace'],
    repo: 'libtmux/libtmux-go',
    // Go has no inheritance; embedding is composition and resolving it by
    // name would invent members the language does not promote.
    options: { inheritedMembers: false, excludePaths: [/^internal\./, /^tmux\.internal\./] },
  },
  java: {
    checkout: '~/work/libtmux/libtmux-java',
    roots: ['libtmux/src/main/java', 'libtmux/build/generated/sources/fieldCatalog/java/main',
      'libtmux-workspace/src/main/java', 'libtmux-jackson/src/main/java', 'libtmux-junit5/src/main/java'],
    generate: [':libtmux:generateFieldMetamodel'],
    generateWhen: 'build-logic/conventions/src/main/kotlin/libtmux.field-catalog.gradle.kts',
    repo: 'libtmux/libtmux-java',
    options: { inheritedMembers: true },
  },
  csharp: {
    checkout: '~/work/libtmux/libtmux-dotnet',
    roots: ['src/LibTmux', 'src/LibTmux.Workspace', 'src/LibTmux.Query.Json', 'src/LibTmux.Testing'],
    repo: 'libtmux/libtmux-dotnet',
    options: { inheritedMembers: true },
  },
  kotlin: {
    checkout: '~/work/libtmux/libtmux-java',
    roots: ['libtmux-kotlin/src/main/kotlin', 'libtmux-kotlin/build/generated/sources/operations/kotlin'],
    generate: [':libtmux-kotlin:generateOperationWrappers'],
    pathRoots: ['libtmux-kotlin/', 'docs/guide/kotlin.md', 'examples/src/main/kotlin/'],
    repo: 'libtmux/libtmux-java', options: {},
  },
  scala: {
    checkout: '~/work/libtmux/libtmux-java',
    roots: ['libtmux-scala/src/main/scala', 'libtmux-scala/build/generated/sources/catalog/scala',
      'libtmux-scala-cats/src/main/scala', 'libtmux-scala-cats/build/generated/sources/catalog/scala',
      'libtmux-scala-ox/src/main/scala'],
    generate: [':libtmux-scala:generateScalaSources', ':libtmux-scala-cats:generateScalaSources'],
    pathRoots: ['libtmux-scala/', 'libtmux-scala-cats/', 'libtmux-scala-ox/',
      'docs/guide/scala/', 'examples/src/main/scala/'],
    repo: 'libtmux/libtmux-java', options: {},
  },
  fsharp: {
    checkout: '~/work/libtmux/libtmux-dotnet',
    root: 'src/LibTmux.FSharp',
    pathRoots: ['src/LibTmux.FSharp/', 'docs/fsharp/', 'examples/LibTmux.FSharp.'],
    repo: 'libtmux/libtmux-dotnet', options: {},
  },
  // C++ comes from the Doxygen XML this project's own build already produces:
  // tree-sitter has no preprocessor, so `LIBTMUX_NAMESPACE_BEGIN` derails the
  // file and `void f(std::string s = {})` loses its default argument.
  // `root` is the checkout, which holds both `xml/` and the headers the prose
  // is read from — Doxygen sees only `///`, and this port documents with `//`.
  cxx: {
    checkout: '~/work/libtmux/libtmux-cxx-docs',
    root: '.',
    artifact: { dir: 'xml', from: 'include', what: 'Doxygen XML', build: 'doxygen Doxyfile' },
    repo: 'libtmux/libtmux-cxx',
    options: {},
  },
  // Swift comes from `swift build -Xswiftc -emit-symbol-graph`, whose output
  // carries typed throws and pre-resolved cross-references. The tree-sitter
  // grammar mis-parses 50 of this port's 91 files.
  swift: {
    checkout: '~/work/libtmux/libtmux-swift-docs',
    root: '.',
    artifact: {
      dir: 'symbolgraph',
      from: 'Sources',
      what: 'symbol graph',
      build: 'swift build --enable-all-traits -Xswiftc -emit-symbol-graph -Xswiftc -emit-symbol-graph-dir -Xswiftc "$PWD/symbolgraph"',
    },
    repo: 'libtmux/libtmux-swift',
    options: {},
  },
}

const args = process.argv.slice(2)
const repositoryPaths = (tree, cfg) => tree.split('\n').filter((path) =>
  path && (!cfg.pathRoots || !path.includes('/') || cfg.pathRoots.some((prefix) => path.startsWith(prefix))))
const only = args.includes('--port') ? args[args.indexOf('--port') + 1] : undefined
const check = args.includes('--check')
/** Feed configured upstream C sources through the same Doxygen extractor as C++. */
function generateTmuxModel() {
  const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback
  const version = value('--version')
  const pins = JSON.parse(readFileSync(join(repoRoot, 'site/src/data/tmux/versions.json'), 'utf8'))
  const pin = pins.versions.find((entry) => entry.version === version)
  if (!pin) throw new Error('--project tmux requires a version in tmux/versions.json')
  const checkout = expand(value('--checkout', '~/study/c/tmux'))
  const revision = pin.revision
  const commit = git(checkout, 'rev-parse', `${revision}^{commit}`)
  const tree = git(checkout, 'rev-parse', `${commit}^{tree}`)
  if (!commit || !tree) throw new Error(`Missing pinned tmux Git object ${revision}`)
  const scratch = mkdtempSync(join(tmpdir(), 'libtmux-doxygen-c-'))
  const source = resolve(value('--source-root', join(scratch, 'source')))
  const run = (command, argv, cwd = source) => execFileSync(command, argv, {
    cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
  })
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const quote = (text) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  try {
    if (!args.includes('--source-root')) {
      mkdirSync(source)
      const archive = execFileSync('git', ['-C', checkout, 'archive', commit], { maxBuffer: 1 << 28 })
      execFileSync('tar', ['-x', '-C', source], { input: archive })
      run('sh', ['autogen.sh'])
      execFileSync('./configure', [], { cwd: source, encoding: 'utf8', maxBuffer: 1 << 26,
        env: { ...process.env, CC: process.env.CC || 'clang-18', CFLAGS: '', CPPFLAGS: '', LDFLAGS: '', LIBS: '', LC_ALL: 'C', TZ: 'UTC' } })
    }
    // A reused configured archive must still contain every exact tracked byte.
    const tracked = (git(checkout, 'ls-tree', '-r', commit) ?? '').split('\n').map((line) => {
      const match = /^\d+ blob ([a-f0-9]+)\t(.+)$/.exec(line)
      if (!match) throw new Error(`Unexpected tmux tree entry ${line}`)
      return { blob: match[1], file: match[2] }
    })
    const sourceHashes = {}
    for (const { file, blob } of tracked) {
      const bytes = readFileSync(join(source, file))
      const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
      if (actual !== blob) throw new Error(`Configured tmux input differs from ${commit}: ${file}`)
      sourceHashes[file] = sha256(bytes)
    }
    const makeWords = (variable) => run('make', ['--no-print-directory', '-s',
      `--eval=model-values: ; @printf "%s\\0" $(${variable})`, 'model-values']).split('\0').filter(Boolean)
    const compile = makeWords('COMPILE')
    const configuredSources = [...makeWords('dist_tmux_SOURCES'), ...makeWords('nodist_tmux_SOURCES')]
    const trackedPaths = new Set(tracked.map(({ file }) => file))
    const translationUnits = [...new Set(configuredSources.filter((file) => file.endsWith('.c') && trackedPaths.has(file) && !file.startsWith('compat/')))].sort()
    const headers = [...trackedPaths].filter((file) => !file.includes('/') && file.endsWith('.h')).sort()
    const inputs = [...translationUnits, ...headers].sort()
    const inputSet = new Set(inputs)
    const doxygen = value('--doxygen', process.env.DOXYGEN || 'doxygen')
    const doxygenPath = isAbsolute(doxygen) ? doxygen : run('which', [doxygen]).trim()
    const includePaths = ['.']
    for (let i = 1; i < compile.length; i++) {
      const include = /^(?:-I|-iquote|-isystem)(.*)$/.exec(compile[i])
      if (include) includePaths.push(include[1] || compile[++i])
    }
    const doxygenVersion = run(doxygen, ['--version']).trim()
    if (!/^1\.18\.0(?:\s|$)/.test(doxygenVersion)) throw new Error(`Expected tested Doxygen 1.18.0, got ${doxygenVersion}`)
    const config = [
      'PROJECT_NAME = tmux', `OUTPUT_DIRECTORY = ${quote(scratch)}`,
      `INPUT = ${inputs.map(quote).join(' ')}`, 'EXTENSION_MAPPING = c=C h=C',
      'OPTIMIZE_OUTPUT_FOR_C = YES', 'EXTRACT_ALL = YES', 'EXTRACT_STATIC = YES',
      'EXTRACT_LOCAL_CLASSES = YES', 'GENERATE_HTML = NO', 'GENERATE_LATEX = NO',
      'GENERATE_XML = YES', 'XML_PROGRAMLISTING = YES', 'SOURCE_BROWSER = YES',
      'REFERENCES_RELATION = YES', 'REFERENCED_BY_RELATION = YES',
      'ENABLE_PREPROCESSING = YES', 'MACRO_EXPANSION = YES', 'EXPAND_ONLY_PREDEF = NO',
      'SEARCH_INCLUDES = YES', `INCLUDE_PATH = ${[...new Set(includePaths)].map(quote).join(' ')}`,
      `PREDEFINED = ${[...compile.filter((arg) => arg.startsWith('-D')).map((arg) => arg.slice(2)), '__attribute__(x)='].map(quote).join(' ')}`,
      'SKIP_FUNCTION_MACROS = YES', 'QUIET = YES', 'WARNINGS = YES', 'WARN_IF_UNDOCUMENTED = NO',
      `WARN_LOGFILE = ${quote(join(scratch, 'warnings.log'))}`, 'STRIP_FROM_PATH = .', 'HAVE_DOT = NO',
    ].join('\n')
    writeFileSync(join(scratch, 'Doxyfile'), `${config}\n`)
    run(doxygen, [join(scratch, 'Doxyfile')])
    const warnings = readFileSync(join(scratch, 'warnings.log'), 'utf8').replaceAll(source, '<source>')
    if (/\berror:/i.test(warnings)) throw new Error(`Doxygen errors: ${warnings}`)
    const referenceDiagnostics = []
    const extracted = extractDoxygen(join(scratch, 'xml'), source, { language: 'c', onDiagnostic: (message) => referenceDiagnostics.push(message) })
    const symbols = extracted.filter((symbol) => inputSet.has(symbol.source.file))
    const ids = new Map(symbols.map((symbol) => [symbol.id, symbol]))
    if (ids.size !== symbols.length) throw new Error('Duplicate C declaration identity')
    for (const symbol of symbols) {
      if (symbol.parent && !ids.has(symbol.parent)) throw new Error(`Missing C parent ${symbol.parent}`)
      symbol.apiScope = 'internal'
      symbol.source = { ...symbol.source, repo: 'tmux/tmux', revision: commit }
      if (symbol.references) symbol.references = symbol.references.filter((ref) => ids.has(ref.target))
      if (symbol.imports) symbol.imports = Object.fromEntries(Object.entries(symbol.imports).filter(([, target]) => ids.has(target)))
      symbol.slug = pageSlug(symbol.id)
    }
    const slugs = new Map()
    for (const symbol of symbols) slugs.set(symbol.slug, [...(slugs.get(symbol.slug) ?? []), symbol])
    for (const group of slugs.values()) if (group.length > 1) for (const symbol of group) symbol.slug += `-${shortHash(symbol.id)}`
    if (new Set(symbols.map((symbol) => symbol.slug)).size !== symbols.length) throw new Error('C page slug collision')
    const commands = symbols.filter((symbol) => symbol.type === 'const struct cmd_entry' && symbol.value).map((symbol) => {
      const name = /\.name\s*=\s*"([^"\\]+)"/.exec(symbol.value)?.[1]
      const exec = /\.exec\s*=\s*([A-Za-z_]\w*)/.exec(symbol.value)?.[1]
      if (!name || !exec) throw new Error(`Unresolved command initializer ${symbol.id}`)
      const callbacks = (symbol.references ?? []).map((ref) => ids.get(ref.target)).filter((target) => target?.kind === 'function' && target.name === exec)
      if (callbacks.length !== 1) throw new Error(`Command ${name} callback must resolve once through native XML references`)
      return { name, entry: symbol.id, callback: callbacks[0].id }
    }).sort((a, b) => a.name.localeCompare(b.name))
    if (new Set(commands.map((command) => command.name)).size !== commands.length) throw new Error('Duplicate command name')
    const notices = {}
    for (const file of inputs) {
      const contents = readFileSync(join(source, file), 'utf8')
      const leading = /^(?:\s*\/\*[\s\S]*?\*\/\s*)+/.exec(contents)?.[0]?.trim()
      if (leading && /copyright/i.test(leading)) notices[file] = leading
    }
    const copying = readFileSync(join(source, 'COPYING'), 'utf8')
    const model = {
      schemaVersion: 1, project: 'tmux', language: 'c', version, repo: 'tmux/tmux', revision: commit,
      extractor: 'doxygen-c-v1',
      profile: {
        producer: `Doxygen ${doxygenVersion}`, producerBinarySha256: sha256(readFileSync(doxygenPath)), configuredPlatform: run(compile[0], ['-dumpmachine']).trim(),
        compiler: run(compile[0], ['--version']).split('\n')[0], arguments: compile.slice(1),
        pin: revision, sourceCommit: commit, sourceTree: tree, translationUnits, inputs,
        exclusions: [
          { paths: configuredSources.filter((file) => file.endsWith('.c') && !inputSet.has(file)).sort(), reason: 'Generated parser and compatibility implementation are outside the source reference.' },
          { paths: [...trackedPaths].filter((file) => file.endsWith('.c') && !configuredSources.includes(file)).sort(), reason: 'Not selected by this configured platform.' },
        ],
        macroExpansion: 'Native included definitions and configured Makefile -D flags; no synthetic feature definitions.',
        ignoredDecorations: ['__attribute__(x)'], initializerLineLimit: 30,
        spelling: 'Doxygen-normalized declarations, types and initializers, including expanded macros; not verbatim source slices. Anonymous synthetic types have no reconstructed raw declaration.',
        references: 'Resolved native XML relationships and explicit C tag types between included symbols; external targets omitted. Call edges are a bounded syntactic projection of refid-linked programlisting inside native function body spans: direct statements, returns, first conditions and assignment RHS. Each call edge records source sites. Callback/address uses, macros, indirect calls, ambiguous or continued expressions remain general references; cross-file static function links are omitted and recorded as producer diagnostics; no runtime execution or complete call graph is claimed.',
        sourceHashes, referenceDiagnostics: [...new Set(referenceDiagnostics)].sort(), diagnostics: warnings.trim() ? warnings.trim().split('\n') : [],
      },
      license: { file: 'COPYING', sha256: sha256(copying), text: copying, notices },
      commands, symbols,
    }
    const out = join(repoRoot, 'site/src/data/tmux/api', `${version}.json`)
    const text = `${JSON.stringify(model)}\n`
    if (check) {
      if (!existsSync(out) || readFileSync(out, 'utf8') !== text) throw new Error(`${out} stale; regenerate with the same configured toolchain`)
    } else {
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, text)
    }
    console.log(`gen-api-model: tmux ${version}: ${symbols.length} shared symbols, ${commands.length} native command associations${check ? ' current' : ''}`)
    if (args.includes('--retain-output')) console.log(`Native Doxygen evidence: ${scratch}`)
    else rmSync(scratch, { recursive: true })
  } catch (error) {
    console.error(`Native Doxygen evidence retained: ${scratch}`)
    throw error
  }
}

if (args.includes('--project')) {
  if (args[args.indexOf('--project') + 1] !== 'tmux' || only) throw new Error('Use --project tmux independently of --port')
  generateTmuxModel()
  process.exit(0)
}

/*
 * `--nav` rewrites only the sidebar sidecars, from the committed models. The
 * sidebar is a function of the model and nav-config.ts, so an edit to the
 * config needs no checkout and must not re-extract eight repositories whose
 * working trees have moved on since their models were committed.
 */
const navOnly = args.includes('--nav')
const skipNativeModelPortsIndex = args.indexOf('--skip-native-model-ports')
const skipNativeModelPortsValue = skipNativeModelPortsIndex === -1
  ? undefined
  : args[skipNativeModelPortsIndex + 1]
if (skipNativeModelPortsIndex !== -1 && !check) {
  console.error('gen-api-model: --skip-native-model-ports requires --check')
  process.exit(2)
}
if (skipNativeModelPortsIndex !== -1 && (!skipNativeModelPortsValue || skipNativeModelPortsValue.startsWith('--'))) {
  console.error('gen-api-model: --skip-native-model-ports requires a comma-separated port list')
  process.exit(2)
}
const skipNativeModelPorts = new Set((skipNativeModelPortsValue ?? '').split(',').map((port) => port.trim()).filter(Boolean))
for (const port of skipNativeModelPorts) {
  if (!(port in PORTS)) {
    console.error(`gen-api-model: --skip-native-model-ports names unknown port ${port}`)
    process.exit(2)
  }
  if (!PORTS[port].nativeArtifact) {
    console.error(`gen-api-model: ${port} has no native model to skip`)
    process.exit(2)
  }
}

/** Write a port's compiled sidebar beside its model. */
function writeNav(port, model) {
  const sidecar = navSidecar(port, model)
  if (sidecar) writeFileSync(join(repoRoot, 'site/src/data/api', `${port}.nav.json`), `${JSON.stringify(sidecar)}\n`)
}

let stale = 0
let skipped = 0
for (const [port, cfg] of Object.entries(PORTS)) {
  if (only && only !== port) continue
  if (navOnly) {
    writeNav(port, JSON.parse(readFileSync(join(repoRoot, 'site/src/data/api', `${port}.json`), 'utf8')))
    console.log(`gen-api-model: ${port}.nav.json compiled from the committed model`)
    continue
  }
  if (skipNativeModelPorts.has(port)) {
    console.log(`gen-api-model: ${port} native model freshness skipped by --skip-native-model-ports`)
    skipped++
    continue
  }
  // `build-site.sh` and `remark-port-code.mjs` already read this, and the
  // reason is the same here: doc-comment work happens on a port's `docs-site`
  // worktree, and without an override there is no way to see its effect on
  // the reference until the branch lands.
  const override = process.env[`LIBTMUX_DOCS_CHECKOUT_${port.toUpperCase()}`]
  const checkout = expand(override || portBySlug[port].worktree)
  if (!existsSync(checkout)) {
    // Generating without source is impossible, so that still fails. Checking
    // without source is merely unanswerable, and a fresh clone and a CI runner
    // both lack every sibling checkout — failing there would make this
    // impossible to gate anywhere but a fully provisioned machine. Say which
    // ports went unchecked, the shape check-source-links.mjs already uses.
    if (check) {
      console.log(`gen-api-model: ${port} skipped, no checkout at ${cfg.checkout}`)
      skipped++
      continue
    }
    console.error(`gen-api-model: no checkout for ${port} at ${cfg.checkout}`)
    process.exit(1)
  }

  const head = git(checkout, 'rev-parse', 'HEAD')
  const selectedSource = process.env.LIBTMUX_DOCS_PORT === port
    ? process.env.LIBTMUX_DOCS_SOURCE_SHA : undefined
  const selectedRef = process.env.LIBTMUX_DOCS_PORT === port
    ? process.env.LIBTMUX_DOCS_SOURCE_REF : undefined
  if (selectedSource) {
    if (!/^[0-9a-f]{40}$/.test(selectedSource) || head !== selectedSource) {
      console.error(`gen-api-model: ${port} checkout HEAD ${head} does not match selected source ${selectedSource}`)
      process.exit(1)
    }
    const resolved = selectedRef ? git(checkout, 'rev-parse', `${selectedRef}^{commit}`) : head
    if (resolved !== selectedSource) {
      console.error(`gen-api-model: ${port} source ref ${selectedRef} resolves to ${resolved}, expected ${selectedSource}`)
      process.exit(1)
    }
  }
  // The commit a reader can actually open, which is not always the one the
  // model is generated from. See `publicRevision`.
  const revision = selectedSource ?? publicRevision(checkout, head, port, cfg.repo)

  if (cfg.generate && (!cfg.generateWhen || existsSync(join(checkout, cfg.generateWhen)))) {
    // Gradle owns dependency tracking; stale generated methods must never be
    // accepted simply because their output directory already exists.
    execFileSync(join(checkout, 'gradlew'), [...cfg.generate, '--console=plain'], {
      cwd: checkout, stdio: 'inherit',
    })
  }

  const roots = (cfg.roots ?? [cfg.root])
    .map((r) => join(checkout, r))
    .filter((r) => existsSync(r))
  if (!roots.length) {
    console.error(`gen-api-model: no source roots exist for ${port}`)
    process.exit(1)
  }
  // Two ports reach the model through a build product rather than through
  // their own source: C++ through Doxygen XML, Swift through a symbol graph.
  // Nothing here regenerated or checked either, and both had drifted three
  // days behind the comments they were meant to carry — 24 documented C++
  // symbols read as undocumented, and Swift's newest prose was simply absent.
  //
  // Compared on modification time rather than commit time so uncommitted work
  // counts: doc-comment work on a port is uncommitted for as long as it takes
  // to write, which is exactly when this matters.
  if (cfg.artifact) {
    const built = join(checkout, cfg.artifact.dir)
    if (!existsSync(built)) {
      console.error(
        `gen-api-model: ${port} has no ${cfg.artifact.what} at ${cfg.artifact.dir} — ` +
          `run ${cfg.artifact.build} in ${cfg.checkout}`,
      )
      process.exit(1)
    }
    if (newestMtime(built) < newestMtime(join(checkout, cfg.artifact.from))) {
      console.error(
        `gen-api-model: ${port}'s ${cfg.artifact.what} predates the source it describes — ` +
          `run ${cfg.artifact.build} in ${cfg.checkout} and re-run`,
      )
      process.exit(1)
    }
  }

  let model
  if (cfg.nativeArtifact) {
    const artifactPath = join(checkout, cfg.nativeArtifact)
    if (!existsSync(artifactPath)) {
      console.error(`gen-api-model: ${port} has no native artifact at ${cfg.nativeArtifact}`)
      process.exit(1)
    }
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
    model = port === 'ruby' ? extractRuby(artifact, head) : extractLua(artifact, head)
  } else {
    model = await extractProject({
      port,
      root: roots[0],
      roots,
      revision,
      options: cfg.options,
    })
  }

  if (port === 'go') {
    // Read committed bytes at the citation revision, never a newer working tree.
    const files = (git(checkout, 'ls-tree', '-r', '--name-only', revision, 'tmux') ?? '')
      .split('\n').filter((file) => /^tmux\/[^/]+_test\.go$/.test(file))
      .map((file) => ({
        file,
        code: execFileSync('git', ['-C', checkout, 'show', `${revision}:${file}`], {
          encoding: 'utf8', maxBuffer: 1 << 26,
        }),
      }))
    const examples = await readCompleteGoExamples(files)
    const goVersion = /^go (\d+\.\d+\.\d+)$/m.exec(git(checkout, 'show', `${revision}:go.mod`) ?? '')?.[1]
    if (examples.length && !goVersion) throw new Error('Missing Go version for complete examples')
    if (examples.length) attachCompleteGoExamples(model.symbols, examples, {
      repo: cfg.repo, revision, goVersion,
    })
  }

  if (['java', 'kotlin', 'scala'].includes(port)) {
    attachCompleteJvmExamples(model.symbols, port, (file) => {
      try {
        return execFileSync('git', ['-C', checkout, 'show', `${revision}:${file}`], {
          encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'],
        })
      } catch {
        return undefined
      }
    }, { repo: cfg.repo, revision })
  }

  if (port === 'swift') {
    attachCompleteSwiftExamples(model.symbols, (file) => {
      try {
        return execFileSync('git', ['-C', checkout, 'show', `${revision}:${file}`], {
          encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'],
        })
      } catch {
        return undefined
      }
    }, { repo: cfg.repo, revision })
  }

  if (port === 'fsharp' || port === 'csharp') {
    const attach = port === 'fsharp' ? attachCompleteFSharpExamples : attachCompleteCSharpExamples
    attach(model.symbols, (file) => {
      try {
        return execFileSync('git', ['-C', checkout, 'show', `${revision}:${file}`], {
          encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'],
        })
      } catch {
        return undefined
      }
    }, { repo: cfg.repo, revision })
  }

  if (port === 'cxx' || port === 'rs') {
    const attach = port === 'rs' ? attachCompleteRustExamples : attachCompleteCxxExamples
    attach(model.symbols, (file) => {
      try {
        return execFileSync('git', ['-C', checkout, 'show', `${revision}:${file}`], {
          encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'],
        })
      } catch {
        return undefined
      }
    }, { repo: cfg.repo, revision })
  }

  const legacyIds = new Set(model.symbols.map((symbol) => symbol.id))
  const sourceUnits = [{ checkout, repo: cfg.repo, revision, head, symbols: model.symbols }]
  const mcpRoots = {
    ts: 'packages/mcp/src', rs: 'crates/tmux-mcp/src', go: 'mcp',
    java: 'libtmux-mcp/src/main/java', csharp: 'src/LibTmux.Mcp',
  }
  const extras = cfg.nativeArtifact ? [] : port === 'py'
    ? [
      { product: 'workspace', checkout: expand(process.env.LIBTMUX_DOCS_WORKSPACE_PY || '~/work/python/tmuxp'), root: 'src', repo: 'tmux-python/tmuxp', package: 'tmuxp' },
      { product: 'mcp', checkout: expand(process.env.LIBTMUX_DOCS_MCP_PY || '~/work/python/libtmux-mcp'), root: 'src', repo: 'tmux-python/libtmux-mcp', package: 'libtmux-mcp' },
    ]
    : mcpRoots[port] ? [{ product: 'mcp', checkout, root: mcpRoots[port], repo: cfg.repo }] : []
  for (const extra of extras) {
    const extraHead = git(extra.checkout, 'rev-parse', 'HEAD')
    if (!extraHead || !existsSync(join(extra.checkout, extra.root))) throw new Error(`Missing ${port} ${extra.product} source`)
    const extraRevision = publicRevision(extra.checkout, extraHead, port, extra.repo)
    const extracted = await extractProject({
      port, root: join(extra.checkout, extra.root), revision: extraRevision,
      options: { ...cfg.options, privateMembers: false, specialMembers: true },
    })
    // These crates use file-relative names. Prefix the additional package so
    // its server and error declarations cannot merge with core declarations.
    if (port === 'ts' || port === 'rs') {
      for (const symbol of extracted.symbols) {
        symbol.id = `mcp.${symbol.id}`
        if (symbol.publicId) symbol.publicId = `mcp.${symbol.publicId}`
        if (symbol.parent) symbol.parent = `mcp.${symbol.parent}`
        if (symbol.inheritedFrom) symbol.inheritedFrom = `mcp.${symbol.inheritedFrom}`
      }
    }
    for (const symbol of extracted.symbols) symbol.product = extra.product
    if (model.pruned) model.pruned.dropped += extracted.pruned?.dropped ?? 0
    sourceUnits.push({ ...extra, revision: extraRevision, head: extraHead, symbols: extracted.symbols })
    model.symbols = [...model.symbols, ...extracted.symbols]
  }
  if (port === 'cxx') {
    const output = mkdtempSync(join(tmpdir(), 'libtmux-docs-cxx-reference-'))
    const quote = (value) => `"${value.replaceAll('"', '\\"')}"`
    const config = [
      `@INCLUDE = ${quote(join(checkout, 'Doxyfile'))}`,
      `INPUT = ${quote(join(checkout, 'examples/workspace/include'))} ${quote(join(checkout, 'apps/mcp/include'))}`,
      `OUTPUT_DIRECTORY = ${quote(output)}`,
      `STRIP_FROM_PATH = ${quote(checkout)}`,
      'EXTRACT_ALL = YES', 'WARN_AS_ERROR = NO',
    ].join('\n')
    execFileSync('doxygen', ['-'], { cwd: checkout, input: config, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    const symbols = extractDoxygen(join(output, 'xml'), checkout)
      .filter((symbol) => /^(examples\/workspace|apps\/mcp)\//.test(symbol.source.file))
    sourceUnits[0].symbols.push(...symbols)
    rmSync(output, { recursive: true })
  }
  if (model.pruned) model.pruned.kept = model.symbols.length
  const productOf = (file) => /(?:^|\/)(?:workspace|TmuxWorkspace|LibTmux\.Workspace|libtmux-workspace)(?:\/|$)|crates\/tmux-workspace\//.test(file)
    ? 'workspace'
    : /(?:^|\/)(?:mcp|LibTmuxMCP|LibTmux\.Mcp|libtmux-mcp)(?:\/|$)|crates\/tmux-mcp\//.test(file) ? 'mcp' : 'core'
  const packages = {
    ts: { workspace: '@libtmux/workspace', mcp: '@libtmux/mcp' },
    rs: { workspace: 'tmux-workspace', mcp: 'tmux-mcp' },
    go: { workspace: 'github.com/libtmux/libtmux-go/workspace', mcp: 'github.com/libtmux/libtmux-go/mcp' },
    java: { workspace: 'libtmux-workspace', mcp: 'libtmux-mcp' },
    csharp: { workspace: 'LibTmux.Workspace', mcp: 'LibTmux.Mcp' },
    cxx: { workspace: 'workspace consumer', mcp: 'mcp_tools consumer' },
    swift: { workspace: 'TmuxWorkspace', mcp: 'LibTmuxMCP' },
  }
  if (!cfg.nativeArtifact) model.sources = []
  for (const unit of cfg.nativeArtifact ? [] : sourceUnits) {
    const bases = [unit.checkout, unit.checkout.replace(/-docs$/, '')]
    for (const symbol of unit.symbols) {
      const file = symbol.source.file
      const base = bases.find((candidate) => file.startsWith(`${candidate}/`)) ?? unit.checkout
      const relativeFile = isAbsolute(file) ? relative(base, file) : file
      if (cfg.generate && relativeFile.includes('/build/generated/')) {
        model.generatedSources ??= {}
        model.generatedSources[relativeFile] ??= readFileSync(join(unit.checkout, relativeFile), 'utf8')
      }
      symbol.product ??= productOf(relativeFile)
      symbol.source = { ...symbol.source, file: relativeFile, repo: unit.repo, revision: unit.revision, extractedRevision: unit.head }
    }
    inheritProductFromOwners(unit.symbols)
    for (const product of ['workspace', 'mcp']) {
      const symbols = unit.symbols.filter((symbol) => symbol.product === product)
      if (!symbols.length) continue
      let entries = []
      if (port === 'ts') {
        const manifest = JSON.parse(readFileSync(join(unit.checkout, `packages/${product}/package.json`), 'utf8'))
        entries = Object.values(manifest.exports).flatMap((entry) => typeof entry === 'object' && entry.bun ? [resolve(unit.checkout, `packages/${product}`, entry.bun)] : [])
      } else if (port === 'rs') entries = [join(unit.checkout, `crates/tmux-${product}/src/lib.rs`)]
      scopeProductSymbols(symbols, { port, root: unit.checkout, entries, readSource: (file) => readFileSync(file, 'utf8') })
    }
    remapLines(unit.checkout, unit.symbols, unit.revision, unit.head)
    for (const product of new Set(unit.symbols.map((symbol) => symbol.product))) {
      model.sources.push({
        product, package: unit.package ?? packages[port]?.[product] ?? portBySlug[port].packageName,
        repo: unit.repo, revision: unit.revision, extractedRevision: unit.head,
        version: packageVersion(unit.checkout, port, product),
      })
    }
  }
  if (cfg.nativeArtifact) {
    for (const symbol of model.symbols) {
      symbol.source = {
        ...symbol.source,
        repo: cfg.repo,
        revision,
        extractedRevision: head,
      }
    }
    for (const source of model.sources ?? []) {
      source.repo = cfg.repo
      source.revision = revision
      source.extractedRevision = head
    }
  }

  model.symbols = model.symbols.filter((symbol) => symbol.apiScope !== 'internal' || legacyIds.has(symbol.id))
  if (model.pruned) model.pruned.kept = model.symbols.length

  /**
   * A source path a blob URL can use.
   *
   * Absolute paths are machine-specific and would churn the diff on every
   * clone, so they are stored relative to the repository root. Two things
   * make that more than one `relative()` call, and getting it wrong made
   * every C++ and Swift "source" link a 404 — GitHub does not normalise `..`
   * in a blob path, and `check-links.mjs` never saw it because these are
   * external URLs.
   *
   * Doxygen already reports paths relative to its own input root, and
   * `relative()` resolves a relative second argument against the *process*
   * cwd — which is this repository, not the checkout. That turned
   * `include/libtmux/abi.hpp` into `../docs/include/libtmux/abi.hpp`.
   *
   * Swift's symbol graph reports absolute paths into the sibling source
   * checkout rather than the `-docs` worktree the graph was built in, so
   * relativising against the worktree produced `../libtmux-swift/Sources/…`.
   * The path belongs to the repository it names, which is the checkout with
   * the `-docs` suffix removed.
   */
  const repoRoots = [checkout, checkout.replace(/-docs$/, '')]
  for (const s of model.symbols) {
    const file = s.source.file
    if (!isAbsolute(file)) continue
    const base = repoRoots.find((r) => file.startsWith(`${r}/`)) ?? checkout
    s.source = { ...s.source, file: relative(base, file) }
  }
  /*
   * A unique URL segment per symbol, decided here rather than derived.
   *
   * Every symbol gets its own page, so its slug has to be injective — and
   * `pageSlug` alone is not. It lowercases, so `libtmux::Client::name` and
   * `libtmux::client::name` collapse together, and it strips punctuation, so
   * Swift's `!=(_:_:)` and `==(_:_:)` do too. 96 symbols across five ports
   * would have shared a page with something else, silently: Astro keeps the
   * last writer.
   *
   * Colliding slugs take a short hash of the full id. Only the collisions do,
   * so 11,496 URLs stay readable, and the hash is of the id rather than of a
   * position in a sorted list — a new symbol joining a group must not rename
   * the pages of the ones already in it.
   */
  const bySlug = new Map()
  for (const s of model.symbols) {
    const base = pageSlug(s.publicId ?? s.id)
    if (!bySlug.has(base)) bySlug.set(base, [])
    bySlug.get(base).push(s)
  }
  let disambiguated = 0
  for (const [base, group] of bySlug) {
    if (group.length === 1) {
      group[0].slug = base
      continue
    }
    for (const s of group) {
      s.slug = `${base}-${shortHash(s.publicId ?? s.id)}`
      disambiguated++
    }
  }

  model.repo = cfg.repo

  const out = join(repoRoot, 'site/src/data/api', `${port}.json`)
  mkdirSync(dirname(out), { recursive: true })
  const text = `${JSON.stringify(model, null, 0)}\n`

  if (check) {
    // A port moving is not staleness of this file's content: every revision
    // and extracted revision moves with it, on the model and on each symbol.
    // Compare everything else, and the two sidecars built from the same pass.
    const strip = (t) => t.replace(/"(?:revision|extractedRevision)":"[0-9a-f]*",?/g, '')
    const read = (file) => {
      const path = join(repoRoot, 'site/src/data/api', file)
      return existsSync(path) ? readFileSync(path, 'utf8') : ''
    }
    const tree = git(checkout, 'ls-tree', '-r', '--name-only', head ?? 'HEAD')
    const committedPaths = read(`${port}.paths.json`)
    const nav = navSidecar(port, model)
    const stalePaths = [
      strip(read(`${port}.json`)) !== strip(text) && `${port}.json`,
      tree && JSON.stringify(committedPaths && JSON.parse(committedPaths).paths) !==
        JSON.stringify(repositoryPaths(tree, cfg)) && `${port}.paths.json`,
      nav && read(`${port}.nav.json`) !== `${JSON.stringify(nav)}\n` && `${port}.nav.json`,
    ].filter(Boolean)
    if (stalePaths.length) {
      console.error(`gen-api-model: ${stalePaths.join(', ')} stale — re-run without --check`)
      stale++
    } else {
      console.log(`gen-api-model: ${port}.json current (${model.symbols.length} symbols)`)
    }
    continue
  }

  writeFileSync(out, text)

  /*
   * The files this port ships at that revision, for prose that names one.
   *
   * Written here because this is where the checkout and the revision are
   * already resolved. The alternative is `git ls-tree` inside the markdown
   * pipeline, which runs fourteen times per assembly across eight
   * repositories — a hundred and twelve git invocations to answer a question
   * whose answer cannot change during a build.
   */
  /*
   * The sidebar, compiled once.
   *
   * Placing every symbol costs milliseconds and the answer cannot change
   * during a build, so it is decided here beside `slug` and written as a
   * sidecar. The alternative is every page scanning every symbol, which is
   * how the old flat sidebar worked.
   */
  writeNav(port, model)

  const tree = git(checkout, 'ls-tree', '-r', '--name-only', head ?? 'HEAD')
  if (tree) {
    writeFileSync(
      join(repoRoot, 'site/src/data/api', `${port}.paths.json`),
      `${JSON.stringify({ port, repo: cfg.repo, revision, paths: repositoryPaths(tree, cfg) })}\n`,
    )
  }

  const kinds = model.symbols.reduce((a, s) => ((a[s.kind] = (a[s.kind] ?? 0) + 1), a), {})
  console.log(
    `gen-api-model: ${port} -> ${model.symbols.length} symbols ` +
      `(${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}) ` +
      `${(text.length / 1024 / 1024).toFixed(1)} MB` +
      (disambiguated ? ` [${disambiguated} slugs disambiguated]` : ''),
  )
}
if (check && skipped) console.log(`gen-api-model: ${skipped} port(s) skipped`)
process.exit(stale ? 1 : 0)
