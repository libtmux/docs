import { readFileSync } from 'node:fs'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { Window } from 'happy-dom'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { coreFrames, coreRecordingFor, playableCapability, stepNote, viewSteps, visibleCommands } from '../src/lib/core-player'
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
    expect(indexes('concise')).toEqual([0, 1, 2])
    expect(indexes('errors')).toEqual([0, 1, 2])
    expect(indexes('cleanup')).toEqual([0, 1, 2, 3])
    expect(indexes('full')).toEqual([0, 1, 2, 3])
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
    expect(lineOf('full', 'run'), 'the error handling and cleanup lines above Run move it down').not.toEqual(lineOf('concise', 'run'))
  })

  it('keeps the calls\' lines apart, and in the order the source has them (not the order they run)', async () => {
    const { capability } = await recorded()
    const lines = viewSteps(capability, code('full')).map((step) => step.lines)
    const ordered = [...lines].sort((a, b) => a[0] - b[0])
    for (let position = 1; position < ordered.length; position++) expect(ordered[position]![0]).toBeGreaterThan(ordered[position - 1]![1])
    expect(lines.map((range) => range[0]), 'the deferred Kill is above Run in the source').not.toEqual(ordered.map((range) => range[0]))
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
    expect(await coreRecordingFor('rs')).toBeUndefined()
  })
})

describe('the frames the player draws', () => {
  it('are the replay\'s own: frame 0 before the first call and frame i the state after call i', async () => {
    const { capability } = await recorded()
    const frames = coreFrames(capability)
    expect(frames.map((frame) => frame.done)).toEqual([0, 1, 2, 3, 4])
    expect(frames.every((frame) => frame.recorded)).toBe(true)
    expect(frames[0]!.sessions).toEqual([])
    expect(frames[2]!.sessions.map((session) => [session.id, session.name, session.windows.map((window) => window.panes.map((pane) => [pane.id, pane.command]))])).toEqual([['$0', 'demo', [[['%0', 'sh']]]]])
    // Each pane keeps the rectangle tmux gave it, which the drawing places it by.
    expect(frames[2]!.sessions[0]!.windows[0]!.panes[0]).toMatchObject({ left: 0, top: 0, width: 80, height: 24, active: true })
  })

  it('show tmux as the call left it, not as the call needed it: Run\'s window is gone, and Kill leaves no server', async () => {
    const { capability } = await recorded()
    const frames = coreFrames(capability)
    expect(frames[3]!.sessions[0]!.windows).toHaveLength(1)
    expect(frames[4]!.sessions).toEqual([])
  })

  it('say when a call changed nothing, and name the window that came and went inside Run', async () => {
    const { capability } = await recorded()
    const before = (index: number) => (index === 0 ? capability.tmuxBefore : capability.steps[index - 1]!.tmux)
    const notes = capability.steps.map((step, index) => stepNote(step, before(index)))
    expect(notes[0]).toBe('tmux after tmux.NewServer: no server is running; the call sent no command.')
    expect(notes[1]).toBe('tmux after Server.NewSession.')
    expect(notes[2]).toBe('tmux after Session.Run: unchanged. tmux held window @1 while the call ran and removed it before it returned.')
    expect(notes[3]).toBe('tmux after Server.Kill: the server has exited.')
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
    if (run) {
      const target = win as unknown as { matchMedia: (query: string) => { matches: boolean }; IntersectionObserver?: unknown; requestAnimationFrame: (callback: () => void) => void }
      target.matchMedia = (query: string) => ({ matches: /reduced-motion/.test(query) ? reduced : true })
      target.IntersectionObserver = undefined
      win.eval(`(function() {\n${script}\n})()`)
    }
    return { win, document, capability }
  }

  const shown = (document: Document, selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => !element.hidden)
  const lit = (document: Document, view: string) => [...document.querySelectorAll(`[data-home-view="${view}"] .ec-line`)].flatMap((line, index) => (line.classList.contains('is-current') ? [index + 1] : []))
  const click = (win: Window, element: Element) => element.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event)
  const over = (win: Window, element: Element, type = 'mouseover') => element.dispatchEvent(new win.MouseEvent(type, { bubbles: true }) as unknown as Event)
  const key = (win: Window, element: Element, name: string) => element.dispatchEvent(new win.KeyboardEvent('keydown', { key: name, bubbles: true }) as unknown as Event)
  const count = (document: Document) => document.querySelector('[data-count]')!.textContent

  it('fills HomeExample\'s stage: the program in every view, the tmux and the result beside it, the controls under both', async () => {
    const { document } = await mount()
    const stage = document.querySelector('.home-example-stage')!
    expect([...stage.children].map((child) => child.getAttribute('data-home-view') ?? child.className)).toEqual(['concise', 'errors', 'cleanup', 'full', 'core-player__side'])
    expect(stage.getAttribute('tabindex')).toBe('0')
    expect(document.querySelector('.home-example-player')!.contains(document.querySelector('.mcp-replay__controls'))).toBe(true)
    expect(document.querySelector('.home-example-player')!.classList.contains('not-prose')).toBe(true)
  })

  it('draws one frame and one result for the state before the first call and each call, and shows the last', async () => {
    const { document } = await mount()
    expect([...document.querySelectorAll('.core-player__tmux [data-frame]')].map((frame) => frame.getAttribute('data-frame'))).toEqual(['0', '1', '2', '3', '4'])
    expect(shown(document, '.core-player__tmux [data-frame]').map((frame) => frame.dataset.frame)).toEqual(['4'])
    expect(document.querySelectorAll('.core-player__tmux .mcp-tmux')).toHaveLength(5)
    expect([...document.querySelectorAll('.core-result')].map((result) => result.getAttribute('data-result'))).toEqual(['0', '1', '2', '3', '4'])
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
    expect(details.querySelector('.core-commands__note')!.textContent).toMatch(/asked tmux who it is \d+ times/)
    expect(document.querySelector('[data-result="1"]')!.textContent).toContain('The call sent no tmux command.')
  })

  it('hides what it has not bound: the controls, the pin buttons and the hint wait for the script', async () => {
    const { document } = await mount()
    expect(document.querySelector<HTMLElement>('[data-controls]')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('[data-hint]')!.hidden).toBe(true)
    expect([...document.querySelectorAll<HTMLElement>('[data-pin]')].every((pin) => pin.hidden)).toBe(true)
    expect(document.querySelectorAll('[data-mark]')).toHaveLength(4)
  })

  it('marks the call that is current in the program the reader sees, and follows the player', async () => {
    const { document, win, capability } = await mount({ run: true })
    expect(count(document)).toBe('3/3')
    const view = viewSteps(capability, code('concise'))
    const expected = (position: number) => Array.from({ length: view[position]!.lines[1] - view[position]!.lines[0] + 1 }, (_, offset) => view[position]!.lines[0] + offset)
    expect(lit(document, 'concise')).toEqual(expected(2))
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
    const run = [...document.querySelectorAll('[data-home-view="concise"] .ec-line.is-call')].find((line) => line.textContent!.includes('session.Run('))!
    over(win, run)
    expect(shown(document, '.core-player__tmux [data-frame]').map((frame) => frame.dataset.frame)).toEqual(['3'])
    expect(count(document), 'hovering previews and moves nothing').toBe('1/3')
    over(win, run, 'mouseout')
    expect(shown(document, '.core-player__tmux [data-frame]').map((frame) => frame.dataset.frame)).toEqual(['1'])
    click(win, run)
    expect(document.querySelector('[data-hint]')!.textContent).toMatch(/Pinned/)
    expect([...document.querySelectorAll('[data-home-view="concise"] .ec-line.is-pinned')].length).toBeGreaterThan(0)
    expect([...document.querySelectorAll('.core-result:not([hidden]) [data-pin]')].map((pin) => pin.getAttribute('aria-pressed'))).toEqual(['true'])
    key(win, stage, 'Escape')
    expect(shown(document, '.core-player__tmux [data-frame]').map((frame) => frame.dataset.frame)).toEqual(['1'])
    expect(document.querySelector('[data-hint]')!.textContent).toMatch(/Hover a call/)
  })

  it('makes only the lines of a call answer to the pointer', async () => {
    const { document } = await mount({ run: true })
    const callLines = [...document.querySelectorAll('[data-home-view="concise"] .ec-line.is-call')].map((line) => line.textContent)
    expect(callLines.some((text) => text!.includes('package main'))).toBe(false)
    expect(callLines.some((text) => text!.includes('server, err := tmux.NewServer('))).toBe(true)
    expect(callLines).toHaveLength(viewSteps((await recorded()).capability, code('concise')).reduce((sum, step) => sum + step.lines[1] - step.lines[0] + 1, 0))
  })

  it('plays the fourth call, Kill, only when the program cleans up, and keeps the step in range when the choice goes away', async () => {
    const { document, win } = await mount({ run: true })
    expect(shown(document, '[data-mark]')).toHaveLength(3)
    const cleanup = document.querySelector<HTMLInputElement>('[data-example-cleanup]')!
    cleanup.checked = true
    cleanup.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event)
    expect(shown(document, '[data-mark]')).toHaveLength(4)
    click(win, document.querySelector('[data-mark="4"]')!)
    expect(count(document)).toBe('4/4')
    expect(lit(document, 'cleanup')).toHaveLength(1)
    expect(document.querySelector('[data-home-view="cleanup"] .ec-line.is-current')!.textContent).toContain('server.Kill(')
    cleanup.checked = false
    cleanup.dispatchEvent(new win.Event('change', { bubbles: true }) as unknown as Event)
    expect(count(document)).toBe('3/3')
    expect(shown(document, '[data-mark]')).toHaveLength(3)
  })

  it('uses the replay\'s keys on the stage and on a result\'s pin button, and no other key', async () => {
    const { document, win } = await mount({ run: true })
    const stage = document.querySelector('.home-example-stage')!
    key(win, stage, 'Home')
    key(win, stage, 'ArrowRight')
    expect(count(document)).toBe('1/3')
    key(win, document.querySelector('.core-result [data-pin]')!, 'ArrowRight')
    expect(count(document)).toBe('2/3')
    key(win, stage, 'End')
    expect(count(document)).toBe('3/3')
    key(win, document.querySelector('.core-commands')!, 'Home')
    expect(count(document), 'a key meant for a list being scrolled is left alone').toBe('3/3')
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
