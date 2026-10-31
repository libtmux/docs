#!/usr/bin/env node
/** Exercise the showcase generator against sources that must be refused. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasRevision, parseConfig, quoteDocument, readExample, trustedBlock } from './gen-workspace-showcase.mjs'

const DOCUMENT = 'session_name: demo\nwindows:\n  - window_name: one\n    panes: [echo a, echo b]\n'

// Dedenting, markers and anchors.
const source = ['const a = `unrelated`', 'fn demo() {', '  doc := `session_name: demo', 'windows:', '- panes: [x]', '`', '}'].join('\n')
assert.deepEqual(quoteDocument(source, { open: 'doc := `', close: '`', after: 'fn demo' }), { text: 'session_name: demo\nwindows:\n- panes: [x]', lines: [3, 5] })
const indented = '    """\n    a: 1\n      b: 2\n    """'
assert.equal(quoteDocument(indented, { open: '"""\n', close: '\n    """' }).text, 'a: 1\n  b: 2')
assert.throws(() => quoteDocument(source, { open: 'doc := `', close: '`', after: 'fn missing' }), /anchor not found/)
assert.throws(() => quoteDocument(source, { open: 'nothing := `', close: '`' }), /opening marker not found/)
assert.throws(() => quoteDocument(source, { open: 'doc := `', close: '#' }), /closing marker not found/)
assert.throws(() => quoteDocument('x := ``', { open: 'x := `', close: '`' }), /empty/)
console.log('ok   quoted documents are dedented, anchored and refused when a marker is missing')

assert.deepEqual(parseConfig('a: [1, 2]\nb: {c: d}'), { a: [1, 2], b: { c: 'd' } })
assert.throws(() => parseConfig('- just\n- a list'), /mapping/)
assert.throws(() => parseConfig('a: [unterminated'))
console.log('ok   a workspace document must be a mapping that parses')

// Revisions, tests and fixtures in a repository of their own.
const scratch = mkdtempSync(join(tmpdir(), 'libtmux-workspace-showcase-'))
const git = (...args) => execFileSync('git', ['-C', scratch, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
try {
  git('init', '--quiet')
  mkdirSync(join(scratch, 'fixtures'))
  writeFileSync(join(scratch, 'fixtures/demo.yaml'), DOCUMENT)
  writeFileSync(join(scratch, 'loads_test.py'), 'def test_demo():\n    load("fixtures/demo.yaml")\n')
  git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Fixture')
  const revision = git('rev-parse', 'HEAD')
  const example = {
    topic: 'two-pane', also: [], source: { path: 'fixtures/demo.yaml' },
    tests: [{ path: 'loads_test.py', name: 'test_demo', via: 'cli', checks: 'Loads the file.' }],
  }
  const read = (change = {}) => readExample({ checkout: scratch, revision, example: { ...example, ...change } })

  const good = read()
  assert.equal(good.yaml, DOCUMENT.trimEnd())
  assert.deepEqual(JSON.parse(good.json).windows[0].panes, ['echo a', 'echo b'])
  assert.equal(good.tests[0].line, 1)
  assert.equal(hasRevision({ checkout: scratch, revision }), true)
  assert.equal(hasRevision({ checkout: scratch, revision: 'a'.repeat(40) }), false)
  assert.equal(hasRevision({ checkout: join(scratch, 'absent'), revision }), false)
  console.log('ok   an example is read from committed bytes with the line of its test')

  // A later commit and a dirty tree do not change the bytes read at the revision.
  writeFileSync(join(scratch, 'fixtures/demo.yaml'), 'session_name: changed\nwindows: []\n')
  assert.deepEqual(read(), good)
  console.log('ok   a dirty working tree does not change an example')

  assert.throws(() => read({ tests: [{ ...example.tests[0], name: 'test_renamed' }] }), /"test_renamed" is not in the file/)
  assert.throws(() => read({ tests: [{ ...example.tests[0], needles: ['other.yaml'] }] }), /"other.yaml" is not in the file/)
  assert.throws(() => read({ tests: [{ ...example.tests[0], path: 'missing_test.py' }] }))
  assert.throws(() => read({ source: { path: 'fixtures/missing.yaml' } }))
  console.log('ok   a test that is renamed, no longer names its fixture or is absent fails')

  // The cache stands in for a checkout only when it still describes the sources.
  const block = { repo: 'fixture/repo', revision, examples: [good] }
  const wanted = { repo: 'fixture/repo', revision, examples: [example] }
  assert.equal(trustedBlock(block, wanted), true)
  assert.equal(trustedBlock(undefined, wanted), false)
  assert.equal(trustedBlock({ ...block, revision: 'b'.repeat(40) }, wanted), false)
  assert.equal(trustedBlock({ ...block, repo: 'another/repo' }, wanted), false)
  assert.equal(trustedBlock({ ...block, examples: [{ ...good, yaml: 'damaged: true' }] }, wanted), false)
  assert.equal(trustedBlock(block, { ...wanted, examples: [{ ...example, topic: 'tiled' }] }), false)
  assert.equal(trustedBlock(block, { ...wanted, examples: [{ ...example, source: { path: 'fixtures/other.yaml' } }] }), false)
  assert.equal(trustedBlock(block, { ...wanted, examples: [{ ...example, tests: [{ ...example.tests[0], name: 'test_other' }] }] }), false)
  assert.equal(trustedBlock(block, { ...wanted, examples: [] }), false)
  console.log('ok   a cached block is refused after a pin, a topic, a source, a test or its bytes change')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
