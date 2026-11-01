import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { lastOutputLine, replayFrames, windowLabel, type Frame, type ReplayStep } from '../src/lib/mcp-replay'
import { mcpShowcase, transcriptFor } from '../src/lib/mcp-showcase'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const steps = async (port: string) => (await transcriptFor(port))!.steps as ReplayStep[]

/** Every string and number in a value, as the strings they were written as. */
function leaves(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string' || typeof value === 'number') found.add(String(value))
  else if (Array.isArray(value)) value.forEach((item) => leaves(item, found))
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => leaves(item, found))
  return found
}

/** What a frame shows that no request or result of the recording contains. */
function untraced(frames: Frame[], recorded: ReplayStep[]): string[] {
  const known = leaves(recorded.map((step) => [step.arguments, step.structuredContent, step.content]))
  // The call names and the step counts are the page's own, not preview data.
  return [...leaves(frames.map(({ sessions }) => sessions))].filter((value) => !known.has(value))
}

describe('the tmux state each recorded call leaves', () => {
  it('follows TypeScript: a session with its window and pane, the typed command and output, then nothing', async () => {
    const frames = replayFrames(await steps('ts'))
    expect(frames.map((frame) => frame.sessions.length)).toEqual([0, 1, 1, 0])
    const created = frames[1]!.sessions[0]!
    expect(created).toMatchObject({ id: '$0', name: 'checks', windows: [{ id: '@0', panes: [{ id: '%0' }] }] })
    expect(created.windows[0]!.index, 'the result never states an index').toBeUndefined()
    expect(created.windows[0]!.panes[0]!.typed).toBeUndefined()
    const ran = frames[2]!.sessions[0]!.windows[0]!.panes[0]!
    expect(ran.typed).toBe('pytest -q')
    expect(ran.output).toMatch(/2 passed/)
    expect(frames[3]!.sessions).toEqual([])
  })

  it('follows Rust: facts arrive from the list calls, which change nothing', async () => {
    const frames = replayFrames(await steps('rs'))
    expect(frames.map((frame) => frame.sessions.length)).toEqual([0, 1, 1, 1, 1, 0])
    const created = frames[1]!.sessions[0]!
    expect(created).toMatchObject({ id: '$0', name: 'checks' })
    expect(created.windows).toHaveLength(1)
    expect(created.windows[0]!.name, 'only a listing names the window').toBeUndefined()
    expect(frames[2]).toMatchObject({ reading: 'windows' })
    const window = frames[2]!.sessions[0]!.windows[0]!
    expect(window).toMatchObject({ id: '@0', index: 0, name: 'sh', active: true })
    expect(windowLabel(window)).toBe('0:sh')
    expect(frames[3]).toMatchObject({ reading: 'panes' })
    expect(frames[3]!.sessions[0]!.windows[0]!.panes[0]).toMatchObject({ id: '%0', command: 'sh', path: '/home/user/project' })
    for (const index of [2, 3]) {
      const before = frames[index - 1]!.sessions[0]!
      const after = frames[index]!.sessions[0]!
      expect(after.windows.map((w) => w.panes.length), `list call ${index} adds no window or pane`).toEqual(before.windows.map((w) => w.panes.length))
    }
    expect(frames[4]!.sessions[0]!.windows[0]!.panes[0]).toMatchObject({ typed: 'pytest -q' })
    expect(frames[5]!.sessions).toEqual([])
  })

  it.each(['ts', 'rs'])('draws nothing for %s that the recording does not contain', async (port) => {
    const recorded = await steps(port)
    expect(untraced(replayFrames(recorded), recorded)).toEqual([])
  })

  it('has a control: a value the recording lacks is reported', async () => {
    const recorded = await steps('ts')
    const frames = replayFrames(recorded)
    frames[1]!.sessions[0]!.windows[0]!.index = 7
    frames[1]!.sessions[0]!.name = 'invented'
    expect(untraced(frames, recorded).sort()).toEqual(['7', 'invented'])
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
      target.matchMedia = () => ({ matches: options.reduced ?? false })
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
    expect(turnsShown(document)).toBe(6)
    expect(document.querySelectorAll('details.mcp-result[open]')).toHaveLength(5)
    expect(frameShown(document)).toEqual([5])
    expect(document.querySelectorAll('[data-frame]')).toHaveLength(6)
    expect((document.querySelector('[data-controls]') as HTMLElement).hidden).toBe(true)
    expect(document.querySelector('[data-live]')).toBeNull()
  })

  it('draws the status line and panes of each state from the recording', async () => {
    const { document } = await mount('rs')
    const frame = (done: number) => document.querySelector(`[data-frame="${done}"]`)!
    expect(frame(2).querySelector('.mcp-tmux__status')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('[checks] 0:sh*')
    expect(frame(4).querySelector('.mcp-pane__text')!.textContent).toMatch(/^\$ pytest -q\n.*\n2 passed/s)
    expect(frame(2).querySelector('.mcp-tmux__windows')!.className).toContain('is-reading')
    expect(frame(3).querySelector('.mcp-tmux__screen')!.className).toContain('is-reading')
    expect(frame(5).querySelector('.mcp-tmux__screen--empty')!.textContent).toBe('No sessions')
    expect(frame(1).querySelector('svg.gp-tmux-layout')).not.toBeNull()
  })

  it('with a reduced-motion preference starts at the end and does not play', async () => {
    const { document } = await mount('ts', { run: true, reduced: true, interval: 5 })
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(turnsShown(document)).toBe(4)
    expect(frameShown(document)).toEqual([3])
    expect(action(document, 'play').getAttribute('aria-label')).toBe('Replay')
    expect(document.querySelectorAll('details.mcp-result[open]')).toHaveLength(0)
    expect((document.querySelector('[data-controls]') as HTMLElement).hidden).toBe(false)
  })

  it('without that preference plays from the first call to the last by itself', async () => {
    const { document } = await mount('ts', { run: true, interval: 15 })
    expect(turnsShown(document), 'starts from the prompt').toBeLessThan(4)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(turnsShown(document)).toBe(4)
    expect(frameShown(document)).toEqual([3])
    expect(document.querySelector('[data-count]')!.textContent).toBe('3/3')
  })

  it('steps back and forward, jumps to a marker, and restarts from the end', async () => {
    const { win, document } = await mount('ts', { run: true, reduced: true, interval: 15 })
    click(win, action(document, 'back'))
    expect(frameShown(document)).toEqual([2])
    expect(turnsShown(document)).toBe(2)
    expect(document.querySelector('[data-count]')!.textContent).toBe('2/3')
    click(win, action(document, 'forward'))
    expect(frameShown(document)).toEqual([3])
    click(win, document.querySelector('[data-mark="1"]')!)
    expect(frameShown(document)).toEqual([1])
    expect(document.querySelectorAll('[data-mark].is-done')).toHaveLength(1)
    click(win, document.querySelector('[data-mark="3"]')!)
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
    expect(turnsShown(document), 'everything stays visible').toBe(6)
    turn(1).dispatchEvent(new win.MouseEvent('mouseleave') as unknown as Event)
    expect(frameShown(document)).toEqual([5])
    click(win, turn(2))
    expect(frameShown(document)).toEqual([3])
    expect(turn(2).classList.contains('is-pinned')).toBe(true)
    expect(document.querySelector('[data-hint]')!.textContent).toMatch(/^Pinned/)
    click(win, turn(2))
    expect(frameShown(document), 'a second click unpins').toEqual([5])
    click(win, turn(0))
    key(win, document.querySelector('[data-body]')!, 'Escape')
    expect(frameShown(document), 'Escape unpins').toEqual([5])
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
    expect(frameShown(document)).toEqual([2])
    key(win, body, 'Home')
    expect(frameShown(document)).toEqual([0])
    key(win, body, 'ArrowRight')
    expect(frameShown(document)).toEqual([1])
    key(win, body, 'End')
    expect(frameShown(document)).toEqual([3])
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
    expect(document.querySelectorAll('article.mcp-turn')).toHaveLength(4)
    expect(visible(document, 'article.mcp-turn')).toHaveLength(4)
  })
})
