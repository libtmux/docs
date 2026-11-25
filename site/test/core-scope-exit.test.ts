import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { portCapabilities, type CapabilityTable } from '../src/lib/core-capabilities'
import { capabilityExample, playableCapability, viewSteps } from '../src/lib/core-player'
import { recordingProblems, type CoreCapability, type CoreRecording } from '../src/lib/core-recording'
import type { CachedSource } from '../src/lib/port-landing'
import { HOME_VIEWS, QUICKSTARTS, homeProgram } from '../src/lib/quickstarts'
import TABLE from '../src/data/core-capabilities.json'
import SOURCES from '../src/data/example-sources.json'

/**
 * Where the Core home players mark a step that runs when its scope ends: where the scope ends, so the markers read in
 * step order (record 0084). The steps are named by the recordings' `scopeExit` field, never by their labels.
 */
const data = (name: string) => new URL(`../src/data/${name}`, import.meta.url)
const home = JSON.parse(readFileSync(data('home-examples.json'), 'utf8'))
const ports = readdirSync(data('core-recordings')).map((file) => file.replace(/\.json$/, ''))
const recording = (port: string): CoreRecording => JSON.parse(readFileSync(data(`core-recordings/${port}.json`), 'utf8'))
/** The program the home page displays for a port, which its recording is of. */
const program = (port: string): string => home[port].files.find((file: { name: string }) => file.name === home[port].program).code
const problems = (port: string, damage: (capability: CoreCapability) => void = () => {}) => {
  const stored = recording(port)
  damage(stored.capabilities['typed-graph']!)
  return recordingProblems(stored, { programs: { 'typed-graph': program(port) } })
}
const scopeExit = (capability: CoreCapability) => capability.steps.find((step) => step.scopeExit)!

describe('the scope-exit steps of the Core home recordings', () => {
  it('are marked at or below every step before them, in every port', () => {
    expect(ports.flatMap((port) => problems(port).map((problem) => `${port}: ${problem}`))).toEqual([])
  })

  // The check reads this field, so a recording that loses it is no longer checked: the set is the check's input.
  it('are the ones the recordings name, and a port that adds one extends this list', () => {
    expect(ports.flatMap((port) => Object.entries(recording(port).capabilities).flatMap(([id, capability]) => capability.steps.filter((step) => step.scopeExit).map((step) => `${port}/${id}/${step.id}`))))
      .toEqual([
        'csharp/typed-graph/kill', 'erlang/typed-graph/retire', 'go/typed-graph/kill', 'go/run-applications/kill', 'go/watch/kill', 'haskell/typed-graph/retire-server',
        'lisp/typed-graph/stop-daemon', 'ocaml/typed-graph/close', 'ocaml/typed-graph/retire', 'raku/typed-graph/close', 'swift/typed-graph/kill',
      ])
  })

  // Main's anchors: before the markers, each of these steps was marked on the line where its scope opens.
  it.each(['csharp', 'go', 'haskell', 'lisp', 'ocaml', 'raku', 'swift'])('are refused in %s when marked at the call, above the steps that ran before', (port) => {
    expect(problems(port, (capability) => {
      const step = scopeExit(capability)
      delete step.marker
      delete step.markerOccurrence
    }).join('\n')).toMatch(/step \d+ \(.+\): runs when its scope ends but is marked on line \d+, above line \d+, where step \d+ \(.+\) is marked/)
  })

  const faults: [string, (capability: CoreCapability) => void, RegExp][] = [
    ['a marker above an earlier step', (capability) => { scopeExit(capability).marker = 'package main' }, /runs when its scope ends but is marked on line 2, above line \d+/],
    ['a marker that is not in the program', (capability) => { scopeExit(capability).marker = 'return 0' }, /its marker "return 0" is not on exactly one line/],
    ['a marker on a step that does not say it runs when its scope ends', (capability) => { delete scopeExit(capability).scopeExit }, /has a marker but does not say it runs when its scope ends/],
  ]
  it.each(faults)('are refused for %s', (_name, damage, message) => {
    expect(problems('go', damage).join('\n')).toMatch(message)
  })

  it('leave a step that does not say it runs when its scope ends alone, as in the programs whose helpers sit above main', () => {
    expect(problems('go', (capability) => {
      const step = scopeExit(capability)
      delete step.scopeExit
      delete step.marker
    }), 'the Kill step on its defer line is out of order, and is not a scope-exit step').toEqual([])
  })
})

/**
 * One Core player as the page draws it (`components/CoreShowcase.astro`): a recording of one capability, and the
 * views of the program it plays over. The quickstart's capability has every view of the home program; every other
 * capability has the one view of its example program.
 */
interface Player {
  port: string
  id: string
  capability: CoreCapability
  /** The text the recording's hash is of. */
  program: string
  views: [view: string, code: string][]
}

const playersOf = (port: string): Player[] => {
  const quickstart = QUICKSTARTS[port]!.complete!
  const examples = portCapabilities(port, TABLE as CapabilityTable, SOURCES as Record<string, CachedSource>)
  return Object.entries(recording(port).capabilities).map(([id, capability]) => {
    if (id === (quickstart.capability ?? 'typed-graph')) return { port, id, capability, program: homeProgram(quickstart, 'full'), views: HOME_VIEWS.map((view) => [view, homeProgram(quickstart, view)]) }
    const item = examples.find((example) => example.id === id)!
    return { port, id, capability, program: item.source, views: [['concise', homeProgram(capabilityExample({ ...item, repository: '', revision: '' }), 'concise')]] }
  })
}
const players = () => ports.flatMap(playersOf)

/**
 * Steps that read out of order because their program defines helpers above the code that calls them: the player marks
 * each call on its own line, and the calls run in the other order. Keyed `recording/capability/step`, each with the
 * reason it cannot be marked in order. Nothing else may read out of order, and an entry that reads in order is refused.
 */
const OCAML_HELPER = '`capture_graph` is defined above `with_demo`, which calls it after its own first steps'
const RUST_TYPED_GRAPH = '`work` is defined above `main`, which builds the server first and then calls it'
const RUST_SEND_KEYS = '`demonstrate` is defined above `main`, which builds the server first and then calls it'
const HELPER_ORDER: Record<string, string> = {
  'ocaml/typed-graph/create-session': OCAML_HELPER,
  'ocaml/typed-graph/capture-linked': OCAML_HELPER,
  'ocaml/typed-graph/wait-linked': OCAML_HELPER,
  'ocaml/typed-graph/link-window': OCAML_HELPER,
  'ocaml/typed-graph/capture-graph': OCAML_HELPER,
  'rs/typed-graph/new-session': RUST_TYPED_GRAPH,
  'rs/typed-graph/active-window': RUST_TYPED_GRAPH,
  'rs/typed-graph/rename': RUST_TYPED_GRAPH,
  'rs/typed-graph/active-pane': RUST_TYPED_GRAPH,
  'rs/typed-graph/split': RUST_TYPED_GRAPH,
  'rs/typed-graph/new-window': RUST_TYPED_GRAPH,
  'rs/typed-graph/send-line': RUST_TYPED_GRAPH,
  'rs/typed-graph/wait-for-text': RUST_TYPED_GRAPH,
  'rs/typed-graph/select-pane': RUST_TYPED_GRAPH,
  'rs/typed-graph/select-window': RUST_TYPED_GRAPH,
  'rs/typed-graph/sessions': RUST_TYPED_GRAPH,
  'rs/typed-graph/windows-1': RUST_TYPED_GRAPH,
  'rs/typed-graph/panes-1': RUST_TYPED_GRAPH,
  'rs/typed-graph/panes-2': RUST_TYPED_GRAPH,
  'rs/typed-graph/pane-window': RUST_TYPED_GRAPH,
  'rs/typed-graph/window-session': RUST_TYPED_GRAPH,
  'rs/send-keys/new-session': RUST_SEND_KEYS,
  'rs/send-keys/panes': RUST_SEND_KEYS,
  'rs/send-keys/wait-for-text': RUST_SEND_KEYS,
  'rs/send-keys/send-keys': RUST_SEND_KEYS,
  'rs/send-keys/send-key-names': RUST_SEND_KEYS,
  'rs/send-keys/capture-1': RUST_SEND_KEYS,
}

/**
 * The steps whose marker is above an earlier step's, in the views of each player. A view plays the steps whose call it
 * holds (`viewSteps`, which places a step by its marker as the page does), so only the steps a reader sees are compared.
 */
function readOutOfOrder(all: Player[]): Map<string, { problem: string; views: string[] }> {
  const found = new Map<string, { problem: string; views: string[] }>()
  for (const { port, id, capability, views } of all) {
    for (const [view, code] of views) {
      let furthest = { line: 0, step: '' }
      for (const { index, lines } of viewSteps(capability, code.replace(/\n$/, ''), port)) {
        const step = capability.steps[index]!
        const named = `step ${index + 1} (${step.label})`
        if (lines[0] < furthest.line) {
          const key = `${port}/${id}/${step.id}`
          const seen = found.get(key) ?? { problem: `${named} is marked on line ${lines[0]}, above line ${furthest.line}, where ${furthest.step} is marked`, views: [] }
          found.set(key, { ...seen, views: [...seen.views, view] })
        } else furthest = { line: lines[0], step: named }
      }
    }
  }
  return found
}

/** What is wrong with the order of the markers of `all`, given the steps allowed to read out of order. */
function orderProblems(all: Player[], allowed: Record<string, string> = HELPER_ORDER): string[] {
  const found = readOutOfOrder(all)
  return [
    ...[...found].filter(([key]) => !(key in allowed)).map(([key, { problem, views }]) => `${key}: ${problem}, in the ${views.join(', ')} view`),
    ...Object.keys(allowed).filter((key) => !found.has(key)).map((key) => `${key}: is allowed to read out of order but reads in order; remove it`),
  ]
}

describe('the order of the markers in every Core player', () => {
  it('has a player for every recording, which plays steps in every view it draws', async () => {
    for (const { port, id, program, views, capability } of players()) {
      expect(await playableCapability(port, id, program), `${port}/${id}`).toBeDefined()
      for (const [view, code] of views) expect(viewSteps(capability, code.replace(/\n$/, ''), port).length, `${port}/${id} ${view}`).toBeGreaterThan(0)
    }
    expect(playersOf('go').map((player) => [player.id, player.views.map(([view]) => view)])).toEqual([
      ['typed-graph', ['concise', 'errors', 'cleanup', 'full']], ['run-applications', ['concise']], ['watch', ['concise']],
    ])
  })

  it('reads in step order in every view, except the steps whose program defines helpers above the code that calls them', () => {
    expect(orderProblems(players())).toEqual([])
  })

  // Main's anchors for the two Go capabilities whose deferred Session.Kill was marked on its defer, above the steps before it.
  it('refuses a deferred Session.Kill marked on its defer, as main had it in Go\'s run-applications and watch', () => {
    const all = players()
    for (const player of all.filter((each) => each.port === 'go' && each.id !== 'typed-graph')) {
      const kill = player.capability.steps.find((step) => step.id === 'kill')!
      delete kill.scopeExit
      delete kill.marker
    }
    expect(orderProblems(all)).toEqual([
      expect.stringMatching(/^go\/run-applications\/kill: step 6 \(Session\.Kill\) is marked on line 48, above line 75, where step 5 \(Running\.StreamTo\) is marked, in the concise view$/),
      expect.stringMatching(/^go\/watch\/kill: step 11 \(Session\.Kill\) is marked on line 48, above line 85, where step 10 \(NotificationStream\.Next\) is marked, in the concise view$/),
    ])
  })

  it('refuses an allowlist entry removed, naming the step', () => {
    for (const key of Object.keys(HELPER_ORDER)) {
      const { [key]: _removed, ...rest } = HELPER_ORDER
      expect(orderProblems(players(), rest), key).toEqual([expect.stringMatching(new RegExp(`^${key}: step \\d+ .* is marked on line \\d+, above line \\d+`))])
    }
  })

  it('refuses a step that is not on the allowlist and reads out of order, and an entry that reads in order', () => {
    const all = players()
    const steps = all.find((player) => player.port === 'py' && player.id === 'typed-graph')!.capability.steps
    ;[steps[1], steps[2]] = [steps[2]!, steps[1]!]
    expect(orderProblems(all)).toEqual([expect.stringMatching(new RegExp(`^py/typed-graph/${steps[2]!.id}: step 3 .* is marked on line \\d+, above line \\d+, where step 2 .* is marked, in the concise, errors, cleanup, full view$`))])
    expect(orderProblems(players(), { ...HELPER_ORDER, 'go/typed-graph/split': 'a step in order' })).toEqual(['go/typed-graph/split: is allowed to read out of order but reads in order; remove it'])
  })

  it('reads every view, not only the default: a marker above an earlier step in the Cleanup view alone is refused', () => {
    const go = playersOf('go').find((player) => player.id === 'typed-graph')!
    const code = (view: string) => go.views.find(([name]) => name === view)![1]
    // The scope's last line moves to the top of the program in this one view.
    const early = code('cleanup').replace('\treturn nil\n', '').replace('package main\n', 'package main\n\treturn nil\n')
    const broken = { ...go, views: [['concise', code('concise')], ['cleanup', early]] as [string, string][] }
    expect(orderProblems([broken], {})).toEqual([expect.stringMatching(/^go\/typed-graph\/kill: step 16 \(Server\.Kill\) is marked on line 3, above line \d+, where step 15 .* is marked, in the cleanup view$/)])
  })
})
