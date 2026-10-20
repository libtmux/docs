#!/usr/bin/env node
/*
 * Proof that `gen-tmux-usage.mjs --check` fails on usage data that no longer
 * fits the API models.
 *
 * The control is the committed data, because a check that always failed would
 * satisfy every other case. Each case is a different way to be stale: a
 * revision that moved on, a symbol the model dropped, a scope the command does
 * not have, evidence that is not a line, a port whose file went missing, a
 * command the file does not cover, a file that covers fewer commands than
 * the manual documents, and a method named for a command that nothing records.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'gen-tmux-usage.mjs')
const committed = join(here, '..', 'site/src/data/tmux-usage')

function run(dir) {
  try {
    return { code: 0, out: execFileSync('node', [script, '--check', '--data', dir], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    return { code: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const dirs = []
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gen-tmux-usage-'))
  cpSync(committed, dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function edit(dir, port, change) {
  const file = join(dir, `${port}.json`)
  const document = JSON.parse(readFileSync(file, 'utf8'))
  change(document)
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`)
}

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log(`ok   ${name}`)
  else { console.error(`FAIL ${name} - ${detail}`); failures += 1 }
}
const first = (document) => Object.entries(document.symbols)[0]

const control = run(fixture())
check('the committed data passes', control.code === 0, control.out)

const moved = fixture()
edit(moved, 'py', (document) => { document.revision = '0'.repeat(40) })
const movedRun = run(moved)
check('a revision that moved on fails', movedRun.code !== 0 && /py: records 0{40}/.test(movedRun.out), movedRun.out)

const dropped = fixture()
edit(dropped, 'go', (document) => { document.symbols['tmux.Server.NoSuchMethod'] = first(document)[1] })
const droppedRun = run(dropped)
check('a symbol the model lacks fails', droppedRun.code !== 0 && /go: tmux.Server.NoSuchMethod: not a symbol of the API model/.test(droppedRun.out), droppedRun.out)

const scoped = fixture()
edit(scoped, 'csharp', (document) => { first(document)[1][0].scope = 'pane' })
const scopedRun = run(scoped)
check('a scope the command lacks fails', scopedRun.code !== 0 && /pane is not a scope of [a-z-]+/.test(scopedRun.out), scopedRun.out)

const evidence = fixture()
edit(evidence, 'swift', (document) => { first(document)[1][0].evidence = ['Sources/LibTmux/Server.swift'] })
const evidenceRun = run(evidence)
check('evidence that is not a line fails', evidenceRun.code !== 0 && /swift: .*evidence must be file:line/.test(evidenceRun.out), evidenceRun.out)

const missing = fixture()
rmSync(join(missing, 'rs.json'))
const missingRun = run(missing)
check('a port without a file fails', missingRun.code !== 0 && /rs: no /.test(missingRun.out), missingRun.out)

const unrecorded = fixture()
edit(unrecorded, 'ruby', (document) => { first(document)[1][0].command = 'no-such-command' })
const unrecordedRun = run(unrecorded)
check('a command the file does not cover fails', unrecordedRun.code !== 0 && /no-such-command is not a recorded command/.test(unrecordedRun.out), unrecordedRun.out)

const narrow = fixture()
edit(narrow, 'lua', (document) => { document.commands = ['list-panes'] })
const narrowRun = run(narrow)
check('a file that records fewer commands than the manual fails', narrowRun.code !== 0 && /lua: covers \["list-panes"\], expected \["attach-session"/.test(narrowRun.out), narrowRun.out)

const missed = fixture()
edit(missed, 'py', (document) => { delete document.symbols['libtmux.Pane.send_keys'] })
const missedRun = run(missed)
check('a method named for a command that nothing records fails', missedRun.code !== 0 && /py: \d+ methods named for a command have no entry for it and no review: .*Pane\.send_keys \(send-keys\)/.test(missedRun.out), missedRun.out)

const covered = fixture()
edit(covered, 'ruby', (document) => { delete document.symbols['LibTmux::Pane#send_keys'] })
const coveredRun = run(covered)
check('the same miss fails in another port, and the other ports stay quiet', coveredRun.code !== 0 && /ruby: .*send_keys/.test(coveredRun.out) && !/py: .*methods named/.test(coveredRun.out), coveredRun.out)

for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
if (failures) process.exit(1)
