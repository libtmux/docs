import { parse } from 'smol-toml'
import type { ApiSymbol, DocBlock } from '../model.ts'
import { rustWorkspaceLayout } from './rust-workspace.ts'

interface Program {
  id: string
  title: string
  description: string
  sourceFile: string
  cargoExample: string
  targets: string[]
  expectedOutput: string
}
interface Manifest {
  schemaVersion: number
  language: string
  nativeInventory: string
  setupFiles: { sourceFile: string; name: string }[]
  programFileName: string
  runCommand: string
  examples: Program[]
}

const table = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)

/** Attach complete programs from the selected source, preserving historical release recipes. */
export function attachCompleteRustExamples(
  symbols: ApiSymbol[],
  read: (path: string) => string | undefined,
  source: { repo: string; revision: string },
): void {
  const layout = rustWorkspaceLayout(read)
  const packages = layout ? ['libtmux-tokio', 'libtmux'] : ['libtmux']
  const manifests = packages.map((name) => ({ name, path: `crates/${name}/examples/api/manifest.json` }))
  if (!layout && read(manifests[0].path) === undefined) return
  const require = (condition: unknown, message: string): void => {
    if (!condition) throw new Error(`Invalid complete Rust examples: ${message}`)
  }
  require(source.repo === 'libtmux/libtmux-rs' && /^[a-f0-9]{40}$/.test(source.revision),
    'source must name the Rust repository and a full revision')
  const codeFor = (file: string): string => {
    const code = read(file)
    if (!code?.trim() || !code.endsWith('\n') || code.includes('\r')) {
      throw new Error(`Invalid complete Rust examples: missing complete LF source: ${file}`)
    }
    return code
  }
  const urlFor = (file: string) => `https://github.com/${source.repo}/blob/${source.revision}/${file}`
  const workspace = parse(codeFor('Cargo.toml')).workspace
  const release = table(workspace) && table(workspace.package) ? workspace.package : {}
  const version = typeof release.version === 'string' ? release.version : ''
  const rustFloor = typeof release['rust-version'] === 'string' ? release['rust-version'] : ''
  require(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version), 'workspace must declare a release version')
  require(/^\d+\.\d+(?:\.\d+)?$/.test(rustFloor), 'workspace must declare its minimum Rust version')
  const inventories = new Map<string, Map<string, string[]>>()
  const nativeKinds = (target: string): string[] => {
    const namespace = target.split('::')[0]
    let native = inventories.get(namespace)
    if (!native) {
      const owner = layout?.find((entry) => entry.namespace === namespace)
      require(layout ? owner : namespace === 'libtmux', `unknown native crate: ${namespace}`)
      const file = owner?.inventory ?? 'crates/libtmux/docs/public-api.txt'
      native = new Map()
      for (const match of codeFor(file).matchAll(/^(\w+) ([\w]+::[\w:]+)(?=: |$)/gm)) {
        native.set(match[2], [...(native.get(match[2]) ?? []), match[1]])
      }
      inventories.set(namespace, native)
    }
    return native.get(target) ?? []
  }
  const isCore = (symbol: ApiSymbol) =>
    (layout ? /(?:^|\/)crates\/libtmux(?:-core|-blocking|-tokio)?\/src\// : /(?:^|\/)crates\/libtmux\/src\//)
      .test(symbol.source.file) && (!symbol.product || symbol.product === 'core')
  const resolve = (target: string): ApiSymbol => {
    const kinds = nativeKinds(target)
    require(kinds.length === 1, `native target must resolve once: ${target}`)
    const kind = kinds[0] === 'function' ? 'method' : kinds[0]
    require(['struct', 'enum', 'trait', 'method'].includes(kind), `unsupported native kind: ${target}`)
    const canonical = target.replaceAll('::', '.')
    const suffix = target.split('::').slice(1).join('.')
    let matches = symbols.filter((symbol) => isCore(symbol) && symbol.kind === kind && symbol.publicId === canonical)
    if (kind === 'method') {
      const owner = resolve(target.slice(0, target.lastIndexOf('::')))
      if (!matches.length) matches = symbols.filter((symbol) => isCore(symbol) && symbol.kind === kind &&
        symbol.name === target.split('::').at(-1) && symbol.parent === owner.id)
      require(matches.length === 1, `API target must resolve once with its native kind: ${target}`)
      require(matches[0].parent === owner.id, `API target has the wrong native owner: ${target}`)
      return matches[0]
    }
    if (!matches.length) {
      matches = symbols.filter((symbol) => isCore(symbol) && symbol.kind === kind &&
        [symbol.publicId ?? symbol.id, symbol.id].some((id) => id === suffix || id.endsWith(`.${suffix}`)))
      if (layout) {
        const owner = layout.find((entry) => entry.namespace === target.split('::')[0])!
        const own = matches.filter((symbol) => symbol.source.file.includes(`${owner.root}/`))
        if (own.length) matches = own
      }
    }
    require(matches.length === 1, `API target must resolve once with its native kind: ${target}`)
    return matches[0]
  }
  const ids = new Set<string>()
  const targets = new Set<string>()
  const pending: { symbol: ApiSymbol; blocks: NonNullable<DocBlock['examples']> }[] = []
  for (const { name, path } of manifests) {
    const raw = read(path)
    require(raw !== undefined, `missing current manifest: ${path}`)
    const manifest = JSON.parse(raw!) as Manifest
    const setup = [
      { sourceFile: `crates/${name}/examples/api/consumer.toml`, name: 'Cargo.toml' },
      { sourceFile: 'rust-toolchain.toml', name: 'rust-toolchain.toml' },
    ]
    require(manifest?.schemaVersion === 1 && manifest.language === 'rust' &&
      Array.isArray(manifest.examples) && manifest.examples.length, 'unsupported or empty manifest')
    require(manifest.nativeInventory === `crates/${name}/docs/public-api.txt` &&
      manifest.programFileName === 'src/main.rs' && manifest.runCommand === 'cargo run --quiet' &&
      JSON.stringify(manifest.setupFiles) === JSON.stringify(setup), 'unexpected consumer setup')
    const cargo = parse(codeFor(setup[0].sourceFile))
    const dependencies = cargo.dependencies
    const runtime = table(dependencies) && table(dependencies.tokio) ? dependencies.tokio : undefined
    const features = runtime?.features
    const packageName = table(cargo.package) && typeof cargo.package.name === 'string' ? cargo.package.name : ''
    require(table(cargo.package) && (layout ? /^libtmux-[a-z-]+-example$/.test(packageName) : packageName === 'libtmux-api-example') &&
      cargo.package.edition === '2024' && cargo.package.publish === false && table(cargo.workspace) &&
      JSON.stringify(cargo.workspace.exclude) === JSON.stringify(['libtmux-source']) &&
      table(dependencies) && table(dependencies[name]) &&
      dependencies[name].path === `libtmux-source/crates/${name}` &&
      (layout ? dependencies.tempfile === undefined || typeof dependencies.tempfile === 'string' && dependencies.tempfile.trim()
        : typeof dependencies.tempfile === 'string' && dependencies.tempfile.trim()) &&
      runtime && typeof runtime.version === 'string' && Array.isArray(features) &&
      (layout ? ['rt', 'time'] : ['macros', 'rt', 'time']).every((feature) => features.includes(feature)),
    'consumer dependencies or workspace boundary are missing')
    const entries = Object.entries(dependencies as Record<string, unknown>)
    const local = entries.filter(([, spec]) => table(spec) && typeof spec.path === 'string')
    for (const [dependency, spec] of local) {
      require(table(spec) && spec.path === `libtmux-source/crates/${dependency}` &&
        (layout ? layout.some((entry) => entry.name === dependency) : dependency === 'libtmux'), 'wrong dependency path')
    }
    const plain = entries.filter(([dependency, spec]) => dependency !== name && typeof spec === 'string')
    const featured = entries.filter(([, spec]) => table(spec) && !spec.path && Array.isArray(spec.features))
    const addCommands = layout ? [
      ...local.map(([dependency, spec]) => {
        const item = spec as Record<string, unknown>
        return `cargo add --git https://github.com/${source.repo} --rev ${source.revision} ${dependency}` +
          (item['default-features'] === false ? ' --no-default-features' : '') +
          (Array.isArray(item.features) && item.features.length ? ` --features ${item.features.join(',')}` : '')
      }),
      ...(plain.length ? [`cargo add ${plain.map(([dependency, spec]) => `${dependency}@${spec as string}`).join(' ')}`] : []),
    ] : [`cargo add ${[`libtmux@${version}`, ...plain.map(([dependency, spec]) => `${dependency}@${spec as string}`)].join(' ')}`]
    addCommands.push(...featured.map(([dependency, spec]) => {
      const item = spec as { version: string; features: string[] }
      return `cargo add ${dependency}@${item.version} --features ${item.features.join(',')}`
    }))
    for (const program of manifest.examples) {
      require(typeof program.id === 'string' && /^rust-[a-z]+$/.test(program.id) && !ids.has(program.id), 'invalid or duplicate program ID')
      ids.add(program.id)
      const task = program.id.slice('rust-'.length)
      require(program.cargoExample === `api_${task}` &&
        program.sourceFile === `crates/${name}/examples/api_${task}.rs`, 'unexpected program path')
      require([program.title, program.description, program.expectedOutput].every(
        (value) => typeof value === 'string' && value.trim() && !/[\r\n]/.test(value)), 'task description or expected output is missing')
      require(Array.isArray(program.targets) && program.targets.length, 'API targets are missing')
      const code = codeFor(program.sourceFile)
      require(layout ? /^\s*(?:async\s+)?fn main\(\)/m.test(code)
        : code.includes('#[tokio::main') && code.includes('async fn main()'), 'program entry point is missing')
      if (layout && code.includes('#[tokio::main')) {
        require(Array.isArray(features) && features.includes('macros'), 'runtime entry point requires the macros feature')
      }
      require(!/\binclude(?:_str|_bytes)?!|^\s*mod\s+\w+\s*;|use\s+(?:crate|super)::/m.test(code), 'program depends on a hidden source helper')
      const blocks: NonNullable<DocBlock['examples']> = [{
        lang: 'console',
        intro: `${program.title}. ${program.description} Use Rust ${rustFloor} or newer with Cargo, and tmux 3.3a or newer, on a Unix system. In an empty directory, create a project and add ${layout ? 'the crates from this exact source revision' : 'the published crates'}:`,
        code: `$ cargo init --name ${packageName} &&\n${addCommands.map((command) => `  ${command}`).join(' &&\n')}\n`,
      }, {
        lang: 'rust',
        intro: layout ? 'Replace `src/main.rs` with this complete program. Keep its setup and cleanup together.'
          : 'Replace `src/main.rs` with this complete program. It owns a private tmux socket, applies a ten-second task deadline, and reports both task and cleanup errors. `Server::kill` stops its daemon; `Server::shutdown` closes its client executor. Successful cleanup removes the temporary directory even when the task fails.',
        sourceUrl: urlFor(program.sourceFile), code,
      }, {
        lang: 'console',
        intro: 'Run the consumer. Success exits with status 0; setup, operation, deadline or cleanup failures exit unsuccessfully and print diagnostics to stderr:',
        code: `$ ${manifest.runCommand}\n`,
      }, { lang: 'text', intro: 'Expected output:', code: `${program.expectedOutput}\n` }]
      for (const target of program.targets) {
        require(typeof target === 'string' && /^libtmux(?:_core|_blocking|_tokio)?::[\w:]+$/.test(target), 'invalid native target')
        require(!targets.has(target), `duplicate API target: ${target}`)
        targets.add(target)
        pending.push({ symbol: resolve(target), blocks })
      }
    }
  }
  for (const { symbol, blocks } of pending) {
    symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []), ...blocks] }
  }
}
