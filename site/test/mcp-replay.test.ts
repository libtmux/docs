import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { lastOutputLine, replayFrames, windowLabel, type Frame, type ReplayStep } from '../src/lib/mcp-replay'
import { EXAMPLES, mcpShowcase, transcriptFor } from '../src/lib/mcp-showcase'
import { parseLayout } from '../src/lib/tmux-layout-string'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const steps = async (port: string) => (await transcriptFor(port))!.steps as ReplayStep[]

/**
 * The recording's fields as `key=value` pairs, with the type kept (so `0` and
 * `"0"` and `true` differ), from the requests and results of the first `count` calls.
 */
function recorded(steps: ReplayStep[], count: number): Set<string> {
  const found = new Set<string>()
  const walk = (key: string, value: unknown) => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') found.add(`${key}=${typeof value}:${String(value)}`)
    else if (Array.isArray(value)) value.forEach((item) => walk(key, item))
    else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => walk(name, item))
  }
  steps.slice(0, count).forEach((step) => { walk('arguments', step.arguments); walk('result', step.structuredContent); walk('text', step.content) })
  // A layout names its panes, so the ids it carries are stated by it.
  for (const entry of [...found]) {
    const layout = /^(?:layout|window_layout)=string:(.*)$/s.exec(entry)?.[1]
    for (const pane of (layout ? parseLayout(layout)?.panes : undefined) ?? []) found.add(`id=string:${pane.id}`)
  }
  return found
}

/** The recording's field names that supply each field a frame holds. */
const SUPPLIED_BY: Record<string, string[]> = {
  id: ['id', 'paneId', 'windowId', 'killed'], name: ['name', 'session_name', 'session'], index: ['index'], active: ['active'],
  command: ['command'], path: ['path', 'cwd'], typed: ['command'], output: ['output'], layout: ['layout', 'window_layout'],
}

/**
 * Each field of each frame that the calls made by then do not state: a frame
 * after `k` calls may use only what the first `k` requests and results hold,
 * under the field name that supplies it. A count of windows or panes is not a
 * field; the preview draws a placeholder for it (see lib/mcp-replay.ts).
 */
function untraced(frames: Frame[], steps: ReplayStep[]): string[] {
  const missing: string[] = []
  for (const frame of frames) {
    const known = recorded(steps, frame.done)
    const check = (object: object) => {
      for (const [key, value] of Object.entries(object)) {
        if (typeof value === 'object' && value !== null) continue
        const names = SUPPLIED_BY[key]
        if (!names) { missing.push(`${frame.done}: unknown field ${key}`); continue }
        if (!names.some((name) => known.has(`${name}=${typeof value}:${String(value)}`))) missing.push(`${frame.done}: ${key}=${String(value)}`)
      }
    }
    for (const session of frame.sessions) {
      check(session)
      for (const window of session.windows) { check(window); window.panes.forEach(check) }
    }
  }
  return missing
}

/** Calls in each port's worked example, which the frames and the replay follow. */
const CALLS = { ts: 6, rs: 7 }

describe('the tmux state each recorded call leaves', () => {
  it('follows TypeScript: a session, a split, the layout it reports, then what each pane ran', async () => {
    const frames = replayFrames(await steps('ts'))
    expect(frames.map((frame) => frame.sessions.length)).toEqual([0, 1, 1, 1, 1, 1, 0])
    const created = frames[1]!.sessions[0]!
    expect(created).toMatchObject({ id: '$0', name: 'checks', windows: [{ id: '@0', panes: [{ id: '%0' }] }] })
    expect(created.windows[0]!.index, 'the result never states an index').toBeUndefined()
    const split = frames[2]!.sessions[0]!.windows[0]!
    expect(split.panes.map((pane) => pane.id)).toEqual(['%0', '%1'])
    expect(split.panes[1]).toMatchObject({ command: 'sh', path: '/home/user/project' })
    expect(split.layout, 'the split result states no geometry').toBeUndefined()
    expect(frames[3]).toMatchObject({ reading: 'windows' })
    const read = frames[3]!.sessions[0]!.windows[0]!
    expect(parseLayout(read.layout!)).toMatchObject({ width: 80, height: 24, panes: [{ id: '%0', x: 0, w: 40 }, { id: '%1', x: 41, w: 39 }] })
    expect(frames[4]!.sessions[0]!.windows[0]!.panes[0]).toMatchObject({ typed: 'pytest -q' })
    expect(frames[4]!.sessions[0]!.windows[0]!.panes[0]!.output).toMatch(/2 passed/)
    expect(frames[4]!.sessions[0]!.windows[0]!.panes[1]!.typed, 'the other pane has run nothing yet').toBeUndefined()
    const last = frames[5]!.sessions[0]!.windows[0]!.panes
    expect(last[1]).toMatchObject({ typed: 'cat checks.log' })
    expect(last[1]!.output).toMatch(/checks finished/)
    expect(last[0]!.output, 'the first pane keeps its own output').toMatch(/2 passed/)
    expect(frames[6]!.sessions).toEqual([])
  })

  it('follows Rust: the pane list names the first pane, the split adds one, tmux\'s window_layout gives the geometry', async () => {
    const frames = replayFrames(await steps('rs'))
    expect(frames.map((frame) => frame.sessions.length)).toEqual([0, 1, 1, 1, 1, 1, 1, 0])
    expect(frames[1]!.sessions[0]).toMatchObject({ id: '$0', name: 'checks' })
    expect(frames[1]!.sessions[0]!.windows[0]!.panes[0]!.id, 'create_session names no pane').toBeUndefined()
    expect(frames[2]).toMatchObject({ reading: 'panes' })
    expect(frames[2]!.sessions[0]!.windows[0]!.panes[0]).toMatchObject({ id: '%0', command: 'sh', path: '/home/user/project' })
    expect(frames[3]!.sessions[0]!.windows[0]!.panes.map((pane) => pane.id)).toEqual(['%0', '%1'])
    expect(frames[3]!.sessions[0]!.windows[0]!.layout).toBeUndefined()
    const read = frames[4]!.sessions[0]!.windows[0]!
    expect(parseLayout(read.layout!)!.panes.map((pane) => pane.id)).toEqual(['%0', '%1'])
    expect(frames[5]!.sessions[0]!.windows[0]!.panes[0]).toMatchObject({ typed: 'pytest -q' })
    expect(frames[6]!.sessions[0]!.windows[0]!.panes[1]).toMatchObject({ typed: 'cat checks.log' })
    expect(frames[7]!.sessions).toEqual([])
  })

  it.each(['ts', 'rs'] as const)('draws nothing for %s that the recording does not contain', async (port) => {
    const steps_ = await steps(port)
    expect(untraced(replayFrames(steps_), steps_)).toEqual([])
  })

  it.each(['ts', 'rs'] as const)('gives %s panes geometry only from a recorded layout that names every pane', async (port) => {
    const frames = replayFrames(await steps(port))
    for (const frame of frames) {
      for (const session of frame.sessions) for (const window of session.windows) {
        if (!window.layout) continue
        const parsed = parseLayout(window.layout)!
        expect(parsed.panes.map((pane) => pane.id).sort(), `frame ${frame.done}: the layout names the window's panes`).toEqual(window.panes.map((pane) => pane.id).sort())
      }
    }
    expect(frames.filter((frame) => frame.sessions[0]?.windows[0]?.layout).length, 'some frame has geometry').toBeGreaterThan(0)
    expect(frames.find((frame) => (frame.sessions[0]?.windows[0]?.panes.length ?? 0) > 1 && !frame.sessions[0]!.windows[0]!.layout), 'a split with no layout read yet exists').toBeDefined()
  })

  it('has a control: a value the recording lacks, or states under another field, or only later, is reported', async () => {
    const steps_ = await steps('ts')
    const frames = replayFrames(steps_)
    frames[1]!.sessions[0]!.windows[0]!.index = 0 // "0" is in the recording, but as an exit status, never an index
    frames[1]!.sessions[0]!.name = 'invented'
    frames[1]!.sessions[0]!.windows[0]!.active = true
    const later = frames[4]!.sessions[0]!.windows[0]!.panes[0]!.output! // said only by call 4
    frames[1]!.sessions[0]!.windows[0]!.panes[0]!.output = later
    frames[2]!.sessions[0]!.windows[0]!.layout = '{"V":2,"L":{"t":"p","w":80,"h":24,"x":0,"y":0,"I":"%0"}}' // geometry nothing reported
    expect(untraced(frames, steps_).sort()).toEqual(['1: active=true', '1: index=0', '1: name=invented', `1: output=${later}`, '2: layout={"V":2,"L":{"t":"p","w":80,"h":24,"x":0,"y":0,"I":"%0"}}'].sort())
  })

  it('quotes the last line of output that has text, for the agent\'s answer', () => {
    expect(lastOutputLine('..   [100%]\n2 passed in 0.00s\n\n')).toBe('2 passed in 0.00s')
    expect(lastOutputLine(undefined)).toBeUndefined()
  })
})

describe('the replay component', () => {
  const windows: Window[] = []
  afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

  const template = loadAstroTemplate('components/mcp/McpReplay.astro')
  const component = readFileSync(new URL('../src/components/mcp/McpReplay.astro', import.meta.url), 'utf8')
  const script = transpileModule(/<script>([\s\S]*?)<\/script>/.exec(component)![1]!, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText

  async function markup(port: string) {
    const showcase = (await mcpShowcase(port, 'latest'))!
    return renderAstroTemplate(await template, { props: { example: showcase.example, portName: port } })
  }

  /** The page's markup in a DOM; with `run`, the page's own script on it. */
  async function mount(port: string, options: { run?: boolean; reduced?: boolean; interval?: number } = {}) {
    const win = new Window({ url: 'https://libtmux.org/en/rs/latest/' })
    windows.push(win)
    win.document.body.innerHTML = await markup(port)
    const root = win.document.querySelector('[data-mcp-replay]') as unknown as HTMLElement
    if (options.interval) root.setAttribute('data-interval', String(options.interval))
    if (options.run) {
      const target = win as unknown as { matchMedia: (query: string) => { matches: boolean }; IntersectionObserver?: unknown }
      target.matchMedia = (query: string) => ({ matches: /reduced-motion/.test(query) ? options.reduced ?? false : true })
      target.IntersectionObserver = undefined
      win.eval(`(function() {\n${script}\n})()`)
    }
    return { win, document: win.document as unknown as Document, root }
  }

  const visible = (document: Document, selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => !element.hidden)
  const turnsShown = (document: Document) => visible(document, 'article.mcp-turn, .mcp-turn--answer').length
  const frameShown = (document: Document) => visible(document, '[data-frame]').map((frame) => Number(frame.dataset.frame))
  const click = (win: Window, element: Element) => element.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event)
  const key = (win: Window, element: Element, name: string) => element.dispatchEvent(new win.KeyboardEvent('keydown', { key: name, bubbles: true }) as unknown as Event)
  const action = (document: Document, name: string) => document.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!

  it('without script shows the whole chat, every result and the final state, and no controls', async () => {
    const { document } = await mount('rs')
    expect(turnsShown(document)).toBe(CALLS.rs + 1)
    expect(document.querySelectorAll('details.mcp-result[open]')).toHaveLength(CALLS.rs)
    expect(frameShown(document)).toEqual([CALLS.rs])
    expect(document.querySelectorAll('[data-frame]')).toHaveLength(CALLS.rs + 1)
    expect((document.querySelector('[data-controls]') as HTMLElement).hidden).toBe(true)
    expect(document.querySelector('[data-live]')).toBeNull()
  })

  it('draws the status line, the unsized list and the panes of each state from the recording', async () => {
    const { document } = await mount('rs')
    const frame = (done: number) => document.querySelector(`[data-frame="${done}"]`)!
    expect(frame(1).querySelector('.mcp-tmux__status')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('[checks]')
    expect(frame(1).querySelector('svg.gp-tmux-layout')).not.toBeNull()
    expect(frame(2).querySelector('.mcp-tmux__screen')!.className).toContain('is-reading')
    expect(frame(3).querySelector('.mcp-tmux__screen--unsized .mcp-tmux__unsized')!.textContent).toBe('Panes, sizes not read yet')
    expect([...frame(3).querySelectorAll('.mcp-tmux__screen--unsized li')].map((item) => item.textContent)).toEqual(['%0 sh', '%1 sh'])
    expect(frame(3).querySelector('svg'), 'no boxes before a layout is read').toBeNull()
    expect(frame(4).querySelector('.mcp-tmux__windows')!.className).toContain('is-reading')
    expect(frame(5).querySelector('.mcp-pane__text')!.textContent).toMatch(/^\$ pytest -q\n.*\n2 passed/s)
    expect(frame(6).querySelectorAll('.mcp-pane__text')[1]!.textContent).toMatch(/^\$ cat checks\.log\n.*checks finished/s)
    expect(frame(7).querySelector('.mcp-tmux__screen--empty')!.textContent).toBe('No sessions')
    expect(frame(0).querySelector('.mcp-tmux__screen--empty')!.textContent, 'nothing is said before the first call').toBe('')
  })

  it.each(['ts', 'rs'] as const)('places the %s panes at the rectangles the recorded layout gives', async (port) => {
    const { document } = await mount(port)
    const layoutFrame = replayFrames(await steps(port)).find((frame) => frame.sessions[0]?.windows[0]?.layout)!
    const parsed = parseLayout(layoutFrame.sessions[0]!.windows[0]!.layout!)!
    const panes = [...document.querySelector(`[data-frame="${layoutFrame.done}"]`)!.querySelectorAll<HTMLElement>('.mcp-pane')]
    expect(panes).toHaveLength(parsed.panes.length)
    panes.forEach((pane, index) => {
      const rect = parsed.panes[index]!
      const percent = (value: number, whole: number) => `${(value / whole) * 100}%`
      expect(pane.style.left).toBe(percent(rect.x, parsed.width))
      expect(pane.style.top).toBe(percent(rect.y, parsed.height))
      expect(pane.style.width).toBe(percent(rect.w, parsed.width))
      expect(pane.style.height).toBe(percent(rect.h, parsed.height))
      expect(pane.querySelector('.mcp-pane__id')!.textContent).toContain(rect.id)
    })
    const layoutSvg = document.querySelector(`[data-frame="${layoutFrame.done}"] svg.gp-tmux-layout`)!
    expect(layoutSvg.getAttribute('viewBox')).toBe(`0 0 ${parsed.width * 8} ${parsed.height * 17}`)
    expect(layoutSvg.querySelectorAll('.divider').length, 'the split is drawn as one divider').toBe(1)
  })

  it.each(['ts', 'rs'])('draws only recorded words, besides tmux\'s own punctuation, in the %s preview', async (port) => {
    const { document } = await mount(port)
    const recordedWords = new Set((await steps(port)).flatMap((step) => JSON.stringify([step.arguments, step.structuredContent, step.content]).replace(/\\n/g, ' ').split(/[\s"{}\[\],:]+/)))
    for (const frame of document.querySelectorAll('[data-frame]')) {
      const done = frame.getAttribute('data-frame')
      const drawn = [...frame.querySelectorAll('.mcp-pane__id, .mcp-pane__text, .mcp-tmux__session, .mcp-tmux__window')].map((element) => element.textContent!)
      for (const word of drawn.join(' ').replace(/\$ /g, ' ').replace(/[\[\]*:]/g, ' ').split(/\s+/).filter(Boolean)) {
        expect(recordedWords.has(word), `${port} frame ${done}: "${word}"`).toBe(true)
      }
    }
  })

  it('with a reduced-motion preference starts at the end and does not play', async () => {
    const { document } = await mount('ts', { run: true, reduced: true, interval: 5 })
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(turnsShown(document)).toBe(CALLS.ts + 1)
    expect(frameShown(document)).toEqual([CALLS.ts])
    expect(action(document, 'play').getAttribute('aria-label')).toBe('Replay')
    expect(document.querySelectorAll('details.mcp-result[open]')).toHaveLength(0)
    expect((document.querySelector('[data-controls]') as HTMLElement).hidden).toBe(false)
  })

  it('without that preference plays from the first call to the last by itself', async () => {
    const { document } = await mount('ts', { run: true, interval: 15 })
    expect(turnsShown(document), 'starts from the prompt').toBeLessThan(CALLS.ts + 1)
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(turnsShown(document)).toBe(CALLS.ts + 1)
    expect(frameShown(document)).toEqual([CALLS.ts])
    expect(document.querySelector('[data-count]')!.textContent).toBe(`${CALLS.ts}/${CALLS.ts}`)
  })

  it('steps back and forward, jumps to a marker, and restarts from the end', async () => {
    const { win, document } = await mount('ts', { run: true, reduced: true, interval: 15 })
    click(win, action(document, 'back'))
    expect(frameShown(document)).toEqual([CALLS.ts - 1])
    expect(turnsShown(document)).toBe(CALLS.ts - 1)
    expect(document.querySelector('[data-count]')!.textContent).toBe(`${CALLS.ts - 1}/${CALLS.ts}`)
    click(win, action(document, 'forward'))
    expect(frameShown(document)).toEqual([CALLS.ts])
    click(win, document.querySelector('[data-mark="1"]')!)
    expect(frameShown(document)).toEqual([1])
    expect(document.querySelectorAll('[data-mark].is-done')).toHaveLength(1)
    click(win, document.querySelector(`[data-mark="${CALLS.ts}"]`)!)
    click(win, action(document, 'play'))
    expect(turnsShown(document), 'play at the end starts again from the prompt').toBe(0)
    expect(action(document, 'play').getAttribute('aria-label')).toBe('Pause')
    click(win, action(document, 'play'))
    expect(action(document, 'play').getAttribute('aria-label')).toBe('Play')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(turnsShown(document), 'paused, so it stays').toBe(0)
  })

  it('previews a call\'s state on hover and pins it on click, without changing what has played', async () => {
    const { win, document } = await mount('rs', { run: true, reduced: true })
    const turn = (index: number) => document.querySelector(`[data-turn="${index}"]`)!
    turn(1).dispatchEvent(new win.MouseEvent('mouseenter') as unknown as Event)
    expect(frameShown(document)).toEqual([2])
    expect(turnsShown(document), 'everything stays visible').toBe(CALLS.rs + 1)
    turn(1).dispatchEvent(new win.MouseEvent('mouseleave') as unknown as Event)
    expect(frameShown(document)).toEqual([CALLS.rs])
    click(win, turn(2))
    expect(frameShown(document)).toEqual([3])
    expect(turn(2).classList.contains('is-pinned')).toBe(true)
    expect(document.querySelector('[data-hint]')!.textContent).toMatch(/^Pinned/)
    click(win, turn(2))
    expect(frameShown(document), 'a second click unpins').toEqual([CALLS.rs])
    click(win, turn(0))
    key(win, document.querySelector('[data-body]')!, 'Escape')
    expect(frameShown(document), 'Escape unpins').toEqual([CALLS.rs])
  })

  it('does not let focus or touch hover hold the preview, and ignores keys with a modifier', async () => {
    const { win, document } = await mount('ts', { run: true, reduced: true })
    const turn = document.querySelector('[data-turn="0"]')!
    turn.dispatchEvent(new win.FocusEvent('focus') as unknown as Event)
    expect(frameShown(document), 'focus does not preview').toEqual([CALLS.ts])
    const body = document.querySelector('[data-body]')!
    body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }) as unknown as Event)
    expect(frameShown(document), 'Alt+Left is the browser\'s').toEqual([CALLS.ts])
  })

  it('does not start by itself once the reader has used a control before it was on screen', async () => {
    const win = new Window({ url: 'https://libtmux.org/en/rs/latest/' })
    windows.push(win)
    win.document.body.innerHTML = await markup('ts')
    const root = win.document.querySelector('[data-mcp-replay]') as unknown as HTMLElement
    root.setAttribute('data-interval', '10')
    let reveal: (() => void) | undefined
    const target = win as unknown as Record<string, unknown>
    target.matchMedia = (query: string) => ({ matches: !/reduced-motion/.test(query) })
    target.IntersectionObserver = class { constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { reveal = () => callback([{ isIntersecting: true }]) } observe() {} disconnect() {} }
    win.eval(`(function() {\n${script}\n})()`)
    const document = win.document as unknown as Document
    expect(turnsShown(document)).toBe(0)
    click(win, document.querySelector('[data-mark="0"], [data-action="back"]')!)
    reveal!()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(turnsShown(document), 'still at the start').toBe(0)
    expect(action(document, 'play').getAttribute('aria-label')).toBe('Play')
  })

  it('shows the header and the controls only once script has run', async () => {
    const before = await mount('ts')
    expect((before.document.querySelector('[data-head]') as HTMLElement).hidden).toBe(true)
    const after = await mount('ts', { run: true, reduced: true })
    expect((after.document.querySelector('[data-head]') as HTMLElement).hidden).toBe(false)
  })

  it('does not pin when the click is on a link', async () => {
    const { win, document } = await mount('rs', { run: true, reduced: true })
    click(win, document.querySelector('[data-turn="0"] a')!)
    expect(document.querySelector('.is-pinned')).toBeNull()
  })

  it('works from the keyboard: arrows, Home and End on the replay, Enter on a call', async () => {
    const { win, document } = await mount('ts', { run: true, reduced: true })
    const body = document.querySelector('[data-body]')!
    expect(body.getAttribute('tabindex')).toBe('0')
    key(win, body, 'ArrowLeft')
    expect(frameShown(document)).toEqual([CALLS.ts - 1])
    key(win, body, 'Home')
    expect(frameShown(document)).toEqual([0])
    key(win, body, 'ArrowRight')
    expect(frameShown(document)).toEqual([1])
    key(win, body, 'End')
    expect(frameShown(document)).toEqual([CALLS.ts])
    const turn = document.querySelector('[data-turn="0"]')!
    expect(turn.getAttribute('tabindex')).toBe('0')
    key(win, turn, 'Enter')
    expect(frameShown(document)).toEqual([1])
    expect(turn.classList.contains('is-pinned')).toBe(true)
  })

  it('shows requests only, with no preview or control, for a port with no recording, and the script leaves it alone', async () => {
    const { document, root } = await mount('go', { run: true })
    expect(document.querySelector('[data-tmux]')).toBeNull()
    expect(document.querySelector('[data-controls]')).toBeNull()
    expect(root.hasAttribute('data-live')).toBe(false)
    expect(document.querySelectorAll('article.mcp-turn')).toHaveLength(EXAMPLES.go!.steps.length)
    expect(visible(document, 'article.mcp-turn')).toHaveLength(EXAMPLES.go!.steps.length)
  })
})
