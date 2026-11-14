#!/usr/bin/env node
/** Exercise the behaviour generator against damaged inputs: it must refuse a fact whose line does not say it. */
import assert from 'node:assert/strict'
import { buildSidecar, verifySidecar } from './gen-api-behavior.mjs'

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
