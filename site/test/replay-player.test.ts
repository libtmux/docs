import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReplayOptions, ReplayPlayer, ReplayState } from '../src/lib/replay-player'

/**
 * The shared replay player (`lib/replay-player.ts`) on a hand-built bar: which
 * step it opens on, the rest state it opens in (record 0081), when it plays by
 * itself, and what stops it. The Core API
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
    const marks = () => [...document.querySelectorAll<HTMLElement>('[data-mark]')]
    return { win, document, root, content, player, drawn, reveal: () => reveal(), count, click, key, select, wait, marks }
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
      const { reveal, count, wait, player } = bind({ rest: true })
      reveal()
      await wait(60)
      expect(count()).toBe('1/4')
      expect(player.state().playing).toBe(false)
    })

    it('plays from rest to the last step once an opted-in player is on screen, highlighting step 1 first, and then rests', async () => {
      const { reveal, count, wait, player, document } = bind({ rest: true, autoplay: true })
      expect(count(), 'nothing plays before it is seen').toBe('1/4')
      expect(player.state().rest).toBe(true)
      reveal()
      expect(player.state(), 'step 1 is chosen the moment it starts').toMatchObject({ step: 1, rest: false, playing: true })
      expect(player.autoplaying()).toBe(true)
      await wait(120)
      expect(count()).toBe('4/4')
      expect(player.autoplaying()).toBe(false)
      expect(document.querySelector('[data-action="play"]')!.getAttribute('aria-label')).toBe('Replay')
    })

    it('does not play a player a link opened on a step, which is not at rest', async () => {
      const { reveal, count, wait } = bind({ opening: 2, autoplay: true })
      reveal()
      await wait(40)
      expect(count()).toBe('2/4')
    })

    it('never plays by itself for a reader who asked for less motion, opted in or not', async () => {
      const { reveal, count, wait } = bind({ rest: true, autoplay: true }, { reduced: true })
      reveal()
      await wait(60)
      expect(count()).toBe('1/4')
    })

    it('stops when the reader selects text in the content, and stays stopped when it is seen again', async () => {
      const { reveal, count, wait, select, player } = bind({ rest: true, autoplay: true })
      reveal()
      await wait(8)
      select()
      const at = count()
      expect(player.state().playing).toBe(false)
      await wait(60)
      expect(count(), 'a selection pauses it where it was').toBe(at)
    })

    it('does not start once the reader has selected before it was seen', async () => {
      const { reveal, count, wait, select } = bind({ rest: true, autoplay: true })
      select()
      reveal()
      await wait(40)
      expect(count()).toBe('1/4')
    })

    it('ignores a selection outside the content', async () => {
      const { reveal, wait, win, document, player } = bind({ rest: true, autoplay: true })
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
      const { reveal, content, win, player, wait, count } = bind({ rest: true, autoplay: true })
      reveal()
      content.dispatchEvent(new win.Event(type, { bubbles: true }) as unknown as Event)
      expect(player.state().playing).toBe(false)
      await wait(40)
      expect(count()).toBe('1/4')
    })

    it('stops when focus moves into the player', async () => {
      const { reveal, root, win, player } = bind({ rest: true, autoplay: true })
      reveal()
      root.querySelector('[data-body]')!.dispatchEvent(new win.FocusEvent('focusin', { bubbles: true }) as unknown as Event)
      expect(player.state().playing).toBe(false)
    })

    it('leaves a run the reader started with play alone when they scroll afterwards', async () => {
      const { click, document, content, win, player, wait } = bind({ rest: true, autoplay: true })
      click(document.querySelector('[data-action="play"]')!)
      expect(player.state().playing).toBe(true)
      content.dispatchEvent(new win.Event('wheel', { bubbles: true }) as unknown as Event)
      await wait(5)
      expect(player.state().playing, 'the reader asked for this run').toBe(true)
    })

    it('does not start once a control has been used', async () => {
      const { reveal, click, document, count, wait } = bind({ rest: true, autoplay: true })
      click(document.querySelector('[data-action="forward"]')!)
      reveal()
      await wait(40)
      expect(count()).toBe('2/4')
    })
  })

  describe('at rest', () => {
    it('shows step 1 without choosing it: the count, a hollow first mark, an empty fill and a Play button', () => {
      const { player, count, marks, document } = bind({ rest: true })
      expect(player.state()).toMatchObject({ step: 1, shown: 1, rest: true, playing: false })
      expect(count()).toBe('1/4')
      expect(marks().map((mark) => [mark.classList.contains('is-done'), mark.classList.contains('is-rest')])).toEqual([[true, false], [false, true], [false, false], [false, false], [false, false]])
      expect(marks()[1]!.getAttribute('aria-current')).toBe('step')
      expect(document.querySelector<HTMLElement>('[data-fill]')!.style.width).toBe('0%')
      expect(document.querySelector('[data-action="play"]')!.getAttribute('aria-label')).toBe('Play')
    })

    it('ends rest at the reader\'s first stepping action: Next goes to step 2, Back to the state before the first call, a mark to its step', () => {
      const next = bind({ rest: true })
      next.click(next.document.querySelector('[data-action="forward"]')!)
      expect(next.count()).toBe('2/4')
      expect(next.player.state().rest).toBe(false)
      const back = bind({ rest: true })
      back.click(back.document.querySelector('[data-action="back"]')!)
      expect(back.count()).toBe('0/4')
      const mark = bind({ rest: true })
      mark.click(mark.document.querySelector('[data-mark="3"]')!)
      expect(mark.count()).toBe('3/4')
      expect(mark.marks()[1]!.classList.contains('is-rest')).toBe(false)
    })

    it.each([['ArrowRight', '2/4'], ['ArrowLeft', '0/4'], ['Home', '0/4'], ['End', '4/4']])('leaves rest on %s', (name, expected) => {
      const { key, count, player } = bind({ rest: true })
      key(name)
      expect(count()).toBe(expected)
      expect(player.state().rest).toBe(false)
    })

    it('plays step 1 first: Play highlights it, then goes on to step 2', async () => {
      const { click, document, player, count, wait } = bind({ rest: true })
      click(document.querySelector('[data-action="play"]')!)
      expect(player.state()).toMatchObject({ step: 1, rest: false, playing: true })
      expect(count()).toBe('1/4')
      await wait(20)
      expect(Number(count()!.split('/')[0]), 'it goes on past step 1').toBeGreaterThanOrEqual(2)
    })

    it('is not at rest while a step is previewed or pinned, and returns to it when they let go', () => {
      const { player } = bind({ rest: true })
      player.hover(3)
      expect(player.state()).toMatchObject({ shown: 3, rest: false })
      player.hover(null)
      expect(player.state().rest).toBe(true)
      player.togglePin(2)
      player.clearPin()
      expect(player.state(), 'a pin is a stepping action').toMatchObject({ step: 1, rest: false })
    })

    it('opens a link\'s step instead, and a reader with another opening for reduced motion where it says', () => {
      expect(bind({ opening: 3, rest: false }).player.state()).toMatchObject({ step: 3, rest: false })
      expect(bind({ rest: true, reducedOpening: 'end' }, { reduced: true }).player.state()).toMatchObject({ step: 4, rest: false })
      expect(bind({ rest: true }, { reduced: true }).player.state(), 'reduced motion rests too when the host names no other opening').toMatchObject({ step: 1, rest: true })
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
