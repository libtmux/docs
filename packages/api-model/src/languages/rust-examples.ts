import { parse } from 'smol-toml'
import type { ApiSymbol, DocBlock } from '../model.ts'

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

const setup = [
  { sourceFile: 'crates/libtmux/examples/api/consumer.toml', name: 'Cargo.toml' },
  { sourceFile: 'rust-toolchain.toml', name: 'rust-toolchain.toml' },
]

/** Attach complete consumers using the committed native inventory's kinds and owners. */
export function attachCompleteRustExamples(
  symbols: ApiSymbol[],
  read: (path: string) => string | undefined,
  source: { repo: string; revision: string },
): void {
  const raw = read('crates/libtmux/examples/api/manifest.json')
  if (raw === undefined) return
  const require = (condition: unknown, message: string): void => {
    if (!condition) throw new Error(`Invalid complete Rust examples: ${message}`)
  }
  const manifest = JSON.parse(raw) as Manifest
  require(source.repo === 'libtmux/libtmux-rs' &&
    /^[a-f0-9]{40}$/.test(source.revision), 'source must name the Rust repository and a full revision')
  require(manifest?.schemaVersion === 1 &&
    manifest.language === 'rust' &&
    Array.isArray(manifest.examples) &&
    manifest.examples.length, 'unsupported or empty manifest')
  require(manifest.nativeInventory === 'crates/libtmux/docs/public-api.txt' &&
    manifest.programFileName === 'src/main.rs' &&
    manifest.runCommand === 'cargo run --quiet' &&
    JSON.stringify(manifest.setupFiles) === JSON.stringify(setup), 'unexpected consumer setup')
  const codeFor = (file: string): string => {
    const code = read(file)
    if (!code?.trim() || !code.endsWith('\n') || code.includes('\r')) {
      throw new Error(`Invalid complete Rust examples: missing complete LF source: ${file}`)
    }
    return code
  }
  const urlFor = (file: string) => `https://github.com/${source.repo}/blob/${source.revision}/${file}`
  const setupCode = setup.map((file) => codeFor(file.sourceFile))
  // Parse TOML rather than accepting a plausible-looking line inside malformed setup.
  const cargo = parse(setupCode[0])
  const toolchain = parse(setupCode[1]).toolchain
  const packageInfo = cargo.package
  const workspace = cargo.workspace
  const dependencies = cargo.dependencies
  const table = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
  const tokio = table(dependencies) && table(dependencies.tokio) ? dependencies.tokio : undefined
  const features = tokio?.features
  require(table(packageInfo) &&
    packageInfo.name === 'libtmux-api-example' &&
    packageInfo.edition === '2024' &&
    packageInfo.publish === false &&
    table(workspace) &&
    JSON.stringify(workspace.exclude) === JSON.stringify(['libtmux-source']) &&
    table(dependencies) &&
    table(dependencies.libtmux) &&
    dependencies.libtmux.path === 'libtmux-source/crates/libtmux' &&
    typeof dependencies.tempfile === 'string' &&
    dependencies.tempfile.trim() &&
    tokio &&
    typeof tokio.version === 'string' &&
    Array.isArray(features) &&
    ['macros', 'rt', 'time'].every((feature) =>
      features.includes(feature),
    ), 'consumer dependencies or workspace boundary are missing')
  const channel = table(toolchain) && typeof toolchain.channel === 'string' ? toolchain.channel : ''
  require(/^\d+\.\d+\.\d+$/.test(channel), 'toolchain must pin a Rust release')

  const native = new Map<string, string[]>()
  for (const match of codeFor(manifest.nativeInventory).matchAll(/^(\w+) (libtmux::[\w:]+)(?=: |$)/gm)) {
    native.set(match[2], [...(native.get(match[2]) ?? []), match[1]])
  }
  const isCore = (symbol: ApiSymbol) =>
    /(?:^|\/)crates\/libtmux\/src\//.test(symbol.source.file) && (!symbol.product || symbol.product === 'core')
  const resolve = (target: string): ApiSymbol => {
    const kinds = native.get(target) ?? []
    require(kinds.length === 1, `native target must resolve once: ${target}`)
    const kind = kinds[0] === 'function' ? 'method' : kinds[0]
    require(['struct', 'enum', 'trait', 'method'].includes(kind), `unsupported native kind: ${target}`)
    const suffix = target.slice('libtmux::'.length).replaceAll('::', '.')
    const matches = symbols.filter(
      (symbol) => isCore(symbol) && symbol.kind === kind && (symbol.id === suffix || symbol.id.endsWith(`.${suffix}`)),
    )
    require(matches.length === 1, `API target must resolve once with its native kind: ${target}`)
    const symbol = matches[0]
    if (kind === 'method') {
      const owner = resolve(target.slice(0, target.lastIndexOf('::')))
      require(symbol.parent === owner.id, `API target has the wrong native owner: ${target}`)
    }
    return symbol
  }
  const ids = new Set<string>()
  const targets = new Set<string>()
  const pending: { symbol: ApiSymbol; blocks: NonNullable<DocBlock['examples']> }[] = []
  for (const program of manifest.examples) {
    require(typeof program.id === 'string' &&
      /^rust-[a-z]+$/.test(program.id) &&
      !ids.has(program.id), 'invalid or duplicate program ID')
    ids.add(program.id)
    const name = program.id.slice('rust-'.length)
    require(program.cargoExample === `api_${name}` &&
      program.sourceFile === `crates/libtmux/examples/api_${name}.rs`, 'unexpected program path')
    require([program.title, program.description, program.expectedOutput].every(
      (value) => typeof value === 'string' && value.trim() && !/[\r\n]/.test(value),
    ), 'task description or expected output is missing')
    require(Array.isArray(program.targets) && program.targets.length, 'API targets are missing')
    const code = codeFor(program.sourceFile)
    require(code.includes('#[tokio::main') && code.includes('async fn main()'), 'program entry point is missing')
    require(!/\binclude(?:_str|_bytes)?!|^\s*mod\s+\w+\s*;|use\s+(?:crate|super)::/m.test(
      code,
    ), 'program depends on a hidden source helper')
    const blocks: NonNullable<DocBlock['examples']> = [
      {
        lang: 'console',
        intro: `${program.title}. ${program.description} Use a Unix environment with Git, rustup, and tmux 3.2a or newer. The toolchain file below pins Rust ${channel}. In an empty directory, fetch the documented source:`,
        code: `$ git clone https://github.com/${source.repo}.git libtmux-source &&\n  git -C libtmux-source checkout --detach ${source.revision}\n`,
      },
      ...setup.map((file, index) => ({
        lang: 'toml',
        intro: `Save this complete consumer setup as ${file.name}:`,
        sourceUrl: urlFor(file.sourceFile),
        code: setupCode[index],
      })),
      {
        lang: 'rust',
        intro:
          'Save this complete program as src/main.rs. It owns a private tmux socket, applies a ten-second task deadline, and reports both task and cleanup errors. Server::kill stops its daemon; Server::shutdown closes its client executor. Successful cleanup removes the temporary directory even when the task fails.',
        sourceUrl: urlFor(program.sourceFile),
        code,
      },
      {
        lang: 'console',
        intro:
          'Copy the complete files from the pinned checkout and run the consumer. This also creates src for the displayed program. Success exits with status 0; setup, operation, deadline or cleanup failures exit unsuccessfully and print diagnostics to stderr:',
        code:
          '$ mkdir -p src &&\n' +
          '  cp libtmux-source/crates/libtmux/examples/api/consumer.toml Cargo.toml &&\n' +
          '  cp libtmux-source/rust-toolchain.toml rust-toolchain.toml &&\n' +
          `  cp libtmux-source/${program.sourceFile} src/main.rs &&\n` +
          `  ${manifest.runCommand}\n`,
      },
      { lang: 'text', intro: 'Expected output:', code: `${program.expectedOutput}\n` },
    ]
    for (const target of program.targets) {
      require(typeof target === 'string' && /^libtmux::[\w:]+$/.test(target), 'invalid native target')
      require(!targets.has(target), `duplicate API target: ${target}`)
      targets.add(target)
      pending.push({ symbol: resolve(target), blocks })
    }
  }
  for (const { symbol, blocks } of pending) {
    symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []), ...blocks] }
  }
}
