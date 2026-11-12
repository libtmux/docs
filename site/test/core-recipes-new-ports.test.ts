import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { describe, expect, it } from 'vitest'
import { RECIPES as LISP, lispHelper, withoutMarks as withoutLispMarks } from '../../scripts/lib/core-recipes/lisp.mjs'
import { RECIPES as PERL, withoutMarks as withoutPerlMarks } from '../../scripts/lib/core-recipes/perl.mjs'
import { playableCapability, viewSteps } from '../src/lib/core-player'
import { recordingProblems, sha256, type CoreRecording } from '../src/lib/core-recording'
import { statementLines, syntaxOf } from '../src/lib/core-statement'
import { HOME_VIEWS, QUICKSTARTS, homeProgram } from '../src/lib/quickstarts'
import home from '../src/data/home-examples.json'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const recording = (port: string): CoreRecording => JSON.parse(readFileSync(new URL(`../src/data/core-recordings/${port}.json`, import.meta.url), 'utf8'))
const capabilityOf = (port: string) => recording(port).capabilities['typed-graph']!
const shown = (port: string) => homeProgram(QUICKSTARTS[port]!.complete!, 'full')
/** The Code block of the page, as text, so a template renders without Expressive Code. */
const Code = createComponent((_result: unknown, props: { code: string }) => renderTemplate`<pre data-code>${props.code}</pre>`)

/** What every recording of a landing program must hold: it is of the displayed program, at the revision the page records, and plays in each view. */
function expectPlayable(port: 'lisp' | 'perl') {
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
function expectPlayedInEveryView(port: 'lisp' | 'perl', absent: Record<string, string[]> = {}) {
  const capability = capabilityOf(port)
  for (const view of HOME_VIEWS) {
    const code = homeProgram(QUICKSTARTS[port]!.complete!, view).replace(/\n$/, '')
    const placed = viewSteps(capability, code, port)
    expect(placed.map((each) => capability.steps[each.index]!.id), view).toEqual(capability.steps.map((each) => each.id).filter((id) => !(absent[view] ?? []).includes(id)))
    for (const { index, lines } of placed) expect(code.split('\n')[lines[0] - 1], `${view} ${capability.steps[index]!.id}`).toContain(capability.steps[index]!.anchor)
  }
}

/** The programs the page shows for a port, in every view: the recording plays a call only in a view that holds it. */
const views = (port: 'lisp' | 'perl') => [shown(port), ...Object.values((home[port] as { variants?: Record<string, string> }).variants ?? {})]

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
        expect(statementLines(view, step.anchor, syntaxOf('lisp'), step.occurrence), step.id).toBeDefined()
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

describe('the landing page player of the new ports', () => {
  it('replaces the plain example with the player once a port has a sound recording, and keeps it for a port without one', async () => {
    const template = await loadAstroTemplate('components/CoreShowcase.astro', {
      stubs: {
        'components/HomeExample.astro': '---\nconst { port } = Astro.props\n---\n<div data-home-example={port} />',
        'components/core/CorePlayer.astro': '---\nconst { port, capabilityId = "typed-graph" } = Astro.props\n---\n<div data-core-player={capabilityId} data-port={port} />',
      },
      modules: { 'astro-expressive-code/components': { Code } },
    })
    const render = async (port: string) => {
      const window = new Window()
      window.document.body.innerHTML = await renderAstroTemplate(template, { url: `https://libtmux.org/${port}/latest/`, props: { port, links: [] } })
      return window.document as unknown as Document
    }
    const lisp = await render('lisp')
    expect(lisp.querySelector('[data-capability-panel="typed-graph"] [data-core-player]'), 'lisp plays its recording').not.toBeNull()
    expect(lisp.querySelector('[data-home-example]')).toBeNull()
    const perl = await render('perl')
    expect(perl.querySelector('[data-capability-panel="typed-graph"] [data-core-player]'), 'perl plays its recording').not.toBeNull()
    const haskell = await render('haskell')
    expect(haskell.querySelector('[data-core-player]'), 'haskell has no recording yet').toBeNull()
    expect(haskell.querySelector('[data-home-example="haskell"]')).not.toBeNull()
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
    for (const step of recipe.steps) expect(statementLines(code, step.anchor, syntaxOf('perl'), step.occurrence), step.id).toBeDefined()
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
