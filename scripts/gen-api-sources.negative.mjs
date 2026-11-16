#!/usr/bin/env node
/** Exercise revision binding and deliberately damaged API source caches. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { citedFiles, isCanonicalPath, run } from './gen-api-sources.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'libtmux-api-source-cache-'))
const modelsDir = join(scratch, 'models')
const outDir = join(scratch, 'out')
const checkout = join(scratch, 'checkout')
const target = join(outDir, 'go.json')

const quietly = (fn) => {
  const log = console.log
  console.log = () => {}
  try { return fn() } finally { console.log = log }
}
const options = (extra = {}) => ({ modelsDir, outDir, checkouts: () => [checkout], ...extra })

try {
  mkdirSync(modelsDir)
  mkdirSync(checkout)
  execFileSync('git', ['-C', checkout, 'init', '--quiet'])
  const checkoutGit = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
  writeFileSync(join(checkout, 'a.go'), 'package a\n\nfunc A() {}\n')
  checkoutGit('add', 'a.go')
  checkoutGit('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Declare A')
  const revision = checkoutGit('rev-parse', 'HEAD')
  const model = { port: 'go', repo: 'fixture/go', revision, symbols: [
    { id: 'A', name: 'A', kind: 'function', signatures: [], source: { file: 'a.go', line: 3 } },
    { id: 'Gone', name: 'Gone', kind: 'function', signatures: [], source: { file: 'gone.go', line: 1 } },
  ] }
  writeFileSync(join(modelsDir, 'go.json'), JSON.stringify(model))

  quietly(() => run(options()))
  const written = JSON.parse(readFileSync(target, 'utf8'))
  assert.deepEqual(Object.keys(written.files), ['a.go'])
  assert.equal(written.files['a.go'].revision, revision)
  console.log('ok   a cited file is cached at the model revision and a file the revision lacks is skipped')

  quietly(() => run(options({ check: true })))
  writeFileSync(join(checkout, 'a.go'), 'package a\n\n// uncommitted\n')
  quietly(() => run(options({ check: true })))
  console.log('ok   a dirty working tree changes nothing')

  const damage = (edit) => {
    const damaged = structuredClone(written)
    edit(damaged.files['a.go'])
    writeFileSync(target, JSON.stringify(damaged, null, 1))
  }
  const offline = { check: true, checkouts: () => [] }
  damage((entry) => { entry.content = 'package tampered\n' })
  assert.throws(() => quietly(() => run(options(offline))), /damaged bytes/)
  assert.throws(() => quietly(() => run(options({ check: true }))), /damaged bytes/)
  console.log('ok   changed bytes fail the check with or without a checkout')

  damage((entry) => { entry.sha256 = '0'.repeat(64) })
  assert.throws(() => quietly(() => run(options(offline))), /damaged bytes/)
  damage((entry) => { entry.revision = '1'.repeat(40) })
  assert.throws(() => quietly(() => run(options(offline))), /differs/)
  damage((entry) => { entry.repo = 'another/repo' })
  assert.throws(() => quietly(() => run(options(offline))), /differs/)
  console.log('ok   a wrong checksum, revision or repository fails offline')

  writeFileSync(target, JSON.stringify({ ...written, files: { ...written.files, 'extra.go': { ...written.files['a.go'] } } }, null, 1))
  assert.throws(() => quietly(() => run(options(offline))), /differs/)
  console.log('ok   an entry no declaration cites any more is stale')

  writeFileSync(target, `${JSON.stringify(written, null, 1)}\n`)
  quietly(() => run(options(offline)))
  console.log('ok   an intact cache needs no checkout')

  // A later commit moves the file, but the model still names the first revision.
  writeFileSync(join(checkout, 'a.go'), 'package a\n\nfunc A() { /* later */ }\n')
  checkoutGit('add', 'a.go')
  checkoutGit('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Later revision')
  quietly(() => run(options({ check: true })))
  console.log('ok   a later HEAD does not change the pinned bytes')

  // A build that regenerated the model at a later revision must replace the copies, not keep the committed ones.
  const later = checkoutGit('rev-parse', 'HEAD')
  const rebased = { ...model, revision: later, symbols: model.symbols.map((symbol) => ({ ...symbol, source: { ...symbol.source, line: 4 } })) }
  writeFileSync(join(modelsDir, 'go.json'), JSON.stringify(rebased))
  assert.throws(() => quietly(() => run(options({ check: true }))), /differs/)
  assert.throws(() => quietly(() => run(options({ sourceBound: true }))), /rewrites one port/)
  assert.throws(() => quietly(() => run(options({ sourceBound: true, check: true, only: 'go' }))), /rewrites one port/)
  quietly(() => run(options({ sourceBound: true, only: 'go' })))
  const rebound = JSON.parse(readFileSync(target, 'utf8')).files['a.go']
  assert.equal(rebound.revision, later)
  assert.match(rebound.content, /later/)
  quietly(() => run(options({ check: true })))
  console.log('ok   a source-bound run replaces the copies of the previous revision with the model\'s')

  // With no checkout holding the model's revision, the old copies are not kept as the new revision's.
  const beforeRefusal = readFileSync(target, 'utf8')
  writeFileSync(join(modelsDir, 'go.json'), JSON.stringify({ ...rebased, revision: '2'.repeat(40) }))
  assert.throws(() => quietly(() => run(options({ sourceBound: true, only: 'go', checkouts: () => [] }))), /no checkout holding 222222222222/)
  assert.throws(() => quietly(() => run(options({ sourceBound: true, only: 'go' }))), /no checkout holding 222222222222/)
  assert.equal(readFileSync(target, 'utf8'), beforeRefusal)
  assert.throws(() => quietly(() => run(options({ sourceBound: true, only: 'nothing' }))), /no model for nothing/)
  console.log('ok   a source-bound run that cannot read the model\'s revision fails and writes nothing')

  // Two repositories cannot share one path, since a page is addressed by path alone.
  assert.throws(() => citedFiles({ port: 'py', repo: 'a/a', revision, symbols: [
    { id: 'x', source: { file: 'src/x.py' } },
    { id: 'y', source: { file: 'src/x.py', repo: 'b/b', revision } },
  ] }), /cited at two revisions or repositories/)
  for (const file of ['../x.go', '/x.go', 'a//b.go', 'a/./b.go', 'a\\b.go', 'a/b.go?raw', 'a/b#c.go', '']) assert.equal(isCanonicalPath(file), false, file)
  assert.equal(isCanonicalPath('tmux/pane_capture.go'), true)
  console.log('ok   one path naming two revisions, and paths that leave the repository, are refused')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
