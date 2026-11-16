#!/usr/bin/env node
/** Exercise the behaviour generator against damaged inputs: it must refuse a fact whose line does not say it. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSidecar, locateQuote, run, verifySidecar } from './gen-api-behavior.mjs'

const lines = [
  'package tmux',
  '',
  '// Capture captures printed content from the pane.',
  '// It returns a caller-owned slice. Failures become a [CommandError].',
  '//',
  '// Printed captures cannot safely cross a control connection.',
  'func (p Pane) Capture() {}',
]
const model = {
  repo: 'fixture/go', revision: 'a'.repeat(40),
  symbols: [{ id: 'tmux.Pane.Capture', name: 'Capture', kind: 'method', modifiers: [], signatures: [], source: { file: 'pane.go', line: 7 } }],
}
const linesOf = () => lines
const build = (curated, edited = lines) => buildSidecar('go', { model, curated: { 'tmux.Pane.Capture': curated }, linesOf: () => edited })

const good = build([{ row: 'transport', text: 'Printed captures cannot safely cross a control connection.', line: 6, quote: 'cannot safely cross a control connection' }])
assert.deepEqual(good.problems, [])
assert.equal(good.sidecar.symbols['tmux.Pane.Capture'].behavior.ownership.source.line, 4)
assert.deepEqual(good.sidecar.symbols['tmux.Pane.Capture'].evidence.transport, { line: 6, text: 'Printed captures cannot safely cross a control connection.' })
console.log('ok   facts that cite what the pinned lines say are accepted')

const wrongQuote = build([{ row: 'transport', text: 'Uses a subprocess.', line: 6, quote: 'subprocess' }])
assert.equal(wrongQuote.problems.length, 1)
assert.match(wrongQuote.problems[0], /does not contain the quoted words/)
console.log('ok   a curated fact whose quote is not on its line is refused')

const moved = build([{ row: 'transport', text: 'Printed captures cannot safely cross a control connection.', line: 2, quote: 'cannot safely cross' }])
assert.equal(moved.problems.length, 1)
console.log('ok   a curated fact citing the wrong line is refused')

const unknown = build([{ row: 'guess', text: 'x', line: 3, quote: 'x' }])
assert.match(unknown.problems[0], /unknown row guess/)
console.log('ok   a row the page does not draw is refused')

const rewritten = [...lines]
rewritten[3] = '// It returns a slice the caller must not keep. Failures become a [CommandError].'
const stale = buildSidecar('go', { model, curated: {}, linesOf })
assert.deepEqual(stale.problems, [])
const after = buildSidecar('go', { model, curated: {}, linesOf: () => rewritten })
assert.notEqual(after.sidecar.symbols['tmux.Pane.Capture']?.behavior.ownership?.text, stale.sidecar.symbols['tmux.Pane.Capture'].behavior.ownership.text)
console.log('ok   a rewritten comment changes the facts instead of keeping a stale sentence')

// Without a checkout the committed file is held to its own evidence lines.
const committed = stale.sidecar
assert.deepEqual(verifySidecar('go', committed, model), [])
const edited = structuredClone(committed)
edited.symbols['tmux.Pane.Capture'].behavior.ownership.text = 'It returns a slice the caller may keep.'
assert.ok(verifySidecar('go', edited, model).some((problem) => problem.includes('ownership')))
const moved2 = structuredClone(committed)
moved2.symbols['tmux.Pane.Capture'].behavior.ownership.source.line = 3
assert.ok(verifySidecar('go', moved2, model).some((problem) => problem.includes('ownership')))
const otherRevision = structuredClone(committed)
otherRevision.revision = 'b'.repeat(40)
assert.ok(verifySidecar('go', otherRevision, model).some((problem) => problem.includes('sidecar is for')))
console.log('ok   a committed fact edited by hand, moved, or bound to another revision fails offline')

// A build that regenerated the model at a later revision rewrites the sidecar for it, from the checkout it renders.
const scratch = mkdtempSync(join(tmpdir(), 'libtmux-api-behavior-'))
const quietly = (fn) => {
  const { log, warn, error } = console
  console.log = () => {}
  console.warn = () => {}
  console.error = () => {}
  try { return fn() } finally { Object.assign(console, { log, warn, error }) }
}
try {
  const checkout = join(scratch, 'checkout')
  const dataDir = join(scratch, 'data')
  const curatedFile = join(scratch, 'curated.json')
  for (const dir of [checkout, dataDir]) mkdirSync(dir)
  const git = (...args) => execFileSync('git', ['-C', checkout, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
  const commit = (text, message) => {
    writeFileSync(join(checkout, 'pane.go'), text)
    git('add', 'pane.go')
    git('commit', '--quiet', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '--quiet')
  const first = commit(`${lines.join('\n')}\n`, 'Declare Capture')
  // Two lines are added above the declaration, so every cited line moves down by two.
  const second = commit(`// New file comment.\n//\n${lines.join('\n')}\n`, 'Move Capture')
  const modelAt = (revision, line) => ({ port: 'go', repo: 'fixture/go', revision, symbols: [{ ...model.symbols[0], source: { file: 'pane.go', line } }] })
  const quote = 'Failures become'
  const curated = (entry) => writeFileSync(curatedFile, JSON.stringify({ go: { 'tmux.Pane.Capture': [entry] } }))
  const options = { dataDir, curatedFile, checkoutOf: () => checkout }
  const sidecarOf = () => JSON.parse(readFileSync(join(dataDir, 'go.behavior.json'), 'utf8'))
  const entry = { row: 'cleanup', text: 'Failures become a CommandError.', line: 4, quote }

  curated(entry)
  writeFileSync(join(dataDir, 'go.json'), JSON.stringify(modelAt(first, 7)))
  assert.equal(quietly(() => run(['go'], options)), true)
  assert.equal(sidecarOf().revision, first)

  writeFileSync(join(dataDir, 'go.json'), JSON.stringify(modelAt(second, 9)))
  assert.equal(quietly(() => run(['--check', 'go'], options)), false)
  assert.equal(quietly(() => run(['--source-bound', 'go'], options)), true)
  const rebound = sidecarOf()
  assert.equal(rebound.revision, second)
  assert.equal(rebound.symbols['tmux.Pane.Capture'].behavior.ownership.source.line, 6)
  console.log('ok   a source-bound run rewrites the sidecar for the revision of the model it was given')

  // The curated fact's quote moved with the comment; its recorded line no longer holds it.
  assert.equal(rebound.symbols['tmux.Pane.Capture'].behavior.cleanup.source.line, 6)
  assert.equal(locateQuote(lines, entry, 'go'), 4)
  assert.equal(locateQuote(['// a', '// b'], entry, 'go'), undefined)
  assert.equal(locateQuote([`// ${quote}`, `// ${quote}`], { ...entry, line: 5 }, 'go'), undefined)
  console.log('ok   a curated fact follows its quoted words to their new line, and is dropped when they are gone or ambiguous')

  curated({ ...entry, quote: 'a sentence the comment no longer states' })
  assert.equal(quietly(() => run(['--source-bound', 'go'], options)), true)
  assert.equal(sidecarOf().symbols['tmux.Pane.Capture'].behavior.cleanup, undefined)
  assert.ok(sidecarOf().symbols['tmux.Pane.Capture'].behavior.ownership)
  assert.equal(quietly(() => run(['go'], options)), false)
  console.log('ok   an unsound curated fact is left out of a source-bound sidecar and still fails an ordinary run')

  assert.throws(() => quietly(() => run(['--source-bound', 'go'], { ...options, checkoutOf: () => join(scratch, 'nowhere') })), /no checkout holds/)
  writeFileSync(join(dataDir, 'go.json'), JSON.stringify(modelAt('3'.repeat(40), 9)))
  assert.throws(() => quietly(() => run(['--source-bound', 'go'], options)), /no checkout holds 333333333333/)
  assert.equal(sidecarOf().revision, second)
  assert.throws(() => quietly(() => run(['--source-bound'], options)), /rewrites one port/)
  assert.throws(() => quietly(() => run(['--source-bound', '--check', 'go'], options)), /rewrites one port/)
  assert.equal(quietly(() => run(['--source-bound', 'py'], options)), true)
  console.log('ok   a source-bound run with no checkout of the model\'s revision fails and leaves the sidecar as it was')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
