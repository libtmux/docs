import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReplayOptions, ReplayPlayer, ReplayState } from '../src/lib/replay-player'

/**
 * The shared replay player (`lib/replay-player.ts`) on a hand-built bar: which
 * step it opens on, when it plays by itself, and what stops it. The Core API
 * player and the MCP replay are tested on their own markup in
 * `core-player.test.ts` and `mcp-replay.test.ts`.
 */
const source = transpileModule(readFileSync(new URL('../src/lib/replay-player.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText

const TOTAL = 4
const MARKS = Array.from({ length: TOTAL + 1 }, (_, index) => `<button type="button" data-mark="${index}"></button>`).join('')
const MARKUP = `<section id="root" data-interval="5"><div data-body tabindex="0"><div id="content"><p id="words">Some words to select.</p></div></div>
  <div data-controls hidden><button type="button" data-action="play"></button><button type="button" data-action="back"></button><button type="button" data-action="forward"></button>
  <div data-fill></div>${MARKS}<span data-count></span><button type="button" data-action="fullscreen"></button></div></section>`

interface Setup { reduced?: boolean; intersect?: boolean }

describe('the replay player', () => {
  const windows: Window[] = []
  afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

  /** The bar bound to `root`, with the page's script's view of motion and visibility. `reveal` reports the player as on screen. */
  function bind(options: Partial<ReplayOptions> = {}, { reduced = false, intersect = true }: Setup = {}) {
    const win = new Window({ url: 'https://libtmux.org/en/rs/latest/' })
    windows.push(win)
    win.document.body.innerHTML = MARKUP
    const document = win.document as unknown as Document
    let reveal = () => {}
    const target = win as unknown as Record<string, unknown>
    target.matchMedia = (query: string) => ({ matches: /reduced-motion/.test(query) ? reduced : true })
    target.IntersectionObserver = intersect
      ? class { constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { reveal = () => callback([{ isIntersecting: true }]) } observe() {} disconnect() {} }
      : undefined
    const drawn: ReplayState[] = []
    win.eval(`var exports = {}; (function (exports) {\n${source}\n})(exports); window.__bindReplay = exports.bindReplay`)
    const root = document.getElementById('root')!
    const content = document.getElementById('content')!
    const player = (win as unknown as { __bindReplay: (root: HTMLElement, options: ReplayOptions) => ReplayPlayer | undefined }).__bindReplay(root, {
      body: root.querySelector<HTMLElement>('[data-body]')!,
      total: () => TOTAL,
      render: (state) => { drawn.push(state) },
      content,
      ...options,
    })!
    const count = () => document.querySelector('[data-count]')!.textContent
    const click = (element: Element) => element.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event)
    const key = (name: string, extra: Record<string, boolean> = {}) => root.querySelector('[data-body]')!.dispatchEvent(new win.KeyboardEvent('keydown', { key: name, bubbles: true, ...extra }) as unknown as Event)
    const select = () => {
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('words')!)
      const selection = document.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new win.Event('selectionchange') as unknown as Event)
    }
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    return { win, document, root, content, player, drawn, reveal: () => reveal(), count, click, key, select, wait }
  }

  describe('where it opens', () => {
    it('opens on the state before the first call unless the host names another step', () => {
      expect(bind().count()).toBe('0/4')
      expect(bind({ opening: 2 }).count()).toBe('2/4')
      expect(bind({ opening: 'end' }).count()).toBe('4/4')
      expect(bind({ opening: 9 }).count(), 'a step past the end is the end').toBe('4/4')
    })

    it('opens a reader who asked for less motion where the host says, which is the same step unless the host says otherwise', () => {
      expect(bind({ opening: 1 }, { reduced: true }).count()).toBe('1/4')
      expect(bind({ opening: 1, reducedOpening: 'end' }, { reduced: true }).count()).toBe('4/4')
      expect(bind({ opening: 1, reducedOpening: 'end' }).count(), 'a reader with motion keeps the opening').toBe('1/4')
    })
  })

  describe('playing by itself', () => {
    it('does not play when the player is on screen unless the instance opts in', async () => {
      const { reveal, count, wait, player } = bind({ opening: 1 })
      reveal()
      await wait(60)
      expect(count()).toBe('1/4')
      expect(player.state().playing).toBe(false)
    })

    it('plays from where it opened to the last step once an opted-in player is on screen, and then rests', async () => {
      const { reveal, count, wait, player, document } = bind({ opening: 1, autoplay: true })
      expect(count(), 'nothing plays before it is seen').toBe('1/4')
      reveal()
      expect(player.autoplaying()).toBe(true)
      await wait(120)
      expect(count()).toBe('4/4')
      expect(player.autoplaying()).toBe(false)
      expect(document.querySelector('[data-action="play"]')!.getAttribute('aria-label')).toBe('Replay')
    })

    it('never plays by itself for a reader who asked for less motion, opted in or not', async () => {
      const { reveal, count, wait } = bind({ opening: 1, autoplay: true }, { reduced: true })
      reveal()
      await wait(60)
      expect(count()).toBe('1/4')
    })

    it('stops when the reader selects text in the content, and stays stopped when it is seen again', async () => {
      const { reveal, count, wait, select, player } = bind({ opening: 1, autoplay: true })
      reveal()
      await wait(8)
      select()
      const at = count()
      expect(player.state().playing).toBe(false)
      await wait(60)
      expect(count(), 'a selection pauses it where it was').toBe(at)
    })

    it('does not start once the reader has selected before it was seen', async () => {
      const { reveal, count, wait, select } = bind({ opening: 1, autoplay: true })
      select()
      reveal()
      await wait(40)
      expect(count()).toBe('1/4')
    })

    it('ignores a selection outside the content', async () => {
      const { reveal, wait, win, document, player } = bind({ opening: 1, autoplay: true })
      document.body.insertAdjacentHTML('beforeend', '<p id="elsewhere">Elsewhere</p>')
      reveal()
      const range = document.createRange()
      range.selectNodeContents(document.getElementById('elsewhere')!)
      document.getSelection()!.addRange(range)
      document.dispatchEvent(new win.Event('selectionchange') as unknown as Event)
      await wait(8)
      expect(player.autoplaying()).toBe(true)
    })

    it.each(['wheel', 'touchmove', 'pointerdown'])('stops on a %s in the content, which is a reader scrolling or taking hold of it', async (type) => {
      const { reveal, content, win, player, wait, count } = bind({ opening: 1, autoplay: true })
      reveal()
      content.dispatchEvent(new win.Event(type, { bubbles: true }) as unknown as Event)
      expect(player.state().playing).toBe(false)
      await wait(40)
      expect(count()).toBe('1/4')
    })

    it('stops when focus moves into the player', async () => {
      const { reveal, root, win, player } = bind({ opening: 1, autoplay: true })
      reveal()
      root.querySelector('[data-body]')!.dispatchEvent(new win.FocusEvent('focusin', { bubbles: true }) as unknown as Event)
      expect(player.state().playing).toBe(false)
    })

    it('leaves a run the reader started with play alone when they scroll afterwards', async () => {
      const { click, document, content, win, player, wait } = bind({ opening: 1, autoplay: true })
      click(document.querySelector('[data-action="play"]')!)
      expect(player.state().playing).toBe(true)
      content.dispatchEvent(new win.Event('wheel', { bubbles: true }) as unknown as Event)
      await wait(5)
      expect(player.state().playing, 'the reader asked for this run').toBe(true)
    })

    it('does not start once a control has been used', async () => {
      const { reveal, click, document, count, wait } = bind({ opening: 1, autoplay: true })
      click(document.querySelector('[data-action="forward"]')!)
      reveal()
      await wait(40)
      expect(count()).toBe('2/4')
    })
  })

  describe('stepping', () => {
    it('moves with the controls and the keys, and a reader\'s click on the content moves nothing', () => {
      const { click, key, document, count } = bind({ opening: 1 })
      click(document.getElementById('words')!)
      expect(count()).toBe('1/4')
      click(document.querySelector('[data-action="forward"]')!)
      expect(count()).toBe('2/4')
      key('ArrowRight')
      expect(count()).toBe('3/4')
      key('ArrowLeft')
      expect(count()).toBe('2/4')
      key('End')
      expect(count()).toBe('4/4')
      key('Home')
      expect(count()).toBe('0/4')
      click(document.querySelector('[data-mark="3"]')!)
      expect(count()).toBe('3/4')
    })

    it('leaves a key with a modifier to the browser', () => {
      const { key, count } = bind({ opening: 1 })
      key('ArrowRight', { altKey: true })
      key('ArrowRight', { metaKey: true })
      expect(count()).toBe('1/4')
    })

    it('pins a step, holds it against the current one, and lets go on Escape', () => {
      const { key, player } = bind({ opening: 1 })
      player.togglePin(3)
      expect(player.state()).toMatchObject({ step: 1, shown: 3, pinned: 3 })
      player.hover(2)
      expect(player.state().shown, 'a preview under the pointer outranks a pin').toBe(2)
      player.hover(null)
      key('Escape')
      expect(player.state()).toMatchObject({ shown: 1, pinned: null })
    })

    it('goes to a step from a marker: it releases a pin and stops playing', () => {
      const { player } = bind({ opening: 1 })
      player.togglePin(3)
      player.go(2)
      expect(player.state()).toMatchObject({ step: 2, shown: 2, pinned: null, playing: false })
    })
  })
})
