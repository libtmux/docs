import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { Window, type HTMLElement } from 'happy-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initDocumentationNavigation } from '../src/components/docs/documentation-navigation'

let win: Window
beforeEach(() => {
  win = new Window({ url: 'https://libtmux.org/en/cxx/latest/mcp/reference/arguments/' })
  for (const name of ['window', 'document', 'location', 'HTMLElement', 'HTMLAnchorElement', 'HTMLDetailsElement', 'Element', 'Node', 'AbortController', 'Event']) {
    vi.stubGlobal(name, name === 'window' ? win : name === 'document' ? win.document : name === 'location' ? win.location : win[name as keyof Window])
  }
  vi.spyOn(win.HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new win.DOMRect(20, 10, 160, 30))
  vi.spyOn(win.HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [this.getBoundingClientRect()]) as ReturnType<HTMLElement['getClientRects']>
  })
  win.document.body.innerHTML = `<details data-doc-picker data-page-port-switcher>
    <summary>Choose a port</summary><div data-picker-panel>
      <label data-picker-search-label hidden><input data-picker-search type="search"></label>
      <section data-picker-group><a id="matched" data-picker-option data-port="cxx" data-port-name="C++" data-match="cxx C++" href="/en/cxx/latest/mcp/reference/arguments/"><span>C++</span></a>
      <div data-picker-option data-port="rs" data-port-name="Rust" data-home-href="/en/rs/latest/mcp/" data-home-label="Go to Rust MCP home" data-match="rs Rust">
        <span>Rust<small>No matching page</small></span><a id="home" data-picker-home href="/en/rs/latest/mcp/" aria-label="Go to Rust MCP home">Home</a>
      </div></section><p data-picker-empty hidden></p><p data-picker-status></p>
    </div></details>`
})
afterEach(async () => {
  await win.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('includes unmatched home exits in keyboard search without inventing an equivalent', () => {
  initDocumentationNavigation()
  const picker = win.document.querySelector('details')!
  picker.open = true
  picker.dispatchEvent(new win.Event('toggle'))
  const input = win.document.querySelector('input')!
  input.value = 'rust'
  input.dispatchEvent(new win.Event('input'))
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  expect(win.document.activeElement?.id).toBe('home')
  expect(win.document.getElementById('home')!.closest('[aria-disabled]')).toBeNull()
  expect(win.document.querySelector<HTMLElement>('#matched')!.hidden).toBe(true)
  expect(win.document.querySelector('[data-picker-status]')!.textContent).toBe('1 matching entries')
  let clicked = false
  win.document.getElementById('home')!.addEventListener('click', (event) => { event.preventDefault(); clicked = true })
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  expect(clicked).toBe(true)
  // happy-dom does not give summary its browser-native focusability.
  const focus = vi.spyOn(picker.querySelector('summary')!, 'focus')
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(picker.open).toBe(false)
  expect(focus).toHaveBeenCalledWith({ preventScroll: true })
})

it('keeps the glossary term on ordinary and modified picker activation', () => {
  const link = win.document.getElementById('matched')!
  link.setAttribute('data-preserve-fragment', '')
  link.setAttribute('href', '/en/julia/latest/mcp/reference/glossary/')
  win.location.hash = '#attribute'
  initDocumentationNavigation()
  link.addEventListener('click', (event) => event.preventDefault())
  link.dispatchEvent(new win.MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true }))
  expect(link.getAttribute('href')).toBe('https://libtmux.org/en/julia/latest/mcp/reference/glossary/#attribute')
})

it('retains separate native-page home exits when fragment equivalents change', () => {
  const context = { port: 'cxx', primary: 'native-one', symbols: {
    'native-one': [], 'native-two': [{ port: 'rs', href: '/en/rs/latest/reference/server/', label: 'Server' }],
  } }
  win.document.body.insertAdjacentHTML('beforeend', `<script type="application/json" data-native-page-ports>${JSON.stringify(context)}</script>`)
  const source = readFileSync(new URL('../src/components/docs/NativeSphinxScript.astro', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)![1]
  win.eval(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)
  const option = () => win.document.querySelector('[data-picker-option][data-port="rs"]')!
  expect(option().tagName).toBe('DIV')
  expect(option().querySelector('[data-picker-home]')?.getAttribute('href')).toBe('/en/rs/latest/mcp/')
  expect(option().querySelector('[aria-disabled] a')).toBeNull()
  win.location.hash = '#native-two'
  win.dispatchEvent(new win.Event('hashchange'))
  expect(option().tagName).toBe('A')
  expect(option().getAttribute('href')).toBe('/en/rs/latest/reference/server/')
  expect(option().querySelector('a')).toBeNull()
  win.location.hash = '#native-one'
  win.dispatchEvent(new win.Event('hashchange'))
  expect(option().querySelectorAll('[data-picker-home]')).toHaveLength(1)
  expect(option().textContent).toContain('No matching page')
})
