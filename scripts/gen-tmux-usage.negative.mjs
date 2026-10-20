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
 * the manual documents, a method named for a command that nothing records, a
 * private helper recorded as API, a wrapper that cites its core library's lines
 * at a revision other than the one they must be read at, and (with the sources
 * checked out) core lines that read as something else at the revision cited.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
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

/** The same check with the sources read, for the ports named. */
function runSource(dir, ports) {
  try {
    return { code: 0, out: execFileSync('node', [script, '--check', '--source', '--ports', ports, '--data', dir], { encoding: 'utf8', stdio: 'pipe' }) }
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

const privateHelper = fixture()
edit(privateHelper, 'py', (document) => { document.symbols['libtmux.Server._show_option'] = first(document)[1] })
const privateRun = run(privateHelper)
check('a private helper recorded as API fails', privateRun.code !== 0 && /py: libtmux.Server._show_option: is private, and only public API is recorded/.test(privateRun.out), privateRun.out)

const viaMoved = fixture()
edit(viaMoved, 'fsharp', (document) => {
  const via = Object.values(document.symbols).flat().find((use) => use.via).via
  via.revision = JSON.parse(readFileSync(join(committed, '..', 'api', 'csharp.json'), 'utf8')).revision
})
const viaMovedRun = run(viaMoved)
check('core lines cited at the core model\'s revision instead of the wrapper\'s fail', viaMovedRun.code !== 0 && /fsharp: .* cites csharp lines at 5b486ea9\w+, which must be 4f1b997b2\w+/.test(viaMovedRun.out), viaMovedRun.out)

const viaUnnamed = fixture()
edit(viaUnnamed, 'powershell', (document) => { delete Object.values(document.symbols).flat().find((use) => use.via).via.revision })
const viaUnnamedRun = run(viaUnnamed)
check('a via that names no revision fails', viaUnnamedRun.code !== 0 && /powershell: .* at no revision/.test(viaUnnamedRun.out), viaUnnamedRun.out)

// Reading the sources needs the checkout the wrapper is pinned in; without it the check skips regeneration and there is nothing to refuse.
if (existsSync(join(process.env.LIBTMUX_DOCS_CHECKOUT_FSHARP ?? join(homedir(), 'work/libtmux/libtmux-dotnet'), '.git'))) {
  const control = runSource(fixture(), 'fsharp')
  check('the committed F# entries read as cited at the F# revision', control.code === 0, control.out)
  // The first line the F# new-session entry cited before the C# core was read where F# is pinned.
  const reviewed = fixture()
  edit(reviewed, 'fsharp', (document) => {
    document.symbols['LibTmux.FSharp.Server.newSession'].find((candidate) => candidate.command === 'new-session').via.evidence[0] = 'src/LibTmux/Server.Lifecycle.cs:368'
  })
  const reviewedRun = runSource(reviewed, 'fsharp')
  check('a reviewed core line that is not the one its claim cites fails', reviewedRun.code !== 0 && /Server.Lifecycle.cs:368 where its claim cites src\/LibTmux\/Server.Lifecycle.cs:269/.test(reviewedRun.out), reviewedRun.out)
  const scanned = fixture()
  edit(scanned, 'fsharp', (document) => {
    document.symbols['LibTmux.FSharp.Pane.sendKeys'].find((candidate) => candidate.command === 'send-keys').via.evidence[0] = 'src/LibTmux/Pane.Input.cs:8'
  })
  const scannedRun = runSource(scanned, 'fsharp')
  check('a scanned core line that does not spell the command fails', scannedRun.code !== 0 && /src\/LibTmux\/Pane.Input.cs:8 does not spell send-keys/.test(scannedRun.out), scannedRun.out)
} else console.log('skip core lines read at the revision cited: no checkout of the .NET repository')

for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
if (failures) process.exit(1)
