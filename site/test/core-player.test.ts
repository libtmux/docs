import { readFileSync } from 'node:fs'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { Window } from 'happy-dom'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { capabilityExample, coreFrames, coreRecordingFor, paneActivity, playableCapability, stepChanges, stepNote, tmuxChanges, viewSteps, visibleCommands } from '../src/lib/core-player'
import { statementLines } from '../src/lib/core-statement'
import { HOME_VIEWS, QUICKSTARTS, homeProgram } from '../src/lib/quickstarts'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const example = QUICKSTARTS.go!.complete!
const code = (view: (typeof HOME_VIEWS)[number]) => homeProgram(example, view).replace(/\n$/, '')
const recorded = async () => (await playableCapability('go', 'typed-graph', homeProgram(example, 'full')))!
const textOf = (view: (typeof HOME_VIEWS)[number], [start, end]: readonly [number, number]) => code(view).split('\n').slice(start - 1, end).join('\n')

describe('finding a call in a program', () => {
  const source = ['func run() {', '\tserver, err := tmux.NewServer(tmux.ServerOptions{', '\t\tSocketName: fmt.Sprintf("x-%d)", os.Getpid()), // (comment', '\t})', '\tif err != nil {', '\t\treturn err', '\t}', '\tserver.Kill(ctx)', '}'].join('\n')

  it('spans a call from its first line to the line where its parentheses close', () => {
    expect(statementLines(source, 'tmux.NewServer(')).toEqual([2, 4])
    expect(statementLines(source, 'server.Kill(')).toEqual([8, 8])
  })

  it('does not count a bracket inside a string or a comment', () => {
    expect(statementLines(source, 'tmux.NewServer(')![1], 'the ")" in the string and the "(" in the comment').toBe(4)
  })

  it('finds nothing for an anchor that is on no line or on several', () => {
    expect(statementLines(source, 'tmux.NewSession(')).toBeUndefined()
    expect(statementLines(source, 'err')).toBeUndefined()
  })

  it('reads a statement with no parenthesis as its own line', () => {
    expect(statementLines('a := 1\nb := 2', 'b := 2')).toEqual([2, 2])
  })
})

describe('the calls each view of the Go program plays', () => {
  it('plays the three calls of the short program and the fourth, Kill, once the program cleans up', async () => {
    const { capability } = await recorded()
    const indexes = (view: (typeof HOME_VIEWS)[number]) => viewSteps(capability, code(view)).map((step) => step.index)
    const every = capability.steps.map((_, index) => index)
    expect(capability.steps.at(-1)!.id).toBe('kill')
    expect(indexes('concise')).toEqual(every.slice(0, -1))
    expect(indexes('errors')).toEqual(every.slice(0, -1))
    expect(indexes('cleanup')).toEqual(every)
    expect(indexes('full')).toEqual(every)
  })

  it('finds each call\'s lines in the view that is shown, which differ between views', async () => {
    const { capability } = await recorded()
    for (const view of HOME_VIEWS) {
      for (const { index, lines } of viewSteps(capability, code(view))) {
        const shown = textOf(view, lines)
        expect(shown.split('\n')[0], `${view} ${capability.steps[index]!.id}`).toContain(capability.steps[index]!.anchor)
        // The call's text ends with the parenthesis that closes the one it opened.
        expect(shown.split('(').length - 1, `${view} ${capability.steps[index]!.id}`).toBe(shown.split(')').length - 1)
      }
    }
    const lineOf = (view: (typeof HOME_VIEWS)[number], id: string) => viewSteps(capability, code(view)).find((step) => capability.steps[step.index]!.id === id)!.lines
    expect(lineOf('full', 'split'), 'the error handling and cleanup lines above Split move it down').not.toEqual(lineOf('concise', 'split'))
  })

  it('keeps the calls\' lines apart, and in the order the source has them (not the order they run)', async () => {
    const { capability } = await recorded()
    const lines = viewSteps(capability, code('full')).map((step) => step.lines)
    const ordered = [...lines].sort((a, b) => a[0] - b[0])
    for (let position = 1; position < ordered.length; position++) expect(ordered[position]![0]).toBeGreaterThan(ordered[position - 1]![1])
    expect(lines.map((range) => range[0]), 'the deferred Kill is above the calls it follows in the source').not.toEqual(ordered.map((range) => range[0]))
  })

  it('marks the deferred Kill on the line that makes it', async () => {
    const { capability } = await recorded()
    const kill = viewSteps(capability, code('cleanup')).find((step) => capability.steps[step.index]!.id === 'kill')!
    expect(textOf('cleanup', kill.lines)).toMatch(/errors\.Join\(err, server\.Kill\(context\.WithoutCancel\(ctx\)\)\)/)
  })

  it('plays none of them for a program the recording is not of', async () => {
    expect(await playableCapability('go', 'typed-graph', `${homeProgram(example, 'full')}\n// edited`)).toBeUndefined()
    expect(await playableCapability('go', 'no-such-capability', homeProgram(example, 'full'))).toBeUndefined()
    expect(await playableCapability('rs', 'typed-graph', 'fn main() {}')).toBeUndefined()
    expect(await coreRecordingFor('no-such-port')).toBeUndefined()
  })
})

describe('the other programs of Go\'s landing page', () => {
  const sources = JSON.parse(readFileSync(new URL('../src/data/example-sources.json', import.meta.url), 'utf8'))
  const program = (file: string): string => sources[`go:examples/${file}/main.go`].content.replace(/\n$/, '')
  const watch = program('control-mode-subscribe')
  const run = program('run-to-completion')

  it('plays each for the program it was recorded from, and for no other', async () => {
    expect(await playableCapability('go', 'watch', watch)).toBeDefined()
    expect(await playableCapability('go', 'run-applications', run)).toBeDefined()
    expect(await playableCapability('go', 'watch', run)).toBeUndefined()
    expect(await playableCapability('go', 'watch', `${watch}\n// edited`)).toBeUndefined()
    expect(await playableCapability('go', 'run-applications', `${run}\n// edited`)).toBeUndefined()
  })

  it('plays every step, each iteration of a loop on the loop\'s line', async () => {
    const { capability } = (await playableCapability('go', 'watch', watch))!
    const placed = viewSteps(capability, watch)
    expect(placed.map((step) => step.index)).toEqual(capability.steps.map((_, index) => index))
    const lineOf = (id: string) => placed.find((step) => capability.steps[step.index]!.id === id)!.lines
    expect(lineOf('next-1')).toEqual(lineOf('next-2'))
    expect(lineOf('next-change-1')).toEqual(lineOf('next-change-2'))
    expect(lineOf('next-change-1')[0]).toBeGreaterThan(lineOf('next-1')[0])
    expect(watch.split('\n')[lineOf('next-change-1')[0] - 1]).toContain('stream.Next(ctx)')
  })

  it('draws a frame for each step, tmux before the first call being frame 0', async () => {
    const { capability } = (await playableCapability('go', 'run-applications', run))!
    expect(coreFrames(capability).map((frame) => frame.done)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('shows a program with no Error handling or Cleanup as one view of itself', () => {
    const example = capabilityExample({ code: watch, lang: 'go', file: 'examples/control-mode-subscribe/main.go', repository: 'libtmux/libtmux-go', revision: '2de249b600d65218ee8b8fdc07c6b2b919242151' })
    expect(example.program).toBe('main.go')
    expect(HOME_VIEWS.map((view) => homeProgram(example, view))).toEqual(HOME_VIEWS.map(() => watch))
  })

  it('finds the second Next only when the step says which line', async () => {
    const { capability } = (await playableCapability('go', 'watch', watch))!
    const second = capability.steps.find((step) => step.id === 'next-change-1')!
    expect(statementLines(watch, second.anchor, '//', second.occurrence)).toBeDefined()
    expect(statementLines(watch, second.anchor)).toBeUndefined()
  })
})

describe('the frames the player draws', () => {
  it('are the replay\'s own: frame 0 before the first call and frame i the state after call i', async () => {
    const { capability } = await recorded()
    const frames = coreFrames(capability)
    expect(frames.map((frame) => frame.done)).toEqual([0, ...capability.steps.map((_, index) => index + 1)])
    expect(frames.every((frame) => frame.recorded)).toBe(true)
    expect(frames[0]!.sessions).toEqual([])
    expect(frames[2]!.sessions.map((session) => [session.id, session.name, session.windows.map((window) => window.panes.map((pane) => [pane.id, pane.command]))])).toEqual([['$0', 'demo', [[['%0', 'sh']]]]])
    // Each pane keeps the rectangle tmux gave it, which the drawing places it by.
    expect(frames[2]!.sessions[0]!.windows[0]!.panes[0]).toMatchObject({ left: 0, top: 0, width: 80, height: 24, active: true })
  })

  it('show tmux as each call left it: Split adds a pane, NewWindow a window, a selection moves the focus, and Kill leaves no server', async () => {
    const { capability } = await recorded()
    const frames = coreFrames(capability)
    const after = (id: string) => frames[capability.steps.findIndex((step) => step.id === id) + 1]!.sessions
    expect(after('split')[0]!.windows.map((window) => window.panes.map((pane) => pane.id))).toEqual([['%0', '%1']])
    expect(after('new-window')[0]!.windows.map((window) => [window.name, window.active])).toEqual([['editor', true], ['logs', false]])
    expect(after('select-pane')[0]!.windows[0]!.panes.map((pane) => [pane.id, pane.active])).toEqual([['%0', false], ['%1', true]])
    expect(after('select-window')[0]!.windows.map((window) => [window.name, window.active])).toEqual([['editor', false], ['logs', true]])
    expect(after('kill')).toEqual([])
  })

  it('say what each call changed, and when it changed nothing or sent nothing', async () => {
    const { capability } = await recorded()
    const before = (index: number) => (index === 0 ? capability.tmuxBefore : capability.steps[index - 1]!.tmux)
    const notes = Object.fromEntries(capability.steps.map((step, index) => [step.id, stepNote(step, before(index))]))
    expect(notes).toEqual({
      'new-server': 'tmux after tmux.NewServer: no server is running; the call sent no command.',
      'new-session': 'tmux after Server.NewSession: added session demo.',
      'resolve-window': 'tmux after Session.ResolveActiveWindow: unchanged.',
      rename: 'tmux after Window.Rename: renamed window 0:sh to 0:editor.',
      'resolve-pane': 'tmux after Window.ResolveActivePane: unchanged.',
      split: 'tmux after Pane.Split: added pane %1 to window 0:editor.',
      'new-window': 'tmux after Session.NewWindow: added window 1:logs.',
      'send-keys': 'tmux after Pane.SendKeys: sent keys to pane %1.',
      wait: 'tmux after Pane.WaitForText: read pane %1.',
      'select-pane': 'tmux after Pane.Select: selected pane %1 in window 0:editor.',
      'select-window': 'tmux after Window.Select: selected window 1:logs.',
      snapshot: 'tmux after Server.Snapshot: unchanged.',
      'pane-by-id': 'tmux after Snapshot.PaneByID: unchanged, the call sent no command.',
      'pane-window': 'tmux after Pane.Window: unchanged, the call sent no command.',
      'window-session': 'tmux after Window.Session: unchanged, the call sent no command.',
      kill: 'tmux after Server.Kill: the server has exited.',
    })
  })

  it('name the window that came and went inside Run', async () => {
    const run = (await coreRecordingFor('go'))!.capabilities['run-applications']!
    const index = run.steps.findIndex((step) => step.label === 'Session.Run')
    expect(stepNote(run.steps[index]!, run.steps[index - 1]!.tmux)).toBe('tmux after Session.Run: unchanged. tmux held window @1 while the call ran and removed it before it returned.')
  })
})

describe('what a step shows of the commands it sent', () => {
  it('lists the commands, and counts the identity checks the library made before them apart', async () => {
    const { capability } = await recorded()
    const session = visibleCommands(capability.steps[1]!)
    expect(session.commands.map((command) => command.tmux.split(' ')[0])).toEqual(['list-sessions', 'new-session', 'list-sessions'])
    expect(session.probes).toBeGreaterThan(0)
    expect(session.commands.every((command) => command.role === 'command')).toBe(true)
    expect(visibleCommands(capability.steps[0]!)).toEqual({ commands: [], probes: 0 })
  })
})

/** What the page's code block draws, for a test: each line in the element Expressive Code gives it. */
const Code = createComponent((_result: unknown, props: { code: string; lang: string }) => renderTemplate`<pre data-lang="${props.lang}"><code>${props.code.split('\n').map((line) => renderTemplate`<div class="ec-line"><div class="code">${line}</div></div>`)}</code></pre>`)
const PARTS = ['components/HomeExample.astro', 'components/replay/TmuxScreen.astro', 'components/replay/ReplayControls.astro']

describe('the player component', () => {
  const windows: Window[] = []
  afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

  const template = loadAstroTemplate('components/core/CorePlayer.astro', { real: PARTS, modules: { 'astro-expressive-code/components': { Code } } })
  const component = readFileSync(new URL('../src/components/core/CorePlayer.astro', import.meta.url), 'utf8')
  const commonjs = (source: string) => transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText
  // The page's script imports the shared player; the stand-in `require` hands it the player's own source, evaluated beside it.
  const script = `var exports = {};\nvar playerExports = {};\n(function (exports) {\n${commonjs(readFileSync(new URL('../src/lib/replay-player.ts', import.meta.url), 'utf8'))}\n})(playerExports);\nvar require = function (name) { if (/replay-player$/.test(name)) return playerExports; throw new Error('unexpected import ' + name) };\n${commonjs(/<script>([\s\S]*?)<\/script>/.exec(component)![1]!)}`

  async function mount({ run = false, reduced = true }: { run?: boolean; reduced?: boolean } = {}) {
    const { recording, capability } = await recorded()
    const win = new Window({ url: 'https://libtmux.org/go/latest/' })
    windows.push(win)
    win.document.body.innerHTML = await renderAstroTemplate(await template, { props: { port: 'go', language: 'Go', example, recording, capability } })
    const document = win.document as unknown as Document
    // Binding is the page's script running after the markup has been drawn.
    const bind = () => {
      const target = win as unknown as { matchMedia: (query: string) => { matches: boolean }; IntersectionObserver?: unknown; requestAnimationFrame: (callback: () => void) => void }
      target.matchMedia = (query: string) => ({ matches: /reduced-motion/.test(query) ? reduced : true })
      target.IntersectionObserver = undefined
      win.eval(`(function() {\n${script}\n})()`)
    }
    if (run) bind()
    return { win, document, capability, bind }
  }

  const shown = (document: Document, selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => !element.hidden && !element.hasAttribute('data-off'))
  const lit = (document: Document, view: string) => [...document.querySelectorAll(`[data-home-view="${view}"] .ec-line`)].flatMap((line, index) => (line.classList.contains('is-current') ? [index + 1] : []))
  const click = (win: Window, element: Element) => element.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event)
  const over = (win: Window, element: Element, type = 'mouseover') => element.dispatchEvent(new win.MouseEvent(type, { bubbles: true }) as unknown as Event)
  const key = (win: Window, element: Element, name: string) => element.dispatchEvent(new win.KeyboardEvent('keydown', { key: name, bubbles: true }) as unknown as Event)
  const count = (document: Document) => document.querySelector('[data-count]')!.textContent

  it('fills HomeExample\'s stage: the program in every view, the tmux and the result beside it, the controls under both', async () => {
    const { document } = await mount()
    const stage = document.querySelector('.home-example-stage')!
    expect([...stage.children].map((child) => child.className)).toEqual(['home-example-code', 'core-player__side'])
    expect([...stage.querySelector('.home-example-code')!.children].map((child) => child.getAttribute('data-home-view') ?? child.className)).toEqual(['concise', 'errors', 'cleanup', 'full', 'home-example-options home-example-toolbar'])
    expect(stage.getAttribute('tabindex')).toBe('0')
    expect(document.querySelector('.home-example-player')!.contains(document.querySelector('.mcp-replay__controls'))).toBe(true)
    expect(document.querySelector('.home-example-player')!.classList.contains('not-prose')).toBe(true)
  })

  it('keeps the Error handling and Cleanup toggles in the code panel, below the code and outside what scrolls', async () => {
    const { document } = await mount()
    const panel = document.querySelector('.home-example-code')!
    const toolbar = document.querySelector('.home-example-toolbar')!
    expect(toolbar.parentElement, 'the toolbar belongs to the code panel').toBe(panel)
    expect(panel.lastElementChild, 'at the panel\'s bottom edge').toBe(toolbar)
    for (const pre of document.querySelectorAll('pre')) expect(pre.contains(toolbar), 'not in the code\'s scroll container').toBe(false)
    expect([...toolbar.querySelectorAll('label')].map((label) => label.textContent!.trim())).toEqual(['+ Error handling', '+ Cleanup'])
    expect(toolbar.querySelector('legend')!.textContent).toBe('Example details')
    expect(document.querySelector('.home-example-heading'), 'no row of its own above the panel').toBeNull()
    expect(document.querySelector('.home-example-player')!.contains(toolbar)).toBe(true)
  })

  it('draws the toolbar as one row under the code that the code\'s height gives up, so the block is shorter and nothing moves when it toggles', () => {
    const css = readFileSync(new URL('../src/styles/core-player.css', import.meta.url), 'utf8')
    const example = readFileSync(new URL('../src/components/HomeExample.astro', import.meta.url), 'utf8')
    expect(example).toMatch(/\.home-example-code \{[^}]*grid-template-rows: minmax\(0, 1fr\) auto;/)
    expect(example).toMatch(/\.home-example-toolbar \{[^}]*grid-row: 2;[^}]*\}/)
    expect(example).toMatch(/\.home-example-code:has\(> \.home-example-toolbar\) \{ --home-toolbar-row: 1\.5rem; \}/)
    expect(css, 'the stacked code gives up the toolbar\'s row').toMatch(/height: calc\(17rem - var\(--home-toolbar-row, 0rem\)\);/)
    for (const host of ['HomeIntro', 'PortLanding', 'CoreShowcase']) {
      expect(readFileSync(new URL(`../src/components/${host}.astro`, import.meta.url), 'utf8'), host).toMatch(/calc\(34rem - var\(--home-toolbar-row, 0rem\)\)/)
    }
    expect(example, 'the toolbar is not placed over the code').not.toMatch(/\.home-example-(options|toolbar) \{[^}]*position: (absolute|fixed|sticky)/)
    // The wide stage keeps its height; the code's row, not the stage, gives up the toolbar's.
    expect(css).toMatch(/\.home-example-stage > \.home-example-code,[^{]*\{[^}]*height: 100%;/)
    expect(css).toMatch(/@container core-player \(min-width: 44rem\) \{[\s\S]*grid-template-rows: minmax\(0, 1fr\);\s*height: 35rem;/)
  })

  it('draws one frame and one result for the state before the first call and each call, and shows the first', async () => {
    const { document } = await mount()
    const { capability } = await recorded()
    const frames = ['0', ...capability.steps.map((_, index) => String(index + 1))]
    expect([...document.querySelectorAll('.core-player__tmux [data-frame]')].map((frame) => frame.getAttribute('data-frame'))).toEqual(frames)
    expect(shown(document, '.core-player__tmux [data-frame]').map((frame) => frame.dataset.frame)).toEqual(['0'])
    expect(document.querySelectorAll('.core-player__tmux .mcp-tmux')).toHaveLength(frames.length)
    expect([...document.querySelectorAll('.core-result')].map((result) => result.getAttribute('data-result'))).toEqual(frames)
    // The drawings are the replay's own, so their SVG ids must not collide with another player's on the page.
    const ids = [...document.querySelectorAll('.core-player__tmux [id]')].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith('cp-go-'))).toBe(true)
  })

  it('says what each call returned, and lists the commands with tmux\'s replies, collapsed', async () => {
    const { document } = await mount()
    const result = document.querySelector('[data-result="2"]')!
    expect(result.querySelector('.core-result__title')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Server.NewSession returned tmux.Session')
    expect(JSON.parse(result.querySelector('.core-result__value pre')!.textContent!)).toEqual({ id: '$0', name: 'demo' })
    const details = result.querySelector('details.core-result__tmux') as HTMLDetailsElement
    expect(details.open).toBe(false)
    const change = details.querySelector('li.is-change')!
    expect(change.querySelector('.core-commands__sent')!.textContent).toBe('new-session -P -F#{session_id} -sdemo -d')
    expect(change.querySelector('.core-commands__reply')!.textContent).toBe('$0')
    const refused = details.querySelector('.is-refused')!
    expect(refused.textContent, 'a refusal is shown as the reply').toMatch(/error connecting to/)
    expect(details.querySelector('.core-commands__note')!.textContent).toMatch(/asked tmux about itself \d+ times/)
    expect(document.querySelector('[data-result="1"]')!.textContent).toContain('The call sent no tmux command.')
  })

  it('sets a returned value at the size of the program shown beside it, in each view', async () => {
    const { document, win } = await mount({ run: true })
    const side = document.querySelector<HTMLElement>('.core-player__side')!
    const program = (view: string) => document.querySelector<HTMLElement>(`[data-home-view="${view}"] pre code`)!
    program('concise').style.fontSize = '12px'
    program('errors').style.fontSize = '13px'
    click(win, document.querySelector('[data-mark="1"]')!)
    expect(side.style.getPropertyValue('--core-program-size')).toBe('12px')
    const errors = document.querySelector<HTMLInputElement>('[data-example-errors]')!
    errors.checked = true
    errors.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event)
    expect(side.style.getPropertyValue('--core-program-size'), 'the program with error handling is the one shown').toBe('13px')
  })

  it('has no info button, popover or noscript note about how the run was recorded, and no hint above the program', async () => {
    const { document } = await mount()
    expect(document.querySelector('[data-hint]')).toBeNull()
    expect(document.querySelector('[data-controls] [popovertarget]')).toBeNull()
    expect(document.querySelector('[popover]')).toBeNull()
    expect(document.querySelector('.mcp-provenance')).toBeNull()
    expect(document.body.innerHTML).not.toMatch(/Recorded by running this program|How this was recorded/)
  })

  it('is drawn at the state the script first shows, so binding the script changes nothing on screen', async () => {
    const { document, bind } = await mount({ reduced: false })
    const onScreen = () => ({
      frames: shown(document, '.core-player__tmux [data-frame]').map((frame) => frame.dataset.frame),
      results: shown(document, '.core-result').map((result) => result.dataset.result),
      count: count(document),
      current: document.querySelector('[data-mark][aria-current="step"]')?.getAttribute('data-mark'),
      filled: document.querySelector<HTMLElement>('[data-fill]')!.style.width,
      controls: document.querySelector<HTMLElement>('[data-controls]')!.hidden,
      done: [...document.querySelectorAll('[data-mark].is-done')].map((mark) => mark.getAttribute('data-mark')),
    })
    const drawn = onScreen()
    bind()
    expect(onScreen()).toEqual(drawn)
    expect(drawn.frames).toEqual(['0'])
    expect(drawn.results).toEqual(['0'])
    expect(drawn.count).toMatch(/^0\//)
  })

  it('keeps the finished state for a page with no script, and for a reader who asks for less motion until the script binds', () => {
    const css = readFileSync(new URL('../src/styles/core-player.css', import.meta.url), 'utf8')
    const controls = readFileSync(new URL('../src/styles/mcp-replay.css', import.meta.url), 'utf8')
    expect(css).toMatch(/html:not\(\[data-js\]\) \.core-player__tmux > \.mcp-frame:first-child \{\s*display: none;/)
    expect(css).toMatch(/html:not\(\[data-js\]\) \.core-player__tmux > \.mcp-frame\[data-off\]:last-child \{\s*display: block;/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*:not\(\[data-live\]\) \.core-player__tmux > \.mcp-frame:last-child,[^@]*visibility: visible;/)
    expect(controls).toMatch(/html:not\(\[data-js\]\) \.mcp-replay__controls \{\s*display: none;/)
  })

  it('hides what it has not bound: the pin buttons wait for the script, and the controls take their place from the first paint', async () => {
    const { document } = await mount()
    expect(document.querySelector<HTMLElement>('[data-controls]')!.hidden).toBe(false)
    expect([...document.querySelectorAll<HTMLElement>('[data-pin]')].every((pin) => pin.hidden)).toBe(true)
    // A dot for tmux before the first call, then one per call.
    expect(document.querySelectorAll('[data-mark]')).toHaveLength((await recorded()).capability.steps.length + 1)
    expect(document.querySelector<HTMLElement>('[data-mark="0"]')!.style.left).toBe('0%')
  })

  it('marks the call that is current in the program the reader sees, and follows the player', async () => {
    const { document, win, capability } = await mount({ run: true })
    const view = viewSteps(capability, code('concise'))
    const calls = view.length
    expect(count(document)).toBe(`${calls}/${calls}`)
    const expected = (position: number) => Array.from({ length: view[position]!.lines[1] - view[position]!.lines[0] + 1 }, (_, offset) => view[position]!.lines[0] + offset)
    expect(lit(document, 'concise')).toEqual(expected(calls - 1))
    click(win, document.querySelector('[data-mark="1"]')!)
    expect(lit(document, 'concise')).toEqual(expected(0))
    expect(shown(document, '[data-result]').map((result) => result.dataset.result)).toEqual(['1'])
    key(win, document.querySelector('.home-example-stage')!, 'Home')
    expect(lit(document, 'concise'), 'before the first call no call is marked').toEqual([])
    expect(shown(document, '[data-result]').map((result) => result.dataset.result)).toEqual(['0'])
  })

  it('previews a call on hover and pins it on a click, and lets go on Escape', async () => {
    const { document, win } = await mount({ run: true })
    const stage = document.querySelector('.home-example-stage')!
    click(win, document.querySelector('[data-mark="1"]')!)
    const run = [...document.querySelectorAll('[data-home-view="concise"] .ec-line.is-call')].find((line) => line.textContent!.includes('left.Split('))!
    const split = (await recorded()).capability.steps.findIndex((step) => step.id === 'split') + 1
    over(win, run)
    expect(shown(document, '.core-player__tmux [data-frame]').map((frame) => frame.dataset.frame)).toEqual([String(split)])
    expect(count(document), 'hovering previews and moves nothing').toBe(`1/${(await recorded()).capability.steps.length - 1}`)
    over(win, run, 'mouseout')
    expect(shown(document, '.core-player__tmux [data-frame]').map((frame) => frame.dataset.frame)).toEqual(['1'])
    click(win, run)
    expect([...document.querySelectorAll('[data-home-view="concise"] .ec-line.is-pinned')].length).toBeGreaterThan(0)
    expect([...document.querySelectorAll('.core-result:not([data-off]) [data-pin]')].map((pin) => pin.getAttribute('aria-pressed'))).toEqual(['true'])
    key(win, stage, 'Escape')
    expect(shown(document, '.core-player__tmux [data-frame]').map((frame) => frame.dataset.frame)).toEqual(['1'])
  })

  it('shows a window its label names, and the client\'s window again at the next call', async () => {
    const { document, win, capability } = await mount({ run: true })
    const made = String(capability.steps.findIndex((step) => step.label === 'Session.NewWindow') + 1)
    click(win, document.querySelector(`[data-mark="${made}"]`)!)
    const frame = document.querySelector(`[data-frame="${made}"]`)!
    const drawn = () => [...frame.querySelectorAll<HTMLElement>('[data-view]')].filter((view) => !view.hidden).map((view) => view.dataset.view)
    expect(drawn()).toEqual(['$0/@0'])
    click(win, frame.querySelector('.mcp-tmux__window[data-show="$0/@1"]')!)
    expect(drawn()).toEqual(['$0/@1'])
    expect(frame.querySelector('.mcp-tmux')!.classList.contains('is-peeking')).toBe(true)
    expect(shown(document, '.core-player__tmux [data-frame]').map((each) => each.dataset.frame), 'a look moves no call').toEqual([made])
    click(win, document.querySelector('[data-action="forward"]')!)
    click(win, document.querySelector('[data-action="back"]')!)
    expect(drawn(), 'back at the call, the client\'s window').toEqual(['$0/@0'])
    expect(frame.querySelector('.mcp-tmux')!.classList.contains('is-peeking')).toBe(false)
  })

  it('names a dot\'s call and what it did in a tooltip, and previews it while the pointer is on the dot', async () => {
    const { document, win, capability } = await mount({ run: true })
    click(win, document.querySelector('[data-mark="1"]')!)
    const made = capability.steps.findIndex((step) => step.label === 'Session.NewWindow') + 1
    const dot = document.querySelector(`[data-mark="${made}"]`)!
    const tip = document.querySelector<HTMLElement>('[data-tip]')!
    expect(tip.hidden).toBe(true)
    dot.dispatchEvent(new win.MouseEvent('mouseenter') as unknown as Event)
    expect(tip.hidden).toBe(false)
    expect([tip.querySelector('code')!.textContent, tip.querySelector('span')!.textContent]).toEqual(['Session.NewWindow', 'added window 1:logs'])
    expect(shown(document, '.core-player__tmux [data-frame]').map((frame) => frame.dataset.frame)).toEqual([String(made)])
    expect(count(document), 'a preview moves nothing').toBe(`1/${viewSteps(capability, code('concise')).length}`)
    dot.dispatchEvent(new win.MouseEvent('mouseleave') as unknown as Event)
    expect(tip.hidden).toBe(true)
    expect(shown(document, '.core-player__tmux [data-frame]').map((frame) => frame.dataset.frame)).toEqual(['1'])
    document.querySelector('[data-mark="0"]')!.dispatchEvent(new win.FocusEvent('focus') as unknown as Event)
    expect(tip.textContent).toBe('tmux before the first call')
    // Each dot names the call it shows in the view on the page.
    expect(document.querySelector(`[data-mark="${made}"]`)!.getAttribute('aria-label')).toBe('Show the state after Session.NewWindow')
  })

  it('links a call and the library types it returned to the reference, and leaves the language\'s own types as text', async () => {
    const { document } = await mount()
    const title = document.querySelector('[data-result="2"] .core-result__title')!
    expect([...title.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Server.NewSession', '/go/latest/reference/tmux-server-newsession/'],
      ['Session', '/go/latest/reference/tmux-session/'],
    ])
    const waited = document.querySelector(`[data-frame="${(await recorded()).capability.steps.findIndex((step) => step.label === 'Pane.WaitForText') + 1}"] .mcp-frame__note`)!
    expect(waited.querySelector('a'), 'a call the API model lacks stays text').toBeNull()
    expect(waited.querySelector('code')!.textContent).toBe('Pane.WaitForText')
    const made = document.querySelector(`[data-frame="${(await recorded()).capability.steps.findIndex((step) => step.label === 'Session.NewWindow') + 1}"] .mcp-frame__note a`)!
    expect([made.textContent, made.getAttribute('href')]).toEqual(['Session.NewWindow', '/go/latest/reference/tmux-session-newwindow/'])
  })

  it('makes only the lines of a call answer to the pointer', async () => {
    const { document } = await mount({ run: true })
    const callLines = [...document.querySelectorAll('[data-home-view="concise"] .ec-line.is-call')].map((line) => line.textContent)
    expect(callLines.some((text) => text!.includes('package main'))).toBe(false)
    expect(callLines.some((text) => text!.includes('server, err := tmux.NewServer('))).toBe(true)
    expect(callLines).toHaveLength(viewSteps((await recorded()).capability, code('concise')).reduce((sum, step) => sum + step.lines[1] - step.lines[0] + 1, 0))
  })

  it('plays the last call, Kill, only when the program cleans up, and keeps the step in range when the choice goes away', async () => {
    const { document, win } = await mount({ run: true })
    const calls = (await recorded()).capability.steps.length
    expect(shown(document, '[data-mark]')).toHaveLength(calls)
    const cleanup = document.querySelector<HTMLInputElement>('[data-example-cleanup]')!
    cleanup.checked = true
    cleanup.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event)
    expect(shown(document, '[data-mark]')).toHaveLength(calls + 1)
    click(win, document.querySelector(`[data-mark="${calls}"]`)!)
    expect(count(document)).toBe(`${calls}/${calls}`)
    expect(lit(document, 'cleanup')).toHaveLength(1)
    expect(document.querySelector('[data-home-view="cleanup"] .ec-line.is-current')!.textContent).toContain('server.Kill(')
    cleanup.checked = false
    cleanup.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event)
    expect(count(document)).toBe(`${calls - 1}/${calls - 1}`)
    expect(shown(document, '[data-mark]')).toHaveLength(calls)
    click(win, document.querySelector('[data-mark="0"]')!)
    expect(count(document)).toBe(`0/${calls - 1}`)
  })

  it('uses the replay\'s keys on the stage and on a result\'s pin button, and no other key', async () => {
    const { document, win } = await mount({ run: true })
    const stage = document.querySelector('.home-example-stage')!
    const calls = (await recorded()).capability.steps.length - 1
    key(win, stage, 'Home')
    key(win, stage, 'ArrowRight')
    expect(count(document)).toBe(`1/${calls}`)
    key(win, document.querySelector('.core-result [data-pin]')!, 'ArrowRight')
    expect(count(document)).toBe(`2/${calls}`)
    key(win, stage, 'End')
    expect(count(document)).toBe(`${calls}/${calls}`)
    key(win, document.querySelector('.core-commands')!, 'Home')
    expect(count(document), 'a key meant for a list being scrolled is left alone').toBe(`${calls}/${calls}`)
  })

  it('draws no emoji, and keeps the page\'s own tokens', () => {
    const emoji = /[\p{Extended_Pictographic}⏩-⏺▶◀⛶️⃣]/u
    const css = readFileSync(new URL('../src/styles/core-player.css', import.meta.url), 'utf8')
    for (const source of [component, css]) expect(source.match(emoji)).toBeNull()
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g), 'colours come from the site\'s tokens').toBeNull()
    expect(css).toMatch(/color-mix\(in srgb, var\(--color-link\)/)
    expect(css, 'a tint marks the current call, not a bar on its edge').not.toMatch(/\.ec-line[^{]*\{[^}]*border-inline-start/)
  })
})

/** A port's quickstart recording, as its landing page plays it. */
const quickstartOf = async (port: string) => (await playableCapability(port, 'typed-graph', homeProgram(QUICKSTARTS[port]!.complete!, 'full')))!.capability
const stepNamed = (capability: Awaited<ReturnType<typeof quickstartOf>>, label: string) => {
  const index = capability.steps.findIndex((step) => step.label === label)
  return { step: capability.steps[index]!, before: index === 0 ? capability.tmuxBefore : capability.steps[index - 1]!.tmux, index }
}

describe('what a call changed in tmux', () => {
  it('names a window made in the background and the pane a split adds, and marks only those', async () => {
    const lua = await quickstartOf('lua')
    const made = stepNamed(lua, 'Session:new_window')
    const window = tmuxChanges(made.before, made.step.tmux)
    expect(window.phrases).toEqual(['added window 1:logs'])
    expect(window.marks).toEqual({ windows: ['@1'], panes: [], labels: [], sessions: [] })
    const split = stepNamed(lua, 'Pane:split')
    const pane = tmuxChanges(split.before, split.step.tmux)
    expect(pane.phrases).toEqual(['added pane %1 to window 0:editor'])
    expect(pane.marks).toEqual({ windows: [], panes: ['%1'], labels: [], sessions: [] })
  })

  it('folds a new session\'s first window into the session, and names a renamed session on its windows', async () => {
    const lua = await quickstartOf('lua')
    const started = stepNamed(lua, 'Server:new_session')
    const session = tmuxChanges(started.before, started.step.tmux)
    expect(session.phrases).toEqual(['added session demo'])
    expect(session.marks.windows).toEqual(['@0'])
    const go = (await coreRecordingFor('go'))!.capabilities.watch!
    const renamed = stepNamed(go, 'Session.Rename')
    expect(tmuxChanges(renamed.before, renamed.step.tmux)).toEqual({ marks: { windows: [], panes: [], labels: [], sessions: ['$0'] }, phrases: ['renamed session libtmux-control to control-example'] })
  })

  it('names nothing for a state that did not change, and a closed window only while its session lives', async () => {
    const lua = await quickstartOf('lua')
    const same = stepNamed(lua, 'Pane:send_keys')
    expect(tmuxChanges(same.before, same.step.tmux)).toEqual({ marks: { windows: [], panes: [], labels: [], sessions: [] }, phrases: [] })
    const go = (await coreRecordingFor('go'))!.capabilities['run-applications']!
    const streamed = stepNamed(go, 'Running.StreamTo')
    expect(tmuxChanges(streamed.before, streamed.step.tmux).phrases).toEqual(['closed window 1:sh'])
    const killed = stepNamed(go, 'Session.Kill')
    expect(tmuxChanges(killed.before, killed.step.tmux).phrases, 'the session takes its windows with it').toEqual(['closed session libtmux-run'])
  })
})

describe('what a call did to its panes\' contents', () => {
  it('reads the keys a call sent and the text tmux returned for a pane', async () => {
    const lua = await quickstartOf('lua')
    expect(paneActivity(stepNamed(lua, 'Pane:send_text').step)).toEqual({ typed: ['%1'], ran: [], reads: [] })
    const read = paneActivity(stepNamed(lua, 'Pane:wait_for_text').step).reads
    expect(read.map((entry) => entry.pane)).toEqual(['%1'])
    expect(read[0]!.text).toContain('hello from tmux')
    expect(read[0]!.text, 'trailing blank rows are not text').not.toMatch(/\s$/)
  })

  it('takes no capture that starts below the top of the screen for what a pane shows', () => {
    // No recording holds one now that F#'s quickstart has no Pane.run, so the step is made here.
    const capture = (flags: string, stdout: string) => ({ role: 'command', tmux: `capture-pane -t %0 -p ${flags}`, stdout, stderr: '', exit: 0 })
    const step = { commands: [capture('-S 0', 'the whole screen\n'), capture('-S 2', 'part of it\n')] } as unknown as Parameters<typeof paneActivity>[0]
    expect(paneActivity(step).reads).toEqual([{ pane: '%0', text: 'the whole screen' }])
  })

  it('names the panes a call typed into and read, but not a pane it removed again', async () => {
    const fsharp = await quickstartOf('fsharp')
    const sent = stepNamed(fsharp, 'Pane.sendAndWait')
    expect(stepChanges(sent.step, sent.before)).toEqual({ marks: { windows: [], panes: ['%1'], labels: [], sessions: [] }, phrases: ['sent keys to pane %1', 'read pane %1'] })
    const go = (await coreRecordingFor('go'))!.capabilities['run-applications']!
    const ran = stepNamed(go, 'Session.Run')
    expect(paneActivity(ran.step).ran, 'Run respawned the pane of the window it held').toEqual(['%1'])
    expect(stepChanges(ran.step, ran.before).phrases, 'that window was gone when Run returned').toEqual([])
    expect(stepNote(ran.step, ran.before)).toMatch(/: unchanged\. tmux held window @1/)
  })

  it('draws each pane with the text tmux last returned for it, from the call that read it on', async () => {
    const fsharp = await quickstartOf('fsharp')
    const frames = coreFrames(fsharp)
    const sent = stepNamed(fsharp, 'Pane.sendAndWait').index
    const paneIn = (frame: number) => frames[frame]!.sessions.flatMap((session) => session.windows).flatMap((window) => window.panes).find((pane) => pane.id === '%1')!
    expect(paneIn(sent).output, 'nothing read before it').toBeUndefined()
    expect(paneIn(sent + 1).output).toContain('hello from tmux')
    expect(paneIn(sent + 2).output, 'kept by the next call').toContain('hello from tmux')
  })
})

describe('the drawing an attached client sees', () => {
  const template = loadAstroTemplate('components/core/CorePlayer.astro', { real: PARTS, modules: { 'astro-expressive-code/components': { Code } } })
  const screen = loadAstroTemplate('components/replay/TmuxScreen.astro')
  const windows: Window[] = []
  afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })
  const page = async (html: string, url = 'https://libtmux.org/lua/latest/') => {
    const win = new Window({ url })
    windows.push(win)
    win.document.body.innerHTML = html
    return { win, document: win.document as unknown as Document }
  }
  const text = (elements: Iterable<Element>) => [...elements].map((element) => element.textContent)
  // What a frame's screen shows: the window drawn, and the status line's visible parts.
  const visible = (frame: Element) => ({
    views: [...frame.querySelectorAll<HTMLElement>('[data-view]')].filter((view) => !view.hidden).map((view) => view.dataset.view),
    windows: text([...frame.querySelectorAll<HTMLElement>('.mcp-client__session')].filter((group) => !group.hidden).flatMap((group) => [...group.querySelectorAll('.mcp-tmux__window')])),
    sessions: text([...frame.querySelectorAll<HTMLElement>('.mcp-client__session')].filter((group) => !group.hidden).flatMap((group) => [...group.querySelectorAll('.mcp-tmux__session')])),
    others: text([...frame.querySelectorAll<HTMLElement>('.mcp-client__other')].filter((other) => !other.hidden)),
  })

  it('shows the window the session is on, a window made in the background as a label, and one status line in every frame', async () => {
    const recording = (await coreRecordingFor('lua'))!
    const capability = await quickstartOf('lua')
    const { document } = await page(await renderAstroTemplate(await template, { props: { port: 'lua', language: 'Lua', example: QUICKSTARTS.lua!.complete!, recording, capability } }))
    const frame = (index: number) => document.querySelector(`[data-frame="${index}"]`)!
    const made = stepNamed(capability, 'Session:new_window').index + 1
    expect(visible(frame(made))).toEqual({ views: ['$0/@0'], windows: ['0:editor*', '1:logs'], sessions: ['[demo]'], others: [] })
    expect(text(frame(made).querySelectorAll('.mcp-tmux__window.is-changed')), 'the new window is marked in the status line').toEqual(['1:logs'])
    expect(text(frame(made).querySelectorAll('.mcp-tmux__window.is-current'))).toEqual(['0:editor*'])
    expect(frame(made).querySelectorAll('[data-view]'), 'every window is drawn, the others hidden').toHaveLength(2)
    expect(frame(made).querySelector('.mcp-tile.is-new')!.getAttribute('data-view'), 'the new window is outlined where it is drawn').toBe('$0/@1')
    const split = stepNamed(capability, 'Pane:split').index + 1
    expect(text(frame(split).querySelectorAll('[data-view]:not([hidden]) .mcp-tile__pane.is-changed .mcp-pane__id'))).toEqual(['%1 sh'])
    expect(frame(split).querySelectorAll('.mcp-tmux__window.is-changed'), 'a change on screen needs no flag').toHaveLength(0)
    // Every frame keeps one status line or the placeholder of the same size, so a frame is as tall as the next.
    const frames = [...document.querySelectorAll('.mcp-frame')]
    expect(frames.every((each) => each.querySelectorAll('.mcp-client__status').length + each.querySelectorAll('.mcp-tmux__screen--placeholder').length === 1)).toBe(true)
    expect(frame(0).querySelector('[data-view]'), 'no server, no windows').toBeNull()
  })

  it('lets two panes meet at the line tmux draws between them', async () => {
    const recording = (await coreRecordingFor('lua'))!
    const capability = await quickstartOf('lua')
    const { document } = await page(await renderAstroTemplate(await template, { props: { port: 'lua', language: 'Lua', example: QUICKSTARTS.lua!.complete!, recording, capability } }))
    const split = document.querySelector(`[data-frame="${stepNamed(capability, 'Pane:split').index + 1}"]`)!
    const [left, right] = [...split.querySelectorAll<HTMLElement>('[data-view]:not([hidden]) .mcp-tile__pane')].map((pane) => ({ left: parseFloat(pane.style.left), width: parseFloat(pane.style.width) }))
    expect(left!.left).toBe(0)
    expect(right!.left).toBeCloseTo(left!.left + left!.width, 6)
    expect(right!.left + right!.width).toBeCloseTo(100, 6)
  })

  it('moves the view with a selection, marks the window selected, and keeps a split\'s active pane bold', async () => {
    const { recording, capability } = await recorded()
    const { document } = await page(await renderAstroTemplate(await template, { props: { port: 'go', language: 'Go', example, recording, capability } }), 'https://libtmux.org/go/latest/')
    const frame = (id: string) => document.querySelector(`[data-frame="${capability.steps.findIndex((step) => step.id === id) + 1}"]`)!
    const active = (id: string) => text(frame(id).querySelectorAll('[data-view]:not([hidden]) .mcp-tile__pane.is-active .mcp-pane__id'))
    expect(active('split'), 'the split keeps the pane it split active').toEqual(['%0 sh'])
    expect(active('select-pane')).toEqual(['%1 sh'])
    expect(text(frame('select-pane').querySelectorAll('[data-view]:not([hidden]) .mcp-tile__pane.is-changed .mcp-pane__id'))).toEqual(['%1 sh'])
    expect(visible(frame('select-window')).windows).toEqual(['0:editor', '1:logs*'])
    expect(visible(frame('select-window')).views).toEqual(['$0/@1'])
    expect(text(frame('select-window').querySelectorAll('.mcp-tmux__window.is-changed'))).toEqual(['1:logs*'])
    expect(frame('new-session').querySelectorAll('.mcp-tile__pane.is-active'), 'a window of one pane needs no mark').toHaveLength(0)
    const placeholder = (selector: string) => document.querySelector(`${selector} .mcp-tmux__screen--placeholder`)?.textContent?.trim()
    expect(placeholder('[data-frame="0"]')).toBe('No tmux server yet')
    expect(placeholder(`[data-frame="${capability.steps.length}"]`)).toBe('No sessions')
    expect(document.querySelectorAll('.mcp-tmux__screen--placeholder'), 'before the first call, after NewServer, and after Kill').toHaveLength(3)
  })

  // No recorded program makes a second session, so this frame is written by hand: three sessions, listed out of id order.
  const pane = (id: string) => ({ id, command: 'sh', left: 0, top: 0, width: 80, height: 24, active: true })
  const sessions = {
    done: 3,
    sessions: [
      { id: '$2', name: 'build', windows: [{ id: '@2', index: 0, name: 'make', active: true, panes: [pane('%2')] }] },
      { id: '$0', name: 'demo', windows: [{ id: '@0', index: 0, name: 'editor', active: true, panes: [pane('%0')] }, { id: '@3', index: 1, name: 'logs', active: false, panes: [pane('%3')] }] },
      { id: '$1', name: 'scratch', windows: [{ id: '@1', index: 0, name: 'sh', active: true, panes: [pane('%1')] }] },
    ],
  }

  it('stays on the oldest session, and names every other session at the status line\'s end', async () => {
    const { document } = await page(await renderAstroTemplate(await screen, { props: { frame: sessions, hadSessions: true, client: true, marks: { windows: ['@2'], panes: ['%2'], labels: [], sessions: [] } } }))
    const root = document.querySelector('.mcp-tmux')!
    expect(root.getAttribute('data-client-view')).toBe('$0/@0')
    expect(visible(root)).toEqual({ views: ['$0/@0'], windows: ['0:editor*', '1:logs'], sessions: ['[demo]'], others: ['build', 'scratch'] })
    expect(text(root.querySelectorAll('.mcp-client__other.is-changed')), 'a session the call added a window to is marked').toEqual(['build'])
    expect(root.querySelectorAll('[data-view]')).toHaveLength(4)
  })

  it('shows a window or a session a button names until it is reset, and says when the view is not the client\'s', async () => {
    const { win, document } = await page(await renderAstroTemplate(await screen, { props: { frame: sessions, hadSessions: true, client: true } }))
    const { bindClientViews } = await import('../src/lib/replay-player')
    const root = document.querySelector<HTMLElement>('.mcp-tmux')!
    const views = bindClientViews(document.body as unknown as HTMLElement)
    const press = (selector: string) => document.querySelector(selector)!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event)
    press('.mcp-tmux__window[data-show="$0/@3"]')
    expect(visible(root)).toEqual({ views: ['$0/@3'], windows: ['0:editor*', '1:logs'], sessions: ['[demo]'], others: ['build', 'scratch'] })
    expect(text(root.querySelectorAll('.mcp-tmux__window.is-current')), 'the shown window is current in the status line, the * stays').toEqual(['1:logs'])
    expect(root.classList.contains('is-peeking')).toBe(true)
    press('.mcp-client__other[data-show="$2/@2"]')
    expect(visible(root)).toEqual({ views: ['$2/@2'], windows: ['0:make*'], sessions: ['[build]'], others: ['demo', 'scratch'] })
    views.reset()
    expect(visible(root)).toEqual({ views: ['$0/@0'], windows: ['0:editor*', '1:logs'], sessions: ['[demo]'], others: ['build', 'scratch'] })
    expect(root.classList.contains('is-peeking')).toBe(false)
  })
})

describe('the variant toggles of the other hosts of HomeExample', () => {
  const template = loadAstroTemplate('components/HomeExample.astro', { modules: { 'astro-expressive-code/components': { Code } } })
  const render = async (props: Record<string, unknown>) => {
    const win = new Window({ url: 'https://libtmux.org/' })
    win.document.body.innerHTML = await renderAstroTemplate(await template, { props: { port: 'go', language: 'Go', example, ...props } })
    return win.document as unknown as Document
  }

  it('puts them under the code of the homepage example and of a fixed example, with the heading left to the title alone', async () => {
    for (const props of [{}, { heading: false, fixed: true }]) {
      const document = await render(props)
      const panel = document.querySelector('.home-example-code')!
      expect(panel.lastElementChild, JSON.stringify(props)).toBe(document.querySelector('.home-example-toolbar'))
      expect(panel.querySelectorAll('.home-example-view')).toHaveLength(4)
      expect(document.querySelector('.home-example-heading .home-example-options')).toBeNull()
      expect(document.querySelector('pre')!.closest('.home-example-toolbar')).toBeNull()
    }
    const document = await render({ heading: false })
    expect(document.querySelector('.home-example-heading'), 'a block with no title and no hint has no empty row above it').toBeNull()
    expect((await render({})).querySelector('.home-example-heading h2')!.textContent).toBe('Start with Go')
  })

  it('draws no toolbar for a program with one view', async () => {
    const document = await render({ options: false, views: ['concise'] })
    expect(document.querySelector('.home-example-toolbar')).toBeNull()
    expect(document.querySelector('[data-example-errors]')).toBeNull()
  })
})
