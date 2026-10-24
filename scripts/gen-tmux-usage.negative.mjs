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
 *
 * With the sources checked out it also replays, for each way a literal can reach a line
 * without being sent, an entry that an earlier generation recorded: a comparison, a row
 * or format selector, a label in a thrown error, a choice made by a condition or by the
 * class of a receiver, a helper that never dispatches, a generic runner that an allowlist
 * admits, and a literal cited where only its builder was.
 * Each is refused by the audit that reads the cited line, and the entry beside it that
 * does send is accepted.
 *
 * It then seeds the reviewed rules (`--rules`): a dispatcher whose cited chain stops short of
 * a transport, names a line that does not hold its text, skips a function, or has no chain at
 * all; a hop that calls a field the scan cannot type and does not say what it holds, one that
 * leads on and does not say why, one that goes to the overload the call's arguments do not fit;
 * a label that names a parameter nothing takes, or is dropped, so that a literal the call
 * only reports a failure under is read as the command; a guard that builds no if-shell, a
 * conditional guard or claim that does not say when, a condition that qualifies no entry, and a
 * guard dropped, so that the if-shell it wrapped is recorded in place of the command; a preflight whose line does
 * not hold its text or that gives no reason; and for a
 * generic function, a send some methods make with no condition that says so, a receiver
 * condition that cites a signature in place of the bodies, and one on a send every method makes.
 * Each is refused, and the committed rules beside them are accepted.
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

const rules = join(here, 'tmux-usage')

/** The same check, for the ports named, reading another copy of the reviewed rules. */
function runRules(dir, ruleDir, ports) {
  try {
    return { code: 0, out: execFileSync('node', [script, '--check', '--source', '--ports', ports, '--data', dir, '--rules', ruleDir], { encoding: 'utf8', stdio: 'pipe' }) }
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
check('a private helper recorded as API fails', privateRun.code !== 0 && /py: libtmux.Server._show_option: is private or package-private, and only public API is recorded/.test(privateRun.out), privateRun.out)

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
    document.symbols['LibTmux.FSharp.Pane.capture'].find((candidate) => candidate.command === 'capture-pane').via.evidence[0] = 'src/LibTmux/Pane.Capture.cs:22'
  })
  const scannedRun = runSource(scanned, 'fsharp')
  check('a scanned core line that names the command in a failure and does not send it fails', scannedRun.code !== 0 && /src\/LibTmux\/Pane.Capture.cs:22 is not a call that sends capture-pane/.test(scannedRun.out), scannedRun.out)
} else console.log('skip core lines read at the revision cited: no checkout of the .NET repository')

// A recorded entry is a call that sends, so a line that only spells the command fails whatever kind of line it is. Each case seeds, into
// a port's committed document, the entry an earlier generation recorded from such a line, and expects the audit of that port to name it.
const CHECKOUTS = {
  py: '~/work/python/libtmux', java: '~/work/libtmux/libtmux-java', ts: '~/work/libtmux/libtmux-ts', swift: '~/work/libtmux/libtmux-swift',
  ruby: '~/work/libtmux/libtmux-ruby', rs: '~/work/libtmux/libtmux-rs', julia: '~/work/libtmux/libtmux-julia', go: '~/work/libtmux/libtmux-go',
  fsharp: '~/work/libtmux/libtmux-dotnet', elixir: '~/work/libtmux/libtmux-elixir',
}
const checkoutOf = (port) => (process.env[`LIBTMUX_DOCS_CHECKOUT_${port.toUpperCase()}`] ?? CHECKOUTS[port]).replace(/^~/, homedir())
const SENDS_NOTHING = [
  ['a format selector', 'py', 'libtmux.Server.new_session', 'list-sessions', ['src/libtmux/server.py:2341'], /py: libtmux.Server.new_session list-sessions: src\/libtmux\/server.py:2341 is not a call that sends list-sessions \(it is an argument of get_output_format/],
  ['a comparison', 'java', 'io.github.libtmux.Prompt.Prompt.clear', 'show-prompt-history', ['libtmux/src/main/java/io/github/libtmux/Prompt.java:49', 'libtmux/src/main/java/io/github/libtmux/Prompt.java:44'], /java: io.github.libtmux.Prompt.Prompt.clear show-prompt-history: libtmux\/src\/main\/java\/io\/github\/libtmux\/Prompt.java:49 is not a call that sends show-prompt-history/],
  ['a label in a thrown error', 'ts', 'server.Server.validateLayouts', 'display-message', ['packages/libtmux/src/_internal/operations/layout.ts:42', 'packages/libtmux/src/server.ts:955'], /ts: server.Server.validateLayouts display-message: packages\/libtmux\/src\/_internal\/operations\/layout.ts:42 is not a call that sends display-message/],
  ['a ternary between two commands', 'swift', 'Server.link(_:into:)', 'move-window', ['Sources/LibTmux/WindowTransfers.swift:75', 'Sources/LibTmux/WindowTransfers.swift:20'], /swift: Server.link\(_:into:\) move-window: Sources\/LibTmux\/WindowTransfers.swift:75 is not a call that sends move-window \(a condition chooses it/],
  ['the class of a receiver choosing the command', 'ruby', 'LibTmux::Hooks#unset', 'set-option', ['gems/libtmux/lib/libtmux/options.rb:107'], /ruby: LibTmux::Hooks#unset set-option: gems\/libtmux\/lib\/libtmux\/options.rb:107 is not a call that sends set-option \(a condition chooses it/],
  ['a helper that never dispatches', 'java', 'io.github.libtmux.batch.Batch.Batch.length', 'display-message', ['libtmux/src/main/java/io/github/libtmux/batch/Batch.java:94', 'libtmux/src/main/java/io/github/libtmux/batch/Batch.java:72'], /java: io.github.libtmux.batch.Batch.Batch.length display-message: libtmux\/src\/main\/java\/io\/github\/libtmux\/batch\/Batch.java:94 is not a call that sends display-message/],
  ['a generic runner that an allowlist admits', 'julia', 'LibTmux.run_command', 'kill-pane', ['src/control_protocol.jl:427', 'src/control.jl:580'], /julia: LibTmux.run_command kill-pane: src\/control_protocol.jl:427 is not a call that sends kill-pane/],
  ['the line that builds the command, where the call that sends is further down', 'rs', 'server.Server.command_prompt', 'command-prompt', ['crates/libtmux/src/server/interactive.rs:105'], /rs: server.Server.command_prompt command-prompt: crates\/libtmux\/src\/server\/interactive.rs:105 is not a call that sends command-prompt/],
  ['the literal of a builder, with the hop to a method of another type that shares its name', 'rs', 'pane.Pane.split', 'capture-pane', ['crates/libtmux/src/pane.rs:1618', 'crates/libtmux/src/pane.rs:515'], /rs: pane.Pane.split capture-pane: crates\/libtmux\/src\/pane.rs:1618 is not a call that sends capture-pane \(it builds a value for the caller\)/],
  ['a command spelled in a request that is only built, where the call that sends is in the control lane', 'elixir', 'LibTmux.Control.Request.field/2', 'display-message', ['lib/libtmux/control/request.ex:51'], /elixir: LibTmux.Control.Request.field\/2 display-message: lib\/libtmux\/control\/request.ex:51 is not a call that sends display-message \(it reaches no call that sends\)/],
]
const sourced = new Map()
for (const [name, port, symbol, command, lines, message] of SENDS_NOTHING) {
  if (!existsSync(join(checkoutOf(port), '.git'))) { console.log(`skip ${name}: no checkout of ${port}`); continue }
  if (!sourced.has(port)) {
    const control = runSource(fixture(), port)
    sourced.set(port, control.code === 0)
    check(`the committed ${port} entries read as cited`, control.code === 0, control.out)
  }
  const seeded = fixture()
  edit(seeded, port, (document) => { document.symbols[symbol] = [...(document.symbols[symbol] ?? []), { command, scope: null, evidence: lines }] })
  const seededRun = runSource(seeded, port)
  check(`an entry cited at ${name} fails`, seededRun.code !== 0 && message.test(seededRun.out), seededRun.out)
}

// The reviewed rules are held to the pinned source as the usage data is. Each case changes one rule in a copy of them and expects the
// check of that port to name it, and the committed rules in the copy's place to pass.
function ruleFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gen-tmux-rules-'))
  cpSync(rules, dir, { recursive: true })
  dirs.push(dir)
  return dir
}
function editRules(dir, name, change) {
  const file = join(dir, name)
  const document = JSON.parse(readFileSync(file, 'utf8'))
  change(document)
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`)
}
const dispatcher = (document, port, name) => document.dispatchers.find((rule) => rule.port === port && rule.name === name)
const BAD_RULES = [
  ['a dispatcher whose chain was removed', 'rs', 'dispatchers.json', (document) => { delete dispatcher(document, 'rs', 'chain').evidence[0].reaches },
    /rs: dispatcher chain at crates\/libtmux\/src\/server.rs:753: reaches no transport, and cites no chain to one/],
  ['a dispatcher that shares its name with a function that sends nothing', 'rs', 'dispatchers.json', (document) => { dispatcher(document, 'rs', 'list').evidence.push({ at: 'crates/libtmux/src/plan/wire.rs:149', has: ['list'] }) },
    /rs: dispatcher list at crates\/libtmux\/src\/plan\/wire.rs:149: reaches no transport, and cites no chain to one/],
  ['a chain hop whose line does not hold its text', 'rs', 'dispatchers.json', (document) => { dispatcher(document, 'rs', 'send').evidence[0].reaches[0].has = ['.sendx('] },
    /rs: dispatcher send at crates\/libtmux\/src\/control.rs:585: hop crates\/libtmux\/src\/control.rs:586 does not contain "\.sendx\("/],
  ['a chain that skips the function between two hops', 'rs', 'dispatchers.json', (document) => { dispatcher(document, 'rs', 'dispatch').evidence[0].reaches.splice(1, 1) },
    /rs: dispatcher dispatch at crates\/libtmux\/src\/plan\/run.rs:443: hop crates\/libtmux\/src\/plan\/run.rs:461 leads to cmd, but crates\/libtmux\/src\/internal\/core.rs:438 is not a line of it/],
  ['a chain hop on a field whose type it does not say', 'rs', 'dispatchers.json', (document) => { delete dispatcher(document, 'rs', 'send').evidence[0].reaches[0].on },
    /rs: dispatcher send at crates\/libtmux\/src\/control.rs:585: hop crates\/libtmux\/src\/control.rs:586 is a call of sender\.send\(\), which resolves to no function the scan has read, and not to ControlSender\.send/],
  ['a chain hop that leads somewhere and does not say why', 'rs', 'dispatchers.json', (document) => { delete dispatcher(document, 'rs', 'send').evidence[0].reaches.find((hop) => hop.leads).why },
    /rs: dispatcher send at crates\/libtmux\/src\/control.rs:585: hop crates\/libtmux\/src\/control.rs:803 leads to serve and says nothing about why the scan cannot follow it/],
  ['a chain that goes to the overload the arguments of the call do not fit', 'java', 'dispatchers.json', (document) => {
    const run = dispatcher(document, 'java', 'run').evidence.find((item) => item.at.endsWith('Server.java:1221'))
    run.reaches = [run.reaches[0], { ...run.reaches.find((hop) => hop.at.endsWith('Server.java:1251')), at: run.reaches[0].at.replace(':1222', ':1230'), has: ['fence.guarded(snapshot'] }]
  }, /java: dispatcher run at .*Server\.java:1221: hop .*Server\.java:1222 is a call of cmd\(1\), which resolves to Server\.cmd at .*Server\.java:765 and Server\.cmd at .*Server\.java:771, and not to Server\.cmd at .*Server\.java:1229/],
  ['a julia send some methods make, with no condition that says so', 'julia', 'conditions.json', (document) => { document.conditions = document.conditions.filter((item) => !(item.symbol === 'LibTmux.capture_bytes' && item.command === 'list-buffers')) },
    /julia: LibTmux\.capture_bytes list-buffers null: only the ControlConnection methods send it, and 1 other method such as src\/pane_io\.jl:64 do not, so it needs a condition that says when/],
  ['a julia receiver condition that cites a signature in place of the bodies', 'julia', 'conditions.json', (document) => {
    for (const item of document.conditions) if (item.symbol === 'LibTmux.get_environment') for (const line of item.evidence) delete line.through
  }, /julia: LibTmux\.get_environment show-environment null: condition cites the body of no method that sends it/],
  ['a julia receiver condition on a send that every method makes', 'julia', 'conditions.json', (document) => {
    document.conditions.push({ port: 'julia', symbol: 'LibTmux.select_pane', command: 'select-pane', scope: null, when: 'on a Server', receiver: 'Server', evidence: [{ at: 'src/operations.jl:372', through: 375, has: ['function select_pane('] }] })
  }, /julia: LibTmux\.select_pane select-pane null: condition says on a Server, but no method of the function is shown not to send it/],
  ['a label that names a parameter nothing takes', 'rs', 'dispatchers.json', (document) => { dispatcher(document, 'rs', 'mutate').labels[0].name = 'nope' },
    /rs: dispatcher mutate: no cited definition takes a parameter named nope/],
  ['a label dropped, so a literal that only reports a failure is read as the command', 'rs', 'dispatchers.json', (document) => { delete dispatcher(document, 'rs', 'mutate').labels },
    /rs: pane.Pane.send_line send-keys: .* is not a call of Pane.send_line/],
  ['a claim marked conditional that does not say when', 'rs', 'claims.json', (document) => {
    const claim = document.claims.find((candidate) => candidate.port === 'rs' && candidate.when)
    delete claim.when
    claim.conditional = true
  }, /rs: plan.Plan.run set-option null: is marked conditional, so it must say when/],
  ['a condition that qualifies no entry', 'fsharp', 'conditions.json', (document) => { document.conditions.find((item) => item.port === 'fsharp').command = 'no-such-command' },
    /fsharp: LibTmux.FSharp.Server.newSession no-such-command session: condition qualifies no entry/],
  ['an exclusion that removes the entry of a claim for the same send', 'go', 'exclusions.json', (document) => {
    document.exclusions.push({ port: 'go', owner: 'Server', names: ['NewSession'], commands: ['list-sessions'], why: 'NewSession lists sessions to look up a name only when the request carries one.',
      evidence: [{ at: 'tmux/session_lifecycle.go:210', has: ['request.Name != ""'] }, { at: 'tmux/session_lifecycle.go:217', has: ['sessionNamed('] }] })
  }, /go: exclusion of Server\.NewSession for list-sessions: removes the reviewed claim of tmux\.Server\.NewSession list-sessions null, which says it sends it/],
  ['an elixir dispatcher whose chain skips the function between two hops', 'elixir', 'dispatchers.json', (document) => { dispatcher(document, 'elixir', 'read').evidence[0].reaches.splice(3, 1) },
    /elixir: dispatcher read at lib\/libtmux\/capture.ex:307: hop lib\/libtmux\/transport\/oneshot.ex:86 leads to run_worker, but lib\/libtmux\/transport\/oneshot.ex:172 is not a line of it/],
  ['an elixir dispatcher whose chain stops before the port is written to', 'elixir', 'dispatchers.json', (document) => { dispatcher(document, 'elixir', 'rows').evidence[0].reaches.pop() },
    /elixir: dispatcher rows at lib\/libtmux\/capture.ex:193: hop lib\/libtmux\/transport\/oneshot.ex:172 is not a transport/],
  ['an elixir claim whose line does not hold its text', 'elixir', 'claims.json', (document) => {
    document.claims.find((claim) => claim.port === 'elixir' && claim.symbol === 'LibTmux.Capture.fetch/2' && claim.command === 'list-sessions').evidence[0].has = ['list(state, "list-panes"']
  }, /elixir: LibTmux.Capture.fetch\/2 list-sessions null: lib\/libtmux\/capture.ex:158 does not contain "list\(state, \\"list-panes\\""/],
  ['an elixir claim whose message hop to the connection manager does not hold its text', 'elixir', 'claims.json', (document) => {
    document.claims.find((claim) => claim.port === 'elixir' && claim.symbol === 'LibTmux.Control.reconnect/2' && claim.command === 'attach-session').evidence.find((item) => item.at.endsWith('manager.ex:573')).has = ['stop(state, ticket)']
  }, /elixir: LibTmux.Control.reconnect\/2 attach-session null: lib\/libtmux\/control\/manager.ex:573 does not contain "stop\(state, ticket\)"/],
  ['an elixir claim that is not anchored in the symbol it names', 'elixir', 'claims.json', (document) => {
    document.claims.find((claim) => claim.port === 'elixir' && claim.symbol === 'LibTmux.Server.snapshot/2' && claim.command === 'list-clients').evidence.at(-1).at = 'lib/libtmux/server.ex:60'
  }, /elixir: LibTmux.Server.snapshot\/2 list-clients null: lib\/libtmux\/server.ex:60 (?:does not contain|is outside the body of)/],
  ['a preflight whose line does not hold its text', 'go', 'preflights.json', (document) => { document.preflights[0].evidence[1].has = ['s.checkNothing('] },
    /go: preflight run-shell: tmux\/transport.go:106 does not contain "s.checkNothing\("/],
  ['a preflight that gives no reason', 'go', 'preflights.json', (document) => { delete document.preflights[0].why },
    /go: preflight run-shell: names no command or gives no reason/],
  ['a conditional guard that does not say when', 'go', 'guards.json', (document) => { delete document.guards.find((guard) => guard.port === 'go' && guard.name === 'guardCommand').when },
    /go: guard guardCommand: is conditional, so it must say when/],
  ['a guard whose function builds no if-shell', 'java', 'guards.json', (document) => {
    document.guards.push({ port: 'java', name: 'run', owner: 'Server', purpose: 'refuses a stale target', evidence: [{ at: 'libtmux/src/main/java/io/github/libtmux/Server.java:1221', has: ['run'] }] })
  }, /java: guard Server.run: no function of that name builds an if-shell/],
  ['a guard dropped, so the if-shell it wraps is recorded in place of the command', 'java', 'guards.json', (document) => { document.guards = document.guards.filter((guard) => !(guard.port === 'java' && guard.name === 'killOwnedServer')) },
    /java: io.github.libtmux.junit5.NamedServerFixture.NamedServerFixture.close kill-server: .* is not a call that sends kill-server/],
]
const ruled = new Set()
for (const [name, port, file, change, message] of BAD_RULES) {
  if (!existsSync(join(checkoutOf(port), '.git'))) { console.log(`skip ${name}: no checkout of ${port}`); continue }
  if (!ruled.has(port)) {
    ruled.add(port)
    const control = runRules(fixture(), ruleFixture(), port)
    check(`the committed ${port} rules, read from a copy, pass`, control.code === 0, control.out)
  }
  const seeded = ruleFixture()
  editRules(seeded, file, change)
  const seededRun = runRules(fixture(), seeded, port)
  check(`${name} fails`, seededRun.code !== 0 && message.test(seededRun.out), seededRun.out)
}

// A qualifier is a short phrase beside a method, so the data that carries one longer than that fails without a checkout.
const wordy = fixture()
edit(wordy, 'ts', (document) => { Object.values(document.symbols).flat().find((use) => use.when).when = 'one two three four five six seven eight nine' })
const wordyRun = run(wordy)
check('a qualifier of more than eight words fails', wordyRun.code !== 0 && /ts: .* says when in 9 words, and a qualifier is at most 8/.test(wordyRun.out), wordyRun.out)

for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
if (failures) process.exit(1)
