import { afterEach, expect, it, vi } from 'vitest'
import { type HTMLElement, Window } from 'happy-dom'

let win: Window
afterEach(async () => {
  await win?.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function contents() {
  win = new Window({ url: 'https://libtmux.org/en/tmux/latest/manual/capture-pane/#option-h' })
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'HTMLHeadingElement',
    'customElements',
    'IntersectionObserver',
  ] as const) {
    vi.stubGlobal(key, key === 'window' ? win : win[key])
  }
  vi.stubGlobal('getComputedStyle', win.getComputedStyle.bind(win))
  win.document.documentElement.style.scrollPaddingTop = '72px'
  Object.defineProperty(win, 'scrollY', { configurable: true, value: 500 })
  Object.defineProperty(win.document.documentElement, 'scrollHeight', { configurable: true, value: 10000 })
  Object.defineProperty(win, 'requestIdleCallback', {
    value: (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 })
      return 1
    },
  })
  vi.spyOn(win, 'setTimeout').mockImplementation((callback) => {
    ;(callback as () => void)()
    return 1 as unknown as ReturnType<typeof win.setTimeout>
  })
  win.HTMLElement.prototype.scrollIntoView = () => {}
  win.document.body.innerHTML = `<header></header><main><article>
    <h2 id="common" data-top="-2000">Common uses</h2>
    <h2 id="options" data-top="-1000">Options</h2>
    <h3 id="formatting" data-top="-300">Text formatting</h3>
    <div id="option-h">-H</div>
    <h3 id="hidden" data-top="0" hidden>Hidden</h3>
    <h3 id="output" data-top="700">Output</h3>
  </article></main>
  <starlight-toc><a href="#common" aria-current="true">Common uses</a>
    <a href="#options">Options</a><a href="#formatting">Text formatting</a>
    <a href="#hidden">Hidden</a><a href="#output">Output</a></starlight-toc>`
  for (const element of win.document.querySelectorAll<HTMLElement>('h2, h3')) {
    element.style.scrollMarginTop = '72px'
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
      () => new win.DOMRect(0, Number(element.getAttribute('data-top')), 100, 24),
    )
    vi.spyOn(element, 'getClientRects').mockImplementation(
      () =>
        (element.hasAttribute('hidden') ? [] : [element.getBoundingClientRect()]) as ReturnType<
          typeof element.getClientRects
        >,
    )
  }
  vi.resetModules()
  await import('../src/components/TableOfContents/starlight-toc')
  const update = () => win.dispatchEvent(new win.Event('scroll'))
  const current = () => win.document.querySelector('starlight-toc [aria-current="true"]')?.getAttribute('href')
  return { update, current }
}

it('keeps the containing section active when an option lands between headings', async () => {
  const toc = await contents()
  toc.update()
  expect(toc.current()).toBe('#formatting')
})

it('tracks the preceding section through long content and ignores hidden headings', async () => {
  const toc = await contents()
  toc.update()
  win.document.getElementById('formatting')!.setAttribute('data-top', '700')
  win.document.getElementById('options')!.setAttribute('data-top', '-300')
  toc.update()
  expect(toc.current()).toBe('#options')
})

it('selects a heading at its CSS scroll-padding and scroll-margin landing position', async () => {
  const toc = await contents()
  win.document.getElementById('formatting')!.setAttribute('data-top', '144')
  toc.update()
  expect(toc.current()).toBe('#formatting')
})
