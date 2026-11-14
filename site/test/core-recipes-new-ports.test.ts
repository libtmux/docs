import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { describe, expect, it } from 'vitest'
import { RECIPES as LISP, lispHelper, withoutMarks as withoutLispMarks } from '../../scripts/lib/core-recipes/lisp.mjs'
import { RECIPES as ERLANG, withoutMarks as withoutErlangMarks } from '../../scripts/lib/core-recipes/erlang.mjs'
import { RECIPES as PERL, withoutMarks as withoutPerlMarks } from '../../scripts/lib/core-recipes/perl.mjs'
import { RECIPES as OCAML, ocamlHelper, withoutMarks as withoutOcamlMarks } from '../../scripts/lib/core-recipes/ocaml.mjs'
import { RECIPES as HASKELL, withoutMarks as withoutHaskellMarks } from '../../scripts/lib/core-recipes/haskell.mjs'
import { RECIPES as CLOJURE, clojureHelper, withoutMarks as withoutClojureMarks } from '../../scripts/lib/core-recipes/clojure.mjs'
import { RECIPES as RAKU, withoutMarks as withoutRakuMarks } from '../../scripts/lib/core-recipes/raku.mjs'
import * as corePlayer from '../src/lib/core-player'
import { playableCapability, tmuxChanges, viewSteps } from '../src/lib/core-player'
import { recordingProblems, sha256, type CoreRecording } from '../src/lib/core-recording'
import { statementLines, syntaxOf } from '../src/lib/core-statement'
import { HOME_VIEWS, QUICKSTARTS, homeProgram } from '../src/lib/quickstarts'
import home from '../src/data/home-examples.json'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

/** The ports whose landing program the player plays that this file covers. */
type NewPort = 'lisp' | 'perl' | 'erlang' | 'ocaml' | 'haskell' | 'clojure' | 'raku'

const recording = (port: string): CoreRecording => JSON.parse(readFileSync(new URL(`../src/data/core-recordings/${port}.json`, import.meta.url), 'utf8'))
const capabilityOf = (port: string) => recording(port).capabilities['typed-graph']!
const shown = (port: string) => homeProgram(QUICKSTARTS[port]!.complete!, 'full')
/** Which of several lines holding an anchor a step means, when its recipe says. */
const occurrenceOf = (step: object) => (step as { occurrence?: number }).occurrence
/** The Code block of the page, as text, so a template renders without Expressive Code. */
const Code = createComponent((_result: unknown, props: { code: string }) => renderTemplate`<pre data-code>${props.code}</pre>`)

/** What every recording of a landing program must hold: it is of the displayed program, at the revision the page records, and plays in each view. */
function expectPlayable(port: NewPort) {
  const entry = home[port]
  const stored = recording(port)
  expect(recordingProblems(stored, { programs: { 'typed-graph': shown(port) } })).toEqual([])
  expect(stored.revision).toBe(entry.sourceRevision)
  expect(stored.repo).toBe(entry.sourceRepository)
  expect(capabilityOf(port).program.sha256).toBe(sha256(shown(port)))
  expect(capabilityOf(port).printed.join('\n') + '\n').toBe(entry.expectedOutput)
  expect(capabilityOf(port).stepMap).toBe('hand-written')
  expect(JSON.stringify(stored), 'a recording names no path of the machine that made it').not.toMatch(/\/home\/|tmp-wave|libtmux-docs-/)
}

/**
 * The calls of a recording in every view of the program the page shows, each on the line its anchor names. A view
 * plays a call only if the view holds it; `absent` is what a view may leave out (a program's cleanup).
 */
function expectPlayedInEveryView(port: NewPort, absent: Record<string, string[]> = {}) {
  const capability = capabilityOf(port)
  for (const view of HOME_VIEWS) {
    const code = homeProgram(QUICKSTARTS[port]!.complete!, view).replace(/\n$/, '')
    const placed = viewSteps(capability, code, port)
    expect(placed.map((each) => capability.steps[each.index]!.id), view).toEqual(capability.steps.map((each) => each.id).filter((id) => !(absent[view] ?? []).includes(id)))
    for (const { index, lines } of placed) expect(code.split('\n')[lines[0] - 1], `${view} ${capability.steps[index]!.id}`).toContain(capability.steps[index]!.anchor)
  }
}

/** The programs the page shows for a port, in every view: the recording plays a call only in a view that holds it. */
const views = (port: NewPort) => [shown(port), ...Object.values((home[port] as { variants?: Record<string, string> }).variants ?? {})]

describe('Common Lisp recipe', () => {
  const recipe = LISP['typed-graph']
  const code = home.lisp.files[0]!.code
  const marked = recipe.instrument(code, recipe.steps)

  it('adds one line to the displayed program, which loads the helper after the library', () => {
    expect(withoutLispMarks(marked)).toBe(code)
    const lines = marked.split('\n')
    const at = lines.findIndex((line: string) => line.endsWith('docs:mark'))
    expect(lines.filter((line: string) => line.endsWith('docs:mark'))).toHaveLength(1)
    expect(lines[at - 1]).toBe('(asdf:load-system "libtmux")')
  })

  it('finds every call on exactly one line of every view of the program', () => {
    for (const view of views('lisp')) {
      for (const step of recipe.steps) {
        expect(statementLines(view, step.anchor, syntaxOf('lisp'), occurrenceOf(step)), step.id).toBeDefined()
      }
    }
  })

  it('refuses an anchor the program does not hold, and a program that never loads the library', () => {
    expect(() => recipe.instrument(code, [{ id: 'x', anchor: '(libtmux:nope', call: 'libtmux:nope', value: 'nil' }])).toThrow(/not on exactly one line/)
    expect(() => recipe.instrument(code.replace('(asdf:load-system "libtmux")', ''), recipe.steps)).toThrow(/load-system/)
  })

  it('wraps each function once, with its steps in the order its calls run, and is strict about the ones that send commands', () => {
    const helper = lispHelper(recipe.steps)
    for (const call of new Set(recipe.steps.map((step: { call: string }) => step.call))) expect(helper.split(`(wrap '${call} `).length - 1, call).toBe(1)
    expect(helper).toMatch(/\(wrap 'libtmux:fetch-snapshot t \(list \(list "snapshot-before".*\(list "snapshot"/)
    expect(helper).toContain("(wrap 'libtmux:window nil ")
    expect(helper).toContain("(wrap 'libtmux:kill-server t ")
  })
})

describe('the Common Lisp recording of the landing page program', () => {
  const capability = capabilityOf('lisp')
  const step = (id: string) => capability.steps.find((each) => each.id === id)!
  const sent = (id: string) => step(id).commands.filter((command) => command.role === 'command').map((command) => command.tmux.split(' ')[0])

  it('is sound, of the displayed program, and was recorded at the revision the page records', () => {
    expectPlayable('lisp')
  })

  it('has one step per call of the step map, in the order the calls ran', () => {
    expect(capability.steps.map((each) => [each.id, each.label, each.anchor, each.type])).toEqual(LISP['typed-graph'].steps.map((each: { id: string; label: string; anchor: string; type: string }) => [each.id, each.label, each.anchor, each.type]))
  })

  it('starts from the server the page\'s setup commands start, which no step is credited with', () => {
    expect(capability.tmuxBefore.sessions.map((session) => session.name)).toEqual(['demo'])
    expect(capability.steps.flatMap((each) => each.commands).some((command) => command.tmux.startsWith('new-session'))).toBe(false)
  })

  it('records what each call returned and the commands that changed tmux', () => {
    expect(step('snapshot-before').returned).toEqual({ sessions: 1, windows: 1, panes: 1 })
    expect(step('split').returned).toEqual({ status: 'succeeded', pane: '%1' })
    expect(step('new-window').returned).toEqual({ status: 'succeeded', window: '@1' })
    expect(step('capture').returned).toMatchObject({ status: 'succeeded', text: expect.stringContaining('hello from tmux') })
    expect(step('snapshot').returned).toEqual({ sessions: 1, windows: 2, panes: 3 })
    expect(step('owner').returned).toEqual({ id: '$0', name: 'demo' })
    expect(sent('split')).toContain('split-window')
    expect(sent('new-window')).toContain('new-window')
    expect(sent('send-text')).toContain('send-keys')
    expect(sent('kill-server')).toEqual(['kill-server'])
    expect(sent('sessions'), 'reading a captured graph sends nothing').toEqual([])
  })

  it('shows the command the library asked for, not the guard it wrapped it in', () => {
    const split = step('split').commands.find((command) => command.mutates)!
    expect(split.tmux).toBe(`split-window -P -F #{pane_id} -t %0 -h -d -- /bin/sh -c 'exec "$@"' libtmux-exec /bin/cat`)
    expect(split.stdout).toBe('%1')
    for (const command of capability.steps.flatMap((each) => each.commands)) expect(command.tmux + command.stdout).not.toMatch(/libtmux-[0-9A-F]{32}|witness\/1\t|if-shell/)
  })

  it('plays every call in every view of the program, each on the line its anchor names and none on another call\'s', () => {
    expectPlayedInEveryView('lisp')
    for (const view of HOME_VIEWS) {
      const ordered = viewSteps(capability, homeProgram(QUICKSTARTS.lisp!.complete!, view).replace(/\n$/, ''), 'lisp').map((each) => each.lines).toSorted((a, b) => a[0] - b[0])
      for (let position = 1; position < ordered.length; position++) expect(ordered[position]![0], `${view}: calls on one line or nested`).toBeGreaterThan(ordered[position - 1]![1])
    }
  })

  it('is played for the program it records and for no other', async () => {
    expect(await playableCapability('lisp', 'typed-graph', shown('lisp'))).toBeDefined()
    expect(await playableCapability('lisp', 'typed-graph', `${shown('lisp')}\n; edited`)).toBeUndefined()
  })
})

describe('the player of a program that connects to a server its setup started', () => {
  it('says the server is running before the first call, and plans every call in every view', async () => {
    const played = (await playableCapability('lisp', 'typed-graph', shown('lisp')))!
    const template = await loadAstroTemplate('components/core/CorePlayer.astro', {
      real: ['components/HomeExample.astro', 'components/replay/TmuxScreen.astro', 'components/replay/ReplayControls.astro'],
      modules: { 'astro-expressive-code/components': { Code } },
    })
    const window = new Window({ url: 'https://libtmux.org/lisp/latest/' })
    window.document.body.innerHTML = await renderAstroTemplate(template, { props: { port: 'lisp', language: 'Common Lisp', example: QUICKSTARTS.lisp!.complete!, recording: played.recording, capability: played.capability } })
    const document = window.document as unknown as Document
    expect(document.querySelector('[data-frame="0"] .mcp-frame__note')!.textContent).toBe('tmux before the first call: the server the setup commands started is running.')
    const plan = JSON.parse(document.querySelector('[data-core-plan]')!.getAttribute('data-core-plan')!) as Record<string, unknown[]>
    expect(Object.keys(plan)).toEqual([...HOME_VIEWS])
    for (const view of HOME_VIEWS) expect(plan[view], view).toHaveLength(played.capability.steps.length)
  })
})

describe('the real player component for each new port', () => {
  const names = { lisp: 'Common Lisp', perl: 'Perl', erlang: 'Erlang', ocaml: 'OCaml', haskell: 'Haskell', clojure: 'Clojure', raku: 'Raku' } as const
  it.each(['lisp', 'perl', 'erlang', 'ocaml', 'haskell', 'clojure', 'raku'] as const)('draws %s: a frame and a result for the state before the first call and for each call, and plans each view', async (port) => {
    const played = (await playableCapability(port, 'typed-graph', shown(port)))!
    const template = await loadAstroTemplate('components/core/CorePlayer.astro', {
      real: ['components/HomeExample.astro', 'components/replay/TmuxScreen.astro', 'components/replay/ReplayControls.astro'],
      modules: { 'astro-expressive-code/components': { Code } },
    })
    const window = new Window({ url: `https://libtmux.org/${port}/latest/` })
    window.document.body.innerHTML = await renderAstroTemplate(template, { props: { port, language: names[port], example: QUICKSTARTS[port]!.complete!, recording: played.recording, capability: played.capability } })
    const document = window.document as unknown as Document
    const steps = played.capability.steps
    expect(document.querySelectorAll('.mcp-frame')).toHaveLength(steps.length + 1)
    expect(document.querySelectorAll('[data-result]')).toHaveLength(steps.length + 1)
    const plan = JSON.parse(document.querySelector('[data-core-plan]')!.getAttribute('data-core-plan')!) as Record<string, unknown[]>
    expect(plan.full, 'the full program holds every call').toHaveLength(steps.length)
    // The last call's note says what became of the server.
    const last = [...document.querySelectorAll('.mcp-frame__note')].at(-1)!.textContent!
    expect(last).toContain(`tmux after ${steps.at(-1)!.label}`)
  })
})

describe('the landing page player of the new ports', () => {
  const stubs = {
    'components/HomeExample.astro': '---\nconst { port } = Astro.props\n---\n<div data-home-example={port} />',
    'components/core/CorePlayer.astro': '---\nconst { port, capabilityId = "typed-graph" } = Astro.props\n---\n<div data-core-player={capabilityId} data-port={port} />',
  }
  const renderer = (template: Awaited<ReturnType<typeof loadAstroTemplate>>) => async (port: string) => {
    const window = new Window()
    window.document.body.innerHTML = await renderAstroTemplate(template, { url: `https://libtmux.org/${port}/latest/`, props: { port, links: [] } })
    return window.document as unknown as Document
  }

  it('replaces the plain example with the player once a port has a sound recording', async () => {
    const render = renderer(await loadAstroTemplate('components/CoreShowcase.astro', { stubs, modules: { 'astro-expressive-code/components': { Code } } }))
    for (const port of ['lisp', 'erlang', 'perl', 'ocaml', 'haskell', 'clojure', 'raku']) {
      const document = await render(port)
      expect(document.querySelector('[data-capability-panel="typed-graph"] [data-core-player]'), `${port} plays its recording`).not.toBeNull()
      expect(document.querySelector('[data-home-example]'), `${port} keeps no plain example`).toBeNull()
    }
  })

  it('keeps the plain example for a port whose recording is not played', async () => {
    // No port lacks a recording once all are recorded, so the page is built the way a port without one would get it.
    const render = renderer(await loadAstroTemplate('components/CoreShowcase.astro', { stubs, modules: { 'astro-expressive-code/components': { Code }, '../lib/core-player': { ...corePlayer, playableCapability: async () => undefined } } }))
    const document = await render('haskell')
    expect(document.querySelector('[data-core-player]')).toBeNull()
    expect(document.querySelector('[data-home-example="haskell"]')).not.toBeNull()
  })
})

describe('Perl recipe', () => {
  const recipe = PERL['typed-graph']
  const code = home.perl.files[0]!.code
  const marked = recipe.instrument(code, recipe.steps)

  it('adds only marker lines to the displayed program: the helper after its imports, and a mark after each call', () => {
    expect(withoutPerlMarks(marked)).toBe(code)
    const added = marked.split('\n').filter((line: string) => line.endsWith('docs:mark'))
    expect(added.filter((line: string) => line.trim().startsWith('docs_mark(')).map((line: string) => /docs_mark\("([^"]+)"/.exec(line)?.[1])).toEqual(recipe.steps.map((step: { id: string }) => step.id))
    expect(marked.split('\n')[marked.split('\n').indexOf('use LibTmuxFixture;') + 1]).toBe('use JSON::PP (); # docs:mark')
  })

  it('puts the mark of a statement that goes on past its call after its last line', () => {
    const lines = marked.split('\n')
    const mark = lines.findIndex((line: string) => line.trim().startsWith('docs_mark("panes"'))
    expect(lines[mark - 1]).toContain('->grep(sub ($pane)')
    expect(lines[mark - 1]).toMatch(/;$/)
  })

  it('refuses an anchor the program does not hold, and a program without the import to put the helper after', () => {
    expect(() => recipe.instrument(code, [{ id: 'x', anchor: '$server->nope(', value: 'undef' }])).toThrow(/not on exactly one line/)
    expect(() => recipe.instrument(code.replace('use LibTmuxFixture;', ''), recipe.steps)).toThrow(/LibTmuxFixture/)
  })

  it('finds every call on exactly one line of the displayed program, the second snapshot by its occurrence', () => {
    for (const step of recipe.steps) expect(statementLines(code, step.anchor, syntaxOf('perl'), occurrenceOf(step)), step.id).toBeDefined()
    expect(statementLines(code, '$snapshot = $server->snapshot;', syntaxOf('perl'))).toBeUndefined()
  })
})

describe('the Perl recording of the landing page program', () => {
  const capability = capabilityOf('perl')
  const step = (id: string) => capability.steps.find((each) => each.id === id)!
  const sent = (id: string) => step(id).commands.filter((command) => command.role === 'command').map((command) => command.tmux.split(' ')[0])

  it('is sound, of the displayed program, and was recorded at the revision the page records', () => {
    expectPlayable('perl')
  })

  it('has one step per call of the step map, in the order the calls ran', () => {
    expect(capability.steps.map((each) => [each.id, each.label, each.anchor, each.type])).toEqual(PERL['typed-graph'].steps.map((each: { id: string; label: string; anchor: string; type: string }) => [each.id, each.label, each.anchor, each.type]))
  })

  it('starts with no server, which the program\'s own fixture starts', () => {
    expect(capability.tmuxBefore.sessions).toEqual([])
    expect(sent('new-session')).toContain('new-session')
  })

  it('records what each call returned and the commands that changed tmux', () => {
    expect(step('new-session').returned).toEqual({ id: '$0', name: 'demo' })
    expect(step('split').returned).toEqual({ id: '%1' })
    expect(step('new-window').returned).toEqual({ id: '@1', name: 'logs' })
    expect(step('snapshot').returned).toEqual({ sessions: 1, windows: 2, panes: 3 })
    expect(step('panes').returned).toEqual(['%0', '%1'])
    expect(step('pane-window').returned).toBe('editor')
    expect(sent('rename')).toEqual(['rename-window'])
    expect(sent('select-pane')).toEqual(['select-pane'])
    expect(sent('select-window')).toContain('select-window')
    expect(sent('kill-session')).toEqual(['kill-session'])
    expect(sent('fixture'), 'the fixture stops the daemon after the last call').toEqual(['kill-server'])
    expect(sent('link'), 'reading a snapshot sends nothing').toEqual([])
  })

  it('shows the window named for the command that started it until the program renames it', () => {
    expect(step('editor').returned).toEqual({ id: '@0', name: 'perl' })
    expect(step('rename').tmux.windows.map((window) => window.name)).toEqual(['editor'])
  })

  it('names the interpreter by its usual path, not the one on the machine that recorded', () => {
    const split = step('split').commands.find((command) => command.mutates)!
    expect(split.tmux).toMatch(/ -- \/usr\/bin\/perl -e 'exec \{\$ARGV\[0\]\} @ARGV or exit 127' -- \/bin\/cat$/)
  })

  it('plays every call in every view of the program, but kill_session in the views that leave out the cleanup', () => {
    expectPlayedInEveryView('perl', { concise: ['kill-session'], errors: ['kill-session'] })
  })

  it('is played for the program it records and for no other', async () => {
    expect(await playableCapability('perl', 'typed-graph', shown('perl'))).toBeDefined()
    expect(await playableCapability('perl', 'typed-graph', `${shown('perl')}\n# edited`)).toBeUndefined()
  })
})

describe('Erlang recipe', () => {
  const recipe = ERLANG['typed-graph']
  const code = home.erlang.files.find((file) => file.name === 'src/readme_demo.erl')!.code
  const marked = recipe.instrument(code, recipe.steps)

  it('adds only marker lines to the displayed program: a mark after each call, in the order the calls run', () => {
    expect(withoutErlangMarks(marked)).toBe(code)
    const added = marked.split('\n').filter((line: string) => line.endsWith('docs:mark'))
    expect(added.map((line: string) => /docs_mark:mark\(<<"([^"]+)">>/.exec(line)?.[1])).toEqual(recipe.steps.map((step: { id: string }) => step.id))
  })

  it('puts the mark of with_owned after the line that closes its function, where the server has been stopped', () => {
    const lines = marked.split('\n')
    const mark = lines.findIndex((line: string) => line.includes('docs_mark:mark(<<"retire">>'))
    expect(lines[mark - 1]).toBe('    end),')
    expect(recipe.steps.find((step: { id: string }) => step.id === 'retire')?.stopsServer).toBe(true)
  })

  it('finds every call on exactly one line of the displayed program, `%` and `\'` read as Erlang reads them', () => {
    for (const step of recipe.steps) expect(statementLines(code, step.anchor, syntaxOf('erlang'), occurrenceOf(step)), step.id).toBeDefined()
    expect(() => recipe.instrument(code, [{ id: 'x', anchor: 'tmux_pane:nope(', value: 'ok' }])).toThrow(/not on exactly one line/)
  })

  it('compiles a helper beside the marked program only, which stops the program when a mark fails', () => {
    expect(recipe.helpers.map((helper: { file: string }) => helper.file)).toEqual(['src/docs_mark.erl'])
    expect(recipe.helpers[0]!.source).toContain('-module(docs_mark).')
    expect(recipe.helpers[0]!.source).toContain('erlang:halt(Status)')
  })
})

describe('the Erlang recording of the landing page program', () => {
  const capability = capabilityOf('erlang')
  const step = (id: string) => capability.steps.find((each) => each.id === id)!
  const sent = (id: string) => step(id).commands.filter((command) => command.role === 'command').map((command) => command.tmux.split(' ')[0])

  it('is sound, of the displayed program, and was recorded at the revision the page records', () => {
    expectPlayable('erlang')
  })

  it('has one step per call of the step map, in the order the calls ran', () => {
    expect(capability.steps.map((each) => [each.id, each.label, each.anchor, each.type])).toEqual(ERLANG['typed-graph'].steps.map((each: { id: string; label: string; anchor: string; type: string }) => [each.id, each.label, each.anchor, each.type]))
  })

  it('starts with no session: the program starts its own server', () => {
    expect(capability.tmuxBefore.sessions).toEqual([])
    expect(sent('session')).toContain('new-session')
  })

  it('records what each call returned and the commands that changed tmux', () => {
    expect(step('session').returned).toEqual({ id: '$0', name: 'workspace' })
    expect(step('worker').returned).toEqual({ id: '@1', name: 'workers' })
    expect(step('split').returned).toEqual({ id: '%2' })
    expect(step('snapshot').returned).toEqual({ sessions: 1, windows: 2, panes: 3 })
    expect(step('children').returned).toEqual(['%1', '%2'])
    expect(step('renamed').returned).toEqual({ id: '@1', name: 'finished' })
    expect(sent('worker')).toContain('new-window')
    expect(sent('split')).toContain('split-window')
    expect(sent('layout')).toEqual(['select-layout'])
    expect(sent('resize')).toEqual(['resize-pane'])
    expect(sent('rename')).toEqual(['rename-window'])
    expect(sent('windows'), 'reading a snapshot sends nothing').toEqual([])
  })

  it('counts the library\'s daemon identity checks as probes, not as the commands the call sent', () => {
    expect(step('layout').commands.filter((command) => command.role === 'probe')).toHaveLength(1)
    for (const command of capability.steps.flatMap((each) => each.commands)) if (command.role === 'command') expect(command.tmux).not.toContain('#{pid}')
  })

  it('ends with the call that stops the server by its process id, which sends no command', () => {
    const retire = step('retire')
    expect(retire.stopsServer).toBe(true)
    expect(retire.commands).toEqual([])
    expect(retire.tmux.sessions).toEqual([])
    expect(retire.returned).toEqual({ sessions: 1, windows: 2, panes: 3, matched_panes: 2, captured_name: 'workers', immutable: true })
  })

  it('plays every call in every view of the program, each on the line its anchor names', () => {
    expectPlayedInEveryView('erlang')
  })

  it('is played for the program it records and for no other', async () => {
    expect(await playableCapability('erlang', 'typed-graph', shown('erlang'))).toBeDefined()
    expect(await playableCapability('erlang', 'typed-graph', `${shown('erlang')}\n% edited`)).toBeUndefined()
  })
})

describe('OCaml recipe', () => {
  const recipe = OCAML['typed-graph']
  const code = home.ocaml.files.find((file) => file.name === 'examples/showcase_graph.ml')!.code
  const marked = recipe.instrument(code, recipe.steps)

  it('adds one line to the displayed program, which opens the helper after the module aliases', () => {
    expect(withoutOcamlMarks(marked)).toBe(code)
    const lines = marked.split('\n')
    const added = lines.filter((line: string) => line.endsWith('docs:mark *)'))
    expect(added).toEqual(['open Docs_mark (* docs:mark *)'])
    expect(lines[lines.indexOf(added[0]!) - 1]).toBe('module Execution = Libtmux_workspace.Execution')
  })

  it('finds every call on one line of every view of the program, the repeated ones by their occurrence', () => {
    for (const view of views('ocaml')) {
      for (const step of recipe.steps) expect(statementLines(view, step.anchor, syntaxOf('ocaml'), occurrenceOf(step)), step.id).toBeDefined()
    }
    expect(statementLines(code, 'get (Client.capture client)', syntaxOf('ocaml')), 'three lines hold it').toBeUndefined()
  })

  it('refuses an anchor the program does not hold, a function the helper does not wrap, and a program without the alias to open it after', () => {
    expect(() => recipe.instrument(code, [{ id: 'x', anchor: 'Client.nope', call: 'Client.capture', value: '"null"' }])).toThrow(/not on exactly one line/)
    expect(() => recipe.instrument(code, [{ id: 'x', anchor: 'Client.link_window', call: 'Client.nope', value: '"null"' }])).toThrow(/helper wraps/)
    expect(() => recipe.instrument(code.replace('module Execution = Libtmux_workspace.Execution', ''), recipe.steps)).toThrow(/module Execution/)
  })

  it('wraps each function once, with its steps in the order its calls run, and stops the program at a call it did not plan', () => {
    const helper = ocamlHelper(recipe.steps)
    for (const call of new Set(recipe.steps.map((step: { call: string }) => step.call))) expect(helper.split(`unplanned "${call}"`).length - 1, call).toBe(1)
    expect(helper).toMatch(/\| 0, Ok value -> mark "capture-initial".*\n\s*\| 1, Ok value -> mark "capture-linked".*\n\s*\| 2, Ok value -> mark "capture-graph"/)
    expect(helper).toContain('| 0, Ok _ -> mark "close" ("null")')
    expect(helper.split('module Client = struct').length - 1).toBe(1)
    expect(helper.split('module Workspace = struct').length - 1).toBe(1)
  })
})

describe('the OCaml recording of the landing page program', () => {
  const capability = capabilityOf('ocaml')
  const step = (id: string) => capability.steps.find((each) => each.id === id)!
  const sent = (id: string) => step(id).commands.filter((command) => command.role === 'command').map((command) => command.tmux.split(' ')[0])

  it('is sound, of the displayed program, and was recorded at the revision the page records', () => {
    expectPlayable('ocaml')
  })

  it('has one step per call of the step map, in the order the calls ran', () => {
    expect(capability.steps.map((each) => [each.id, each.label, each.anchor, each.type])).toEqual(OCAML['typed-graph'].steps.map((each: { id: string; label: string; anchor: string; type: string }) => [each.id, each.label, each.anchor, each.type]))
  })

  it('starts with no server: the workspace plan the program submits starts it', () => {
    expect(capability.tmuxBefore.sessions).toEqual([])
    expect(sent('submit'), 'submitting a plan sends nothing but the version probe').toEqual([])
    expect(step('submit').commands.map((command) => command.tmux)).toEqual(['-V'])
    expect(sent('await')).toEqual(['new-session'])
    expect(step('await').returned).toEqual({ status: 'succeeded', steps: 1 })
  })

  it('records what each call returned and the commands that changed tmux', () => {
    expect(step('capture-initial').returned).toEqual({ sessions: 1, windows: 1, links: 1, panes: 1 })
    expect(step('create-session').returned).toEqual({ session: '$1', window: '@1', pane: '%1' })
    expect(step('capture-graph').returned).toEqual({ sessions: 2, windows: 2, links: 3, panes: 2 })
    expect(sent('create-session')).toEqual(['new-session'])
    expect(sent('link-window')).toEqual(['link-window'])
    expect(step('link-window').commands.find((command) => command.mutates)!.tmux).toBe('link-window -d -s @0 -t $1:7')
    expect(sent('capture-graph'), 'a capture is four listings').toEqual(['list-sessions', 'list-windows', 'list-panes', 'list-clients'])
  })

  it('shows the commands the library asked for, not the markers it ends their replies with, and no name that differs on every run', () => {
    for (const command of capability.steps.flatMap((each) => each.commands)) expect(command.tmux + command.stdout).not.toMatch(/libtmux-ocaml-[0-9a-f]{32}/)
    expect(sent('wait-initial')).toEqual(expect.arrayContaining(['attach-session', 'capture-pane', 'save-buffer', 'delete-buffer']))
    expect(JSON.stringify(capability)).not.toMatch(/client-[1-9]\d*/)
  })

  it('draws the window the program links into the second session as a link of it: two windows, three links', () => {
    const state = step('capture-graph').tmux
    expect(new Set(state.windows.map((window) => window.id)).size).toBe(2)
    expect(state.windows.map((window) => `${window.session}:${window.index}:${window.id}`).sort()).toEqual(['$0:0:@0', '$1:0:@1', '$1:7:@0'])
    expect(state.panes.map((pane) => pane.id).sort()).toEqual(['%0', '%1'])
    expect(tmuxChanges(step('wait-linked').tmux, state).phrases).toEqual(['linked window linked:7:editor'])
  })

  it('ends with the call that closes the workspace, after which the daemon exits on its own and no command is sent', () => {
    const close = step('close')
    expect(close.stopsServer).toBe(true)
    expect(close.commands).toEqual([])
    expect(close.tmux.sessions).toEqual([])
  })

  it('plays every call in every view of the program, each on the line its anchor names', () => {
    expectPlayedInEveryView('ocaml')
  })

  it('is played for the program it records and for no other', async () => {
    expect(await playableCapability('ocaml', 'typed-graph', shown('ocaml'))).toBeDefined()
    expect(await playableCapability('ocaml', 'typed-graph', `${shown('ocaml')}\n(* edited *)`)).toBeUndefined()
  })
})

describe('Haskell recipe', () => {
  const recipe = HASKELL['typed-graph']
  const code = home.haskell.files.find((file) => file.name === 'Main.hs')!.code
  const marked = recipe.instrument(code, recipe.steps)

  it('adds only marker lines to the displayed program: the helper import after its imports, and a mark after each call', () => {
    expect(withoutHaskellMarks(marked)).toBe(code)
    const lines = marked.split('\n')
    const added = lines.filter((line: string) => line.endsWith('docs:mark'))
    expect(added.filter((line: string) => line.trim().startsWith('Mark.mark ')).map((line: string) => /Mark\.mark "([^"]+)"/.exec(line)?.[1])).toEqual(recipe.steps.map((step: { id: string }) => step.id))
    expect(lines[lines.indexOf('import System.OsPath.Posix qualified as Path') + 1]).toBe('import DocsMark qualified as Mark -- docs:mark')
  })

  it('gives a mark the indent of its statement when the call is on a later line of it', () => {
    const lines = marked.split('\n')
    const mark = lines.findIndex((line: string) => line.includes('Mark.mark "session"'))
    expect(lines[mark - 1]).toBe('        (Q.exactlyOne (Tmux.sessions before))')
    expect(lines[mark]).toMatch(/^ {6}Mark\.mark /)
    const fresh = lines.findIndex((line: string) => line.includes('Mark.mark "changed-session"'))
    expect(lines[fresh]).toMatch(/^ {8}Mark\.mark /)
  })

  it('finds every call on exactly one line of the displayed program, `--` and `{-` read as Haskell reads them', () => {
    for (const view of views('haskell')) for (const step of recipe.steps) expect(statementLines(view, step.anchor, syntaxOf('haskell'), occurrenceOf(step)), step.id).toBeDefined()
    expect(() => recipe.instrument(code, [{ id: 'x', anchor: 'Tmux.nope', value: 'Mark.unit' }])).toThrow(/not on exactly one line/)
    expect(() => recipe.instrument(code.replace('import System.OsPath.Posix qualified as Path', ''), recipe.steps)).toThrow(/OsPath/)
  })

  it('compiles a helper beside the marked program only, which stops the program when a mark fails', () => {
    expect(recipe.helpers.map((helper: { file: string }) => helper.file)).toEqual(['DocsMark.hs'])
    expect(recipe.helpers[0]!.source).toContain('module DocsMark')
    expect(recipe.helpers[0]!.source).toContain('exitWith (ExitFailure code)')
  })
})

describe('the Haskell recording of the landing page program', () => {
  const capability = capabilityOf('haskell')
  const step = (id: string) => capability.steps.find((each) => each.id === id)!
  const sent = (id: string) => step(id).commands.filter((command) => command.role === 'command').map((command) => command.tmux.split(' ')[0])

  it('is sound, of the displayed program, and was recorded at the revision the page records', () => {
    expectPlayable('haskell')
  })

  it('has one step per call of the step map, in the order the calls ran', () => {
    expect(capability.steps.map((each) => [each.id, each.label, each.anchor, each.type])).toEqual(HASKELL['typed-graph'].steps.map((each: { id: string; label: string; anchor: string; type: string }) => [each.id, each.label, each.anchor, each.type]))
  })

  it('starts from the server the page\'s setup commands start, whose window is linked twice, and no step is credited with either', () => {
    expect(capability.tmuxBefore.sessions.map((session) => session.name)).toEqual(['demo'])
    expect(capability.tmuxBefore.windows.map((window) => `${window.index}:${window.id}`)).toEqual(['0:@0', '4:@0'])
    expect(capability.steps.flatMap((each) => each.commands).some((command) => /^(new-session|link-window)/.test(command.tmux))).toBe(false)
  })

  it('records what each call returned and the commands that changed tmux', () => {
    expect(step('capture-before').returned).toEqual({ sessions: 1, windows: 1, panes: 1 })
    expect(step('session').returned).toEqual({ id: '$0', name: 'demo' })
    expect(step('changed-session').returned).toEqual({ id: '$0', name: 'workspace' })
    expect(step('changed-window').returned).toEqual({ id: '@0', name: 'api #{pid};' })
    expect(step('changed-pane').returned).toMatchObject({ id: '%0', title: 'editor-ready' })
    expect(step('new-name').returned).toBe('api #{pid};')
    expect(sent('rename-session')).toEqual(['rename-session'])
    expect(sent('rename-window')).toEqual(['rename-window'])
    expect(sent('set-pane-title'), 'a pane title is set with select-pane -T').toEqual(['select-pane'])
    expect(sent('capture-before'), 'a capture is one display-message').toEqual(['display-message'])
    expect(sent('window'), 'a lookup in a snapshot sends nothing').toEqual([])
    expect(step('rename-session').tmux.windows.map((window) => window.name), 'both links show the window\'s name').toEqual(['editor', 'editor'])
    expect(step('rename-window').tmux.windows.map((window) => window.name)).toEqual(['api #{pid};', 'api #{pid};'])
  })

  it('shows no token or process id that differs on every run', () => {
    expect(JSON.stringify(capability)).not.toMatch(/\bg[0-9a-f]{64}\b/)
    expect(step('capture-before').commands[0]!.stdout).toContain('server.pid:12345:')
  })

  it('draws the window linked twice as two labels, each with a view of its own, the second one current', async () => {
    const played = (await playableCapability('haskell', 'typed-graph', shown('haskell')))!
    const template = await loadAstroTemplate('components/core/CorePlayer.astro', {
      real: ['components/HomeExample.astro', 'components/replay/TmuxScreen.astro', 'components/replay/ReplayControls.astro'],
      modules: { 'astro-expressive-code/components': { Code } },
    })
    const window = new Window({ url: 'https://libtmux.org/haskell/latest/' })
    window.document.body.innerHTML = await renderAstroTemplate(template, { props: { port: 'haskell', language: 'Haskell', example: QUICKSTARTS.haskell!.complete!, recording: played.recording, capability: played.capability } })
    const document = window.document as unknown as Document
    const frame = document.querySelector('[data-frame="0"]')!
    expect(frame.querySelector('.mcp-frame__note')!.textContent).toBe('tmux before the first call: the server the setup commands started is running.')
    expect([...frame.querySelectorAll('.mcp-tmux__window')].map((label) => label.textContent)).toEqual(['0:editor', '4:editor*'])
    const keys = [...frame.querySelectorAll<HTMLElement>('[data-view]')].map((view) => view.dataset.view)
    expect(keys, 'each link has a view of its own').toEqual(['$0/@0:0', '$0/@0:4'])
    expect([...frame.querySelectorAll<HTMLElement>('[data-view]')].filter((view) => !view.hidden).map((view) => view.dataset.view)).toEqual(['$0/@0:4'])
  })

  it('plays every call in every view of the program, each on the line its anchor names', () => {
    expectPlayedInEveryView('haskell')
  })

  it('is played for the program it records and for no other', async () => {
    expect(await playableCapability('haskell', 'typed-graph', shown('haskell'))).toBeDefined()
    expect(await playableCapability('haskell', 'typed-graph', `${shown('haskell')}\n-- edited`)).toBeUndefined()
  })
})

describe('Clojure recipe', () => {
  const recipe = CLOJURE['typed-graph']
  const code = home.clojure.files.find((file) => file.name === 'quickstart.clj')!.code
  const marked = recipe.instrument(code, recipe.steps)

  it('adds one line to the displayed program, which loads the helper after the library is required', () => {
    expect(withoutClojureMarks(marked)).toBe(code)
    const lines = marked.split('\n')
    const added = lines.filter((line: string) => line.endsWith('docs:mark'))
    expect(added).toEqual(["(require 'docs-mark) ; docs:mark"])
    expect(lines[lines.indexOf(added[0]!) - 1]).toBe("         '[libtmux.data :as data])")
  })

  it('finds every call on exactly one line of every view of the program', () => {
    for (const view of views('clojure')) for (const step of recipe.steps) expect(statementLines(view, step.anchor, syntaxOf('clojure'), occurrenceOf(step)), step.id).toBeDefined()
  })

  it('refuses an anchor the program does not hold, and a program that never requires the library', () => {
    expect(() => recipe.instrument(code, [{ id: 'x', anchor: '(tm/nope!', call: 'libtmux.core/nope!', value: 'nil' }])).toThrow(/not on exactly one line/)
    expect(() => recipe.instrument(code.replace("'[libtmux.data :as data])", "'[libtmux.data :as d])"), recipe.steps)).toThrow(/libtmux\.data/)
  })

  it('wraps each function once, with a plan of its steps, and stops the program at a call it did not plan', () => {
    const helper = clojureHelper(recipe.steps)
    for (const call of new Set(recipe.steps.map((step: { call: string }) => step.call))) expect(helper.split(`(wrap #'${call} `).length - 1, call).toBe(1)
    expect(helper).toContain('an unplanned call of')
    expect(helper).toContain('(System/exit 70)')
    expect(helper).toContain("(wrap #'libtmux.core/kill-server! [[\"kill-server\" (fn [result _args] nil)]])")
  })
})

describe('the Clojure recording of the landing page program', () => {
  const capability = capabilityOf('clojure')
  const step = (id: string) => capability.steps.find((each) => each.id === id)!
  const sent = (id: string) => step(id).commands.filter((command) => command.role === 'command').map((command) => command.tmux.split(' ')[0])

  it('is sound, of the displayed program, and was recorded at the revision the page records', () => {
    expectPlayable('clojure')
  })

  it('has one step per call of the step map, in the order the calls ran', () => {
    expect(capability.steps.map((each) => [each.id, each.label, each.anchor, each.type])).toEqual(CLOJURE['typed-graph'].steps.map((each: { id: string; label: string; anchor: string; type: string }) => [each.id, each.label, each.anchor, each.type]))
  })

  it('starts with no server: opening a handle sends nothing, and the first session starts the daemon', () => {
    expect(capability.tmuxBefore.sessions).toEqual([])
    expect(step('open').commands).toEqual([])
    expect(sent('new-session')).toContain('new-session')
  })

  it('records what each call returned and the commands that changed tmux', () => {
    expect(step('new-session').returned).toEqual({ id: '$0', name: 'demo' })
    expect(step('rename').returned).toEqual({ id: '@0', name: 'editor' })
    expect(step('split').returned).toEqual({ id: '%1' })
    expect(step('new-window').returned).toEqual({ id: '@1', name: 'logs' })
    expect(step('await-text').returned).toBe('present-at-entry')
    expect(step('snapshot').returned).toEqual({ sessions: 1, windows: 2, panes: 3 })
    expect(step('capture').returned).toContain('hello from Clojure')
    expect(sent('rename')).toContain('rename-window')
    expect(sent('split')).toContain('split-window')
    expect(sent('new-window')).toContain('new-window')
    expect(sent('send-literal')).toContain('send-keys')
    expect(sent('send-keys')).toContain('send-keys')
    expect(sent('capture')).toEqual(['capture-pane'])
  })

  it('shows the command the library asked for, not the guards around it, and in it no delimiter that differs on every run', () => {
    for (const command of capability.steps.flatMap((each) => each.commands)) {
      expect(command.tmux + command.stdout).not.toMatch(/if-shell|libtmux-stale/)
      expect(command.tmux).not.toMatch(/[0-9a-f]{32}/)
    }
  })

  it('ends with the call that kills the server, which sends the command and leaves no session', () => {
    const kill = step('kill-server')
    expect(kill.commands.some((command) => command.role === 'command' && command.tmux.endsWith('; kill-server'))).toBe(true)
    expect(kill.tmux.sessions).toEqual([])
    expect(kill.stopsServer, 'the library asked tmux to stop, so no step says the daemon was stopped by its process id').toBeUndefined()
  })

  it('plays every call in every view of the program, each on the line its anchor names', () => {
    expectPlayedInEveryView('clojure')
  })

  it('is played for the program it records and for no other', async () => {
    expect(await playableCapability('clojure', 'typed-graph', shown('clojure'))).toBeDefined()
    expect(await playableCapability('clojure', 'typed-graph', `${shown('clojure')}\n; edited`)).toBeUndefined()
  })
})

describe('Raku recipe', () => {
  const recipe = RAKU['typed-graph']
  const code = home.raku.files[0]!.code
  const marked = recipe.instrument(code, recipe.steps)

  it('adds only marker lines to the displayed program: the helper after its import, a mark after each call, and the close mark as a phaser', () => {
    expect(withoutRakuMarks(marked)).toBe(code)
    const lines = marked.split('\n')
    expect(lines[lines.indexOf('use LibTmux;') + 1]).toBe('use JSON::Fast; # docs:mark')
    const marks = lines.filter((line: string) => line.endsWith('docs:mark') && /docs-mark\("/.test(line)).map((line: string) => /docs-mark\("([^"]+)"/.exec(line)?.[1])
    expect(marks.toSorted()).toEqual(recipe.steps.map((step: { id: string }) => step.id).toSorted())
  })

  it('declares the close mark before the program\'s own LEAVE, so that it runs after the daemon has stopped', () => {
    const lines = marked.split('\n')
    const mark = lines.findIndex((line: string) => line.startsWith('LEAVE docs-mark("close"'))
    expect(lines[mark + 1]).toBe('LEAVE $server.close if $server.defined;')
  })

  it('refuses an anchor the program does not hold, and a program without the import to put the helper after', () => {
    expect(() => recipe.instrument(code, [{ id: 'x', anchor: '$server.nope(', value: 'Nil' }])).toThrow(/not on exactly one line/)
    expect(() => recipe.instrument(code.replace('use LibTmux;', ''), recipe.steps)).toThrow(/use LibTmux/)
  })

  it('finds every call on exactly one line of the displayed program', () => {
    for (const step of recipe.steps) expect(statementLines(code, step.anchor, syntaxOf('raku'), occurrenceOf(step)), step.id).toBeDefined()
  })

  it('reads a command out of the guard the library wraps it in, and nothing else', () => {
    const guarded = ['if-shell', '-F', '#{==:#{pid}/#{start_time},1/2}', '"split-window" "-t" "%0" "--" "exec cat"', `libtmux-stale-${'a'.repeat(32)}`]
    expect(recipe.unwrap(guarded)).toEqual(['split-window', '-t', '%0', '--', 'exec cat'])
    expect(recipe.unwrap(['split-window', '-t', '%0'])).toBeUndefined()
    expect(recipe.unwrap(['if-shell', '-F', 'x', 'y', 'z'])).toBeUndefined()
  })
})

describe('the Raku recording of the landing page program', () => {
  const capability = capabilityOf('raku')
  const step = (id: string) => capability.steps.find((each) => each.id === id)!
  const sent = (id: string) => step(id).commands.filter((command) => command.role === 'command').map((command) => command.tmux.split(' ')[0])

  it('is sound, of the displayed program, and was recorded at the revision the page records', () => {
    expectPlayable('raku')
  })

  it('has one step per call of the step map, in the order the calls ran', () => {
    expect(capability.steps.map((each) => [each.id, each.label, each.anchor, each.type])).toEqual(RAKU['typed-graph'].steps.map((each: { id: string; label: string; anchor: string; type: string }) => [each.id, each.label, each.anchor, each.type]))
  })

  it('starts with no server: Server.start starts the daemon and creates the first session', () => {
    expect(capability.tmuxBefore.sessions).toEqual([])
    expect(sent('start')).toEqual(['new-session'])
  })

  it('records what each call returned and the commands that changed tmux', () => {
    expect(step('start').returned).toEqual({ socket: 'libtmux-owned-AbC123' })
    expect(step('snapshot-before').returned).toEqual({ sessions: 1, windows: 1, panes: 1 })
    expect(step('split').returned).toEqual({ id: '%1' })
    expect(step('snapshot').returned).toEqual({ sessions: 1, windows: 1, panes: 2 })
    expect(step('selected').returned).toEqual({ id: '%0', title: 'editor' })
    expect(sent('split')).toEqual(['split-window'])
    expect(sent('title-editor')).toEqual(['select-pane'])
    expect(sent('title-logs')).toEqual(['select-pane'])
    expect(sent('snapshot-before')).toEqual(['list-sessions', 'list-windows', 'list-windows', 'list-panes', 'list-clients', 'list-sessions', 'list-buffers'])
    expect(sent('pane'), 'reading a snapshot sends nothing').toEqual([])
    expect(sent('selected'), 'reading a snapshot sends nothing').toEqual([])
  })

  it('counts the library\'s daemon identity checks as probes, and shows no guard, token or process id', () => {
    expect(step('split').commands).toHaveLength(1)
    expect(step('snapshot').commands.filter((command) => command.role === 'probe').length).toBeGreaterThan(0)
    const text = JSON.stringify(capability.steps.flatMap((each) => each.commands.map((command) => command.tmux)))
    expect(text).not.toMatch(/if-shell|libtmux-stale|[0-9a-f]{32}(?<!0{32})/)
    expect(text).not.toMatch(/libtmux-owned-(?!AbC123)/)
  })

  it('ends with the call that closes the owned daemon, after which no session is left', () => {
    const close = step('close')
    expect(close.stopsServer).toBe(true)
    expect(close.tmux.sessions).toEqual([])
    expect(close.returned).toBeNull()
  })

  it('plays every call in every view of the program, each on the line its anchor names', () => {
    expectPlayedInEveryView('raku')
  })

  it('is played for the program it records and for no other', async () => {
    expect(await playableCapability('raku', 'typed-graph', shown('raku'))).toBeDefined()
    expect(await playableCapability('raku', 'typed-graph', `${shown('raku')}\n# edited`)).toBeUndefined()
  })
})
