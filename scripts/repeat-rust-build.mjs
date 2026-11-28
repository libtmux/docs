/** Repeat the official Rust render from clean pinned worktrees and compare every byte. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rustWorkspaceLayout } from '../packages/api-model/src/languages/rust-workspace.ts'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const json = (file) => JSON.parse(readFileSync(file, 'utf8'))
const write = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()

function cleanInputs(inputs) {
  assert(inputs.schema === 1 && inputs.port === 'rs' && inputs.locale === 'en' &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(inputs.version) && !inputs.version.includes('..'), 'Rust render identity')
  assert(inputs.docs.repository === 'libtmux/docs' && inputs.docs.dirty === false &&
    /^[a-f0-9]{40}$/.test(inputs.docs.sha), 'clean pinned docs input')
  assert(inputs.sources.length === 1 && inputs.sources[0].product === 'core' &&
    inputs.sources[0].repository === 'libtmux/libtmux-rs' && inputs.sources[0].dirty === false &&
    /^[a-f0-9]{40}$/.test(inputs.sources[0].sha), 'clean pinned Rust input')
}

/** Full sorted path/size/content manifest, including build-provenance.json. */
export function rustRenderFiles(root) {
  const files = []
  const visit = (relative = '') => {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name
      const stat = lstatSync(join(root, path))
      assert(!stat.isSymbolicLink(), 'render contains no symlinks')
      if (stat.isDirectory()) visit(path)
      else {
        assert(stat.isFile(), 'render contains regular files')
        const bytes = readFileSync(join(root, path))
        files.push({ path, size: bytes.length, sha256: hash(bytes) })
      }
    }
  }
  visit()
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

/** Compare complete trees, the source-bound API model, API search and both llms exports. */
export function compareRustRenders({ firstRoot, secondRoot, firstModel, secondModel, inputs }) {
  cleanInputs(inputs)
  const first = rustRenderFiles(firstRoot)
  const second = rustRenderFiles(secondRoot)
  assert.deepEqual(first, second, 'repeat full version tree paths and content')
  for (const entry of first) assert(readFileSync(join(firstRoot, entry.path)).equals(
    readFileSync(join(secondRoot, entry.path))), `repeat bytes: ${entry.path}`)
  const model = readFileSync(firstModel)
  assert(model.equals(readFileSync(secondModel)), 'repeat API model bytes')
  assert.equal(json(firstModel).revision, inputs.sources[0].sha, 'source-bound repeated model')
  const exported = (path) => ({ path, firstSha256: hash(readFileSync(join(firstRoot, path))),
    secondSha256: hash(readFileSync(join(secondRoot, path))) })
  const search = exported('reference/tree.json')
  const llms = ['llms.txt', 'llms-full.txt'].map(exported)
  for (const root of [firstRoot, secondRoot]) {
    const provenance = json(join(root, 'build-provenance.json'))
    for (const key of ['schema', 'port', 'version', 'locale', 'docs', 'sources']) {
      assert.deepEqual(provenance[key], inputs[key], `repeat captured ${key}`)
    }
  }
  return { first, second, receipt: { schemaVersion: 1,
    sourceRevision: inputs.sources[0].sha, docsRevision: inputs.docs.sha, version: inputs.version,
    firstTreeSha256: hash(JSON.stringify(first)), secondTreeSha256: hash(JSON.stringify(second)),
    firstModelSha256: hash(model), secondModelSha256: hash(readFileSync(secondModel)),
    firstSearchSha256: search.firstSha256, secondSearchSha256: search.secondSha256,
    llms, cleanInputs: true, passed: true } }
}

/** Build again without copying generated outputs or compiled package artifacts. */
export function repeatNativeRustBuild({ docsRoot, sourceRoot, renderedRoot, inputSnapshot, output, env = process.env }) {
  const read = (file) => existsSync(join(sourceRoot, file)) ? readFileSync(join(sourceRoot, file), 'utf8') : undefined
  if (!rustWorkspaceLayout(read)) return undefined
  const inputs = json(inputSnapshot)
  cleanInputs(inputs)
  assert.equal(git(docsRoot, 'rev-parse', 'HEAD'), inputs.docs.sha, 'repeat docs HEAD')
  assert.equal(git(sourceRoot, 'rev-parse', 'HEAD'), inputs.sources[0].sha, 'repeat Rust HEAD')
  assert.equal(git(sourceRoot, 'status', '--porcelain', '--untracked-files=normal'), '', 'Rust source stayed clean')
  mkdirSync(output, { recursive: true })
  const base = mkdtempSync(join(tmpdir(), 'libtmux-rust-repeat-'))
  const secondDocs = join(base, 'docs')
  const secondPort = join(base, 'port')
  const added = []
  try {
    for (const [original, target, revision] of [[docsRoot, secondDocs, inputs.docs.sha], [sourceRoot, secondPort, inputs.sources[0].sha]]) {
      git(original, 'worktree', 'add', '--detach', target, revision)
      added.push([original, target])
      assert.equal(git(target, 'status', '--porcelain', '--untracked-files=normal'), '', 'fresh pinned worktree')
    }
    for (const path of ['_site', '.build-cache', 'site/dist', 'site/.astro', 'node_modules']) {
      assert(!existsSync(join(secondDocs, path)), `fresh generated/dependency path: ${path}`)
    }
    assert(!existsSync(join(secondPort, 'target')), 'fresh native Cargo target')
    const secondEnv = { ...env, LIBTMUX_DOCS_PORT: 'rs', LIBTMUX_DOCS_VERSION: inputs.version,
      LIBTMUX_DOCS_SOURCE_SHA: inputs.sources[0].sha,
      LIBTMUX_DOCS_CHECKOUT_RS: secondPort, PORT_CHECKOUT: secondPort,
      LIBTMUX_DOCS_INPUT_SNAPSHOT: resolve(inputSnapshot), CARGO_TARGET_DIR: join(secondPort, 'target'),
      LIBTMUX_DOCS_OUT_DIR: join(secondDocs, '_site'), LIBTMUX_DOCS_CACHE: join(secondDocs, '.build-cache') }
    const command = ['./scripts/build-site.sh', '--ports', 'rs', '--versions', inputs.version, '--skip-refs', '--skip-pagefind']
    const setupCommand = ['pnpm', 'install', '--frozen-lockfile']
    const locks = [[docsRoot, secondDocs, 'pnpm-lock.yaml'], [docsRoot, secondDocs, 'package.json'],
      [sourceRoot, secondPort, 'Cargo.lock'], [sourceRoot, secondPort, 'rust-toolchain.toml']].map(([first, second, file]) => {
      const bytes = readFileSync(join(first, file))
      assert(bytes.equals(readFileSync(join(second, file))), `repeat pinned setup: ${file}`)
      return { file, sha256: hash(bytes) }
    })
    execFileSync(setupCommand[0], setupCommand.slice(1), { cwd: secondDocs, env: secondEnv, stdio: 'inherit' })
    execFileSync(command[0], command.slice(1), { cwd: secondDocs, env: secondEnv, stdio: 'inherit' })
    const firstModel = join(docsRoot, 'site/src/data/api/rs.json')
    const secondModel = join(secondDocs, 'site/src/data/api/rs.json')
    for (const [which, tree, model] of [['first', renderedRoot, firstModel],
      ['second', join(secondDocs, '_site/en/rs', inputs.version), secondModel]]) {
      write(join(output, `${which}-tree.json`), rustRenderFiles(tree))
      copyFileSync(model, join(output, `api-model.${which}.json`))
    }
    const compared = compareRustRenders({ firstRoot: renderedRoot,
      secondRoot: join(secondDocs, '_site/en/rs', inputs.version), firstModel, secondModel, inputs })
    copyFileSync(inputSnapshot, join(output, 'input-snapshot.json'))
    const tool = (program, args) => execFileSync(program, args, { cwd: sourceRoot, env, encoding: 'utf8' }).trim()
    const receipt = { ...compared.receipt, inputSnapshotSha256: hash(readFileSync(inputSnapshot)),
      manifests: { first: 'first-tree.json', second: 'second-tree.json' }, command,
      setup: { command: setupCommand, locks, node: process.version,
        pnpm: tool('pnpm', ['--version']), cargo: tool('cargo', ['--version']),
        rustc: tool('rustc', ['--version']), tmux: tool('tmux', ['-V']),
        reused: 'Only package downloads verified by the unchanged pnpm/Cargo locks; generated outputs and Cargo target are fresh.' } }
    write(join(output, 'repeat.json'), receipt)
    return receipt
  } finally {
    for (const [original, target] of added.reverse()) git(original, 'worktree', 'remove', '--force', target)
    rmSync(base, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const option = (name) => args[args.indexOf(name) + 1]
  for (const name of ['--source', '--rendered', '--input-snapshot', '--output-dir']) assert(args.includes(name), `${name} is required`)
  const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const receipt = repeatNativeRustBuild({ docsRoot, sourceRoot: resolve(option('--source')),
    renderedRoot: resolve(option('--rendered')), inputSnapshot: resolve(option('--input-snapshot')),
    output: resolve(option('--output-dir')) })
  console.log(receipt ? `Rust repeat render: ${receipt.firstTreeSha256}` : 'Rust repeat render: legacy source layout, existing checks retained')
}
