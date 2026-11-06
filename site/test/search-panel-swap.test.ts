import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'

const component = readFileSync(new URL('../src/components/SearchPanel.astro', import.meta.url), 'utf8')
const script = /<script>([\s\S]*?)<\/script>/.exec(component)![1]
const client = ts.transpileModule(script.replace(/^ {2}import .*$/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

const windows: Window[] = []
afterEach(async () => { await Promise.all(windows.splice(0).map((win) => win.happyDOM.close())) })

const modal = (id: string) => `<dialog id="${id}"><div class="search-panel" data-search-bundle="/pagefind/"></div></dialog>`
const open = (win: Window, id: string) =>
  win.document.getElementById(id)!.dispatchEvent(new win.CustomEvent('search-modal:open'))

it('mounts the panel of each page a swap brings in, not only the first', () => {
  const win = new Window({ url: 'https://libtmux.org/en/ts/latest/guides/panes/' })
  windows.push(win)
  const handle = { focus: vi.fn(), clear: vi.fn(), ready: Promise.resolve() }
  const mountSearchPanel = vi.fn((_root: Element) => handle)
  Object.assign(win, { mountSearchPanel, waitForAppearance: vi.fn() })
  win.document.body.innerHTML = modal('first')
  win.eval(client)

  open(win, 'first')
  expect(mountSearchPanel).toHaveBeenCalledTimes(1)
  expect(mountSearchPanel.mock.calls[0]![0]).toBe(win.document.querySelector('#first .search-panel'))

  // The router replaces the body and announces the new one.
  win.document.body.innerHTML = modal('second')
  win.document.dispatchEvent(new win.Event('astro:after-swap'))
  open(win, 'second')
  expect(mountSearchPanel).toHaveBeenCalledTimes(2)
  expect(mountSearchPanel.mock.calls[1]![0]).toBe(win.document.querySelector('#second .search-panel'))
})

it('mounts a panel that is not in a dialog when its page arrives by swap', () => {
  const win = new Window({ url: 'https://libtmux.org/en/ts/latest/guides/panes/' })
  windows.push(win)
  const mountSearchPanel = vi.fn(() => ({ focus: vi.fn(), clear: vi.fn(), ready: Promise.resolve() }))
  const waitForAppearance = vi.fn()
  Object.assign(win, { mountSearchPanel, waitForAppearance })
  win.document.body.innerHTML = '<p>guide</p>'
  win.eval(client)
  expect(mountSearchPanel).not.toHaveBeenCalled()

  win.document.body.innerHTML = '<div class="search-panel" data-search-bundle="/pagefind/"></div>'
  win.document.dispatchEvent(new win.Event('astro:after-swap'))
  expect(mountSearchPanel).toHaveBeenCalledTimes(1)
  expect(waitForAppearance).toHaveBeenCalledTimes(1)
})
