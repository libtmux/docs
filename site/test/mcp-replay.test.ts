import { readFileSync } from 'node:fs'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { Window } from 'happy-dom'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { lastOutputLine, replayFrames, windowLabel, type Frame, type ReplayStep } from '../src/lib/mcp-replay'
import { buildShowcase, EXAMPLES, mcpShowcase, transcriptFor } from '../src/lib/mcp-showcase'
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
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      found.add(`${key}=${typeof value}:${String(value)}`)
      // A count or index sent as digits in a string is read as the number.
      if (typeof value === 'string' && /^\d+$/.test(value)) found.add(`${key}=number:${value}`)
    }
    else if (Array.isArray(value)) {
      // A server may send a command's output as its lines; the preview shows them joined.
      if (value.length && value.every((item) => typeof item === 'string')) found.add(`${key}=string:${value.join('\n')}`)
      value.forEach((item) => walk(key, item))
    }
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
  id: ['id', 'paneId', 'windowId', 'killed', 'sessionId', 'session_id', 'pane_id', 'window_id', 'active_pane_id'], name: ['name', 'session_name', 'session', 'sessionName', 'window_name', 'window'], index: ['index', 'window_index'], active: ['active'],
  command: ['command', 'currentCommand', 'pane_current_command'], left: ['left'], top: ['top'], width: ['width'], height: ['height'], path: ['path', 'cwd', 'pane_current_path'], typed: ['command'], output: ['output'], layout: ['layout', 'window_layout'],
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
const CALLS = { ts: 6, rs: 7, go: 7, py: 6, java: 7 }

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
    expect(frames[4], 'a layout read is not a list').not.toHaveProperty('reading')
    const read = frames[4]!.sessions[0]!.windows[0]!
    expect(parseLayout(read.layout!)!.panes.map((pane) => pane.id)).toEqual(['%0', '%1'])
    expect(frames[5]!.sessions[0]!.windows[0]!.panes[0]).toMatchObject({ typed: 'pytest -q' })
    expect(frames[6]!.sessions[0]!.windows[0]!.panes[1]).toMatchObject({ typed: 'cat checks.log' })
    expect(frames[7]!.sessions).toEqual([])
  })

  it.each(['ts', 'rs', 'go', 'py', 'java'] as const)('draws nothing for %s that the recording does not contain', async (port) => {
    const steps_ = await steps(port)
    expect(untraced(replayFrames(steps_), steps_)).toEqual([])
  })

  it.each(['ts', 'rs', 'py', 'java'] as const)('gives %s panes geometry only from a recorded layout that names every pane', async (port) => {
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

  it('follows Go: the geometry comes from the pane listings, the session is killed by name', async () => {
    const frames = replayFrames(await steps('go'))
    expect(frames.map((frame) => frame.sessions.length)).toEqual([0, 1, 1, 1, 1, 1, 1, 0])
    expect(frames[1]!.sessions[0]).toMatchObject({ id: '$0', name: 'checks' })
    expect(frames[2]!.sessions[0]!.windows[0]!.panes[0]).toMatchObject({ id: '%0', command: 'sh', left: 0, top: 0, width: 80, height: 24 })
    const split = frames[3]!.sessions[0]!.windows[0]!.panes
    expect(split.map((pane) => pane.id)).toEqual(['%0', '%1'])
    expect(split[1]!.width, 'the split result states no size').toBeUndefined()
    expect(split[0]!.width, 'the first pane still has the size of the earlier listing').toBe(80)
    const listed = frames[4]!.sessions[0]!.windows[0]!.panes
    expect(listed.map((pane) => [pane.left, pane.width])).toEqual([[0, 40], [41, 39]])
    expect(frames[5]!.sessions[0]!.windows[0]!.panes[0]!.output).toMatch(/2 passed/)
    expect(frames[6]!.sessions[0]!.windows[0]!.panes[1]!.output).toMatch(/checks finished/)
    expect(frames[7]!.sessions).toEqual([])
  })

  it('follows Python: ids from create_session, the split pane, the layout from list_windows, output with the prompt dropped from the answer', async () => {
    const frames = replayFrames(await steps('py'))
    expect(frames.map((frame) => frame.sessions.length)).toEqual([0, 1, 1, 1, 1, 1, 0])
    expect(frames[1]!.sessions[0]).toMatchObject({ id: '$0', name: 'checks', windows: [{ panes: [{ id: '%0' }] }] })
    const split = frames[2]!.sessions[0]!.windows[0]!
    expect(split).toMatchObject({ id: '@0', panes: [{ id: '%0' }, { id: '%1', command: 'sh' }] })
    expect(split.layout).toBeUndefined()
    const read = frames[3]!.sessions[0]!.windows[0]!
    expect(read).toMatchObject({ name: 'sh', index: 0 })
    expect(parseLayout(read.layout!)!.panes.map((pane) => pane.id)).toEqual(['%0', '%1'])
    expect(frames[5]!.sessions[0]!.windows[0]!.panes[1]!.output).toMatch(/checks finished/)
    expect(frames[6]!.sessions).toEqual([])
    expect(lastOutputLine('..\n2 passed in 0.00s\n$ ')).toBe('2 passed in 0.00s')
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

  it('forgets a layout once its window is split again, and ignores a split or layout for a pane no window holds', () => {
    const answered = (tool: string, args: Record<string, unknown>, structuredContent: unknown): ReplayStep => ({ tool, arguments: args, structuredContent, content: [] })
    const layout = '{"V":2,"L":{"t":"p","w":80,"h":24,"x":0,"y":0,"I":"%0"}}'
    const frames = replayFrames([
      answered('create_session', { name: 'a' }, { paneId: '%0', windowId: '@0', session: { id: '$0', name: 'a', windows: 1 } }),
      answered('get_tmux_variables', { names: ['window_layout'], pane: '%0' }, { values: { window_layout: layout } }),
      answered('split_window', { paneId: '%0' }, { pane: { id: '%1', windowId: '@0' } }),
      answered('split_window', { paneId: '%9' }, { pane: { id: '%2', windowId: '@7' } }),
      answered('get_tmux_variables', { names: ['window_layout'], pane: '%9' }, { values: { window_layout: layout } }),
      answered('select_layout', { windowId: '@0', layout: 'tiled' }, { window: { id: '@0', layout: 'tiled' } }),
    ])
    const window = (index: number) => frames[index]!.sessions[0]!.windows[0]!
    expect(window(2).layout).toBe(layout)
    expect(window(3).layout, 'the split makes the layout stale').toBeUndefined()
    expect(window(3).panes.map((pane) => pane.id)).toEqual(['%0', '%1'])
    expect(window(4).panes, 'a split of a pane no window holds is ignored').toHaveLength(2)
    expect(window(5).layout, 'a layout read through an unknown pane is ignored').toBeUndefined()
    expect(window(6).layout, 'a layout name has no geometry').toBeUndefined()
  })

  it('quotes the last line of output that has text, for the agent\'s answer', () => {
    expect(lastOutputLine('..   [100%]\n2 passed in 0.00s\n\n')).toBe('2 passed in 0.00s')
    expect(lastOutputLine(undefined)).toBeUndefined()
  })
})

describe('the replay component', () => {
  const windows: Window[] = []
  afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

  // The page's code block, as a marked element holding the code.
  const template = loadAstroTemplate('components/mcp/McpReplay.astro', {
    modules: { 'astro-expressive-code/components': { Code: createComponent((_result: unknown, props: { code: string; lang: string; frame?: string }) => renderTemplate`<pre data-lang="${props.lang}" data-code-frame="${props.frame ?? ''}">${props.code}</pre>`) } },
  })
  const component = readFileSync(new URL('../src/components/mcp/McpReplay.astro', import.meta.url), 'utf8')
  const script = transpileModule(/<script>([\s\S]*?)<\/script>/.exec(component)![1]!, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText

  async function markup(port: string, recorded = true) {
    const showcase = recorded ? (await mcpShowcase(port, 'latest'))! : buildShowcase(port, 'latest', JSON.parse(readFileSync(new URL(`../src/data/mcp-protocol/${port}.json`, import.meta.url), 'utf8')))
    return renderAstroTemplate(await template, { props: { example: showcase.example, portName: port } })
  }

  /** The page's markup in a DOM; with `run`, the page's own script on it. */
  async function mount(port: string, options: { run?: boolean; reduced?: boolean; interval?: number; recorded?: boolean } = {}) {
    const win = new Window({ url: 'https://libtmux.org/en/rs/latest/' })
    windows.push(win)
    win.document.body.innerHTML = await markup(port, options.recorded)
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

  it('highlights each recorded result as JSON with the site\'s code block, inside a scrolling body', async () => {
    const { document } = await mount('ts')
    const blocks = [...document.querySelectorAll('details.mcp-result .mcp-result__body pre')]
    expect(blocks).toHaveLength(CALLS.ts)
    expect(blocks.map((block) => block.getAttribute('data-lang'))).toEqual(Array(CALLS.ts).fill('json'))
    expect(blocks.map((block) => block.getAttribute('data-code-frame'))).toEqual(Array(CALLS.ts).fill('none'))
    expect(JSON.parse(blocks[0]!.textContent!).paneId).toBe('%0')
  })

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
    expect(frame(4).querySelector('.is-reading'), 'a layout read is not drawn as a list read').toBeNull()
    expect(frame(4).querySelectorAll('.mcp-pane'), 'the layout read puts the panes in boxes').toHaveLength(2)
    expect(frame(5).querySelector('.mcp-pane__text')!.textContent).toMatch(/^\$ pytest -q\n.*\n2 passed/s)
    expect(frame(6).querySelectorAll('.mcp-pane__text')[1]!.textContent).toMatch(/^\$ cat checks\.log\n.*checks finished/s)
    expect(frame(7).querySelector('.mcp-tmux__screen--empty')!.textContent).toBe('No sessions')
    expect(frame(0).querySelector('.mcp-tmux__screen--empty')!.textContent, 'nothing is said before the first call').toBe('')
  })

  it('places the Go panes at the position and size its second pane listing gives', async () => {
    const { document } = await mount('go')
    const panes = [...document.querySelector('[data-frame="4"]')!.querySelectorAll<HTMLElement>('.mcp-pane')]
    expect(panes.map((pane) => [pane.style.left, pane.style.width])).toEqual([['0%', '50%'], [`${(41 / 80) * 100}%`, `${(39 / 80) * 100}%`]])
    expect(document.querySelector('[data-frame="3"] svg'), 'no boxes between the split and the listing').toBeNull()
    expect(document.querySelector('[data-frame="4"] svg.gp-tmux-layout')!.getAttribute('viewBox')).toBe(`0 0 ${80 * 8} ${24 * 17}`)
  })

  it.each(['ts', 'rs', 'py', 'java'] as const)('places the %s panes at the rectangles the recorded layout gives', async (port) => {
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
    const { document, root } = await mount('go', { run: true, recorded: false })
    expect(document.querySelector('[data-tmux]')).toBeNull()
    expect(document.querySelector('[data-controls]')).toBeNull()
    expect(root.hasAttribute('data-live')).toBe(false)
    expect(document.querySelectorAll('article.mcp-turn')).toHaveLength(EXAMPLES.go!.steps.length)
    expect(visible(document, 'article.mcp-turn')).toHaveLength(EXAMPLES.go!.steps.length)
  })
})
