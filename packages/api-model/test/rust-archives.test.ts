import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyRustArchiveJoin } from '../../../scripts/verify-rust-archives.mjs'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex')
const source = 'a'.repeat(40)
const docs = 'b'.repeat(40)
const programIds = ['construction', 'listings', 'creation', 'query', 'cardinality', 'input', 'capture', 'mixed']

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rust-archive-join-'))
  dirs.push(root)
  const archiveRoot = join(root, 'archives')
  mkdirSync(archiveRoot)
  const packages = ['libtmux-core', 'libtmux-blocking', 'libtmux-tokio', 'libtmux', 'libtmux-macros', 'tmux-workspace', 'tmux-mcp'].sort()
  const stdoutHex = Buffer.from('mixed runtime\n').toString('hex')
  const recorder = hash('recorder bytes')
  const model = JSON.stringify({ revision: source })
  const manifest = [{ path: 'index.html', size: 5, sha256: hash('hello') },
    { path: 'reference/tree.json', size: 6, sha256: hash('search') },
    ...['llms.txt', 'llms-full.txt'].map((path) => ({ path, size: path.length, sha256: hash(path) }))]
  const inputs = JSON.stringify({ docs: { sha: docs, dirty: false }, sources: [{ sha: source, dirty: false }] })
  writeFileSync(join(root, 'input-snapshot.json'), inputs)
  const repeat = { schemaVersion: 1, sourceRevision: source, docsRevision: docs,
    cleanInputs: true, passed: true, inputSnapshotSha256: hash(inputs),
    firstTreeSha256: hash(JSON.stringify(manifest)), secondTreeSha256: hash(JSON.stringify(manifest)),
    firstModelSha256: hash(model), secondModelSha256: hash(model),
    firstSearchSha256: hash('search'), secondSearchSha256: hash('search'),
    llms: ['llms.txt', 'llms-full.txt'].map((path) => ({ path, firstSha256: hash(path), secondSha256: hash(path) })) }
  const examples = programIds.map((name) => ({ sourceProgramId: `rust-${name}`,
    files: [{ sha256: hash(name) }], expectedOutputHex: stdoutHex }))
  const nativePane = { pane: '%7', generation: { pid: 123, started: 456 }, beforeHex: stdoutHex, afterHex: stdoutHex }
  const cleanup = { required: true, passed: true }
  const copy = { sourceRevision: source, docsRevision: docs, expectedArchivePackages: packages,
    recorderSha256: recorder, modelSha256: hash(model), examples,
    results: examples.map((entry) => ({ program: entry.sourceProgramId, sourceSha256: entry.files[0].sha256,
      native: { stdoutHex, passed: true, status: 0, timedOut: false, cleanup, native: nativePane } })) }
  const archives = packages.map((packageName) => {
    writeFileSync(join(archiveRoot, `${packageName}-0.1.2.crate`), packageName)
    return { package: packageName, version: '0.1.2', sha256: hash(packageName) }
  })
  const native = { sourceRevision: source, sourceDirty: false, passed: true,
    recorder: { repository: 'https://github.com/libtmux/docs', revision: docs, sha256: recorder }, archives,
    mixed: { programSha256: hash('mixed'), stdoutHex, cleanup, profile: 'raw-stdout-native-capture', native: nativePane } }
  for (const which of ['first', 'second']) {
    writeFileSync(join(root, `${which}-tree.json`), JSON.stringify(manifest))
    writeFileSync(join(root, `api-model.${which}.json`), model)
  }
  return { root, copy, native, archiveRoot, repeat }
}

describe('dependency-free Rust archive join', () => {
  it('requires every copied program, repeated export and physical archive at both exact pins', () => {
    const f = fixture()
    expect(() => verifyRustArchiveJoin(f.copy, f.native, f.archiveRoot, f.repeat, source, docs)).not.toThrow()
    for (const mutate of [
      () => { f.copy.results.pop() },
      () => { f.copy.results[0].native.timedOut = true },
      () => { f.copy.results[0].sourceSha256 = hash('different source') },
      () => { f.repeat.secondSearchSha256 = hash('changed search') },
      () => { f.repeat.llms[0].secondSha256 = hash('changed llms') },
      () => { f.repeat.firstTreeSha256 = ''; f.repeat.secondTreeSha256 = '' },
      () => { f.repeat.docsRevision = 'c'.repeat(40) },
      () => { f.native.sourceDirty = true },
      () => { writeFileSync(join(f.archiveRoot, 'libtmux-core-0.1.2.crate'), 'changed physical archive') },
    ]) {
      const saved = structuredClone({ copy: f.copy, native: f.native, repeat: f.repeat })
      mutate()
      expect(() => verifyRustArchiveJoin(f.copy, f.native, f.archiveRoot, f.repeat, source, docs)).toThrow()
      Object.assign(f, saved)
    }
  })

  it('runs from a sparse checkout without node_modules and checks the physical model and manifest', () => {
    const f = fixture()
    const script = join(f.root, 'verify-rust-archives.mjs')
    copyFileSync(new URL('../../../scripts/verify-rust-archives.mjs', import.meta.url), script)
    for (const [name, value] of [['copy', f.copy], ['native', f.native], ['repeat', f.repeat]]) {
      writeFileSync(join(f.root, `${name}.json`), JSON.stringify(value))
    }
    const args = [script, join(f.root, 'copy.json'), join(f.root, 'native.json'), f.archiveRoot,
      join(f.root, 'repeat.json'), source, docs]
    expect(execFileSync(process.execPath, args, { cwd: f.root, encoding: 'utf8' })).toContain('seven archives verified')
    writeFileSync(join(f.root, 'api-model.second.json'), '{}')
    expect(spawnSync(process.execPath, args, { cwd: f.root }).status).not.toBe(0)
  })

  it('binds physical input, search and llms evidence to the repeat receipt', () => {
    const f = fixture()
    const script = join(f.root, 'verify-rust-archives.mjs')
    copyFileSync(new URL('../../../scripts/verify-rust-archives.mjs', import.meta.url), script)
    for (const [name, value] of [['copy', f.copy], ['native', f.native], ['repeat', f.repeat]]) {
      writeFileSync(join(f.root, `${name}.json`), JSON.stringify(value))
    }
    const args = [script, join(f.root, 'copy.json'), join(f.root, 'native.json'), f.archiveRoot,
      join(f.root, 'repeat.json'), source, docs]
    const fail = (message: string) => {
      const result = spawnSync(process.execPath, args, { cwd: f.root, encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(message)
    }
    const inputFile = join(f.root, 'input-snapshot.json')
    const original = readFileSync(inputFile)
    writeFileSync(inputFile, '{}')
    fail('physical captured input snapshot')
    writeFileSync(inputFile, original)
    const changedSearch = { ...f.repeat, firstSearchSha256: hash('other'), secondSearchSha256: hash('other') }
    writeFileSync(join(f.root, 'repeat.json'), JSON.stringify(changedSearch))
    fail('physical manifest search bytes')
    const changedLlms = { ...f.repeat, llms: f.repeat.llms.map((entry) => ({ ...entry,
      firstSha256: hash('other'), secondSha256: hash('other') })) }
    writeFileSync(join(f.root, 'repeat.json'), JSON.stringify(changedLlms))
    fail('physical manifest llms bytes')
  })
})
