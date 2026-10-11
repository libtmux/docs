import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import type { PagePortLink } from '../src/lib/page-port-links'
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
  const stale = win.document.querySelector('[data-picker-option][data-port="rs"]')!
  stale.setAttribute('title', 'Old destination')
  stale.setAttribute('aria-label', 'Old destination')
  const context = { port: 'cxx', primary: 'native-one', symbols: {
    'native-one': [], 'native-two': [{ port: 'rs', href: '/en/rs/latest/reference/server/', label: 'Server' }],
  } }
  win.document.body.insertAdjacentHTML('beforeend', `<script type="application/json" data-native-page-ports>${JSON.stringify(context)}</script>`)
  const source = readFileSync(new URL('../src/components/docs/NativeSphinxScript.astro', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)![1]
  win.eval(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)
  const option = () => win.document.querySelector('[data-picker-option][data-port="rs"]')!
  expect(option().tagName).toBe('DIV')
  expect(option().hasAttribute('title')).toBe(false)
  expect(option().hasAttribute('aria-label')).toBe(false)
  expect(option().querySelector('[data-picker-home]')?.getAttribute('href')).toBe('/en/rs/latest/mcp/')
  expect(option().querySelector('[aria-disabled] a')).toBeNull()
  win.location.hash = '#native-two'
  win.dispatchEvent(new win.Event('hashchange'))
  expect(option().tagName).toBe('A')
  expect(option().getAttribute('href')).toBe('/en/rs/latest/reference/server/')
  expect(option().querySelector('a')).toBeNull()
  expect(option().querySelector('small')).toBeNull()
  expect(option().getAttribute('title')).toBe('Rust: Server')
  expect(option().getAttribute('aria-label')).toBe('Rust: Server')
  win.location.hash = '#native-one'
  win.dispatchEvent(new win.Event('hashchange'))
  expect(option().querySelectorAll('[data-picker-home]')).toHaveLength(1)
  expect(option().textContent).toContain('No matching page')
  expect(option().hasAttribute('title')).toBe(false)
  expect(option().hasAttribute('aria-label')).toBe(false)
})


const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
let pickerComponent: Promise<Parameters<Awaited<ReturnType<typeof experimental_AstroContainer.create>>['renderToString']>[0]> | undefined

async function renderPicker(entries: PagePortLink[]) {
  pickerComponent ??= (async () => {
    const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
    async function compile(relative: string, imports: Record<string, string>) {
      const file = new URL(relative, import.meta.url)
      const source = readFileSync(file, 'utf8').replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/^import ['"][^'"]+\.css['"]\s*$/gm, '')
      const result = await transform(source, { filename: file.pathname, internalURL: 'astro/compiler-runtime',
        resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
      expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
      let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
      for (const [specifier, href] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(href))
      return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    }
    const root = new URL('../src/lib/site-root.ts', import.meta.url).href
    const logo = await compile('../src/components/tmux/Logo.astro', { '../../lib/site-root': root })
    const component = await compile('../src/components/PagePortSwitcher.astro', {
      '../lib/ports': new URL('../src/lib/ports.ts', import.meta.url).href,
      '../lib/branding': new URL('../src/lib/branding.ts', import.meta.url).href,
      '../lib/site-root': root, './tmux/Logo.astro': logo,
    })
    return (await import(/* @vite-ignore */ component)).default
  })()
  const container = await experimental_AstroContainer.create()
  win.document.body.innerHTML = await container.renderToString(await pickerComponent, { props: { entries, portSlug: 'julia' } })
}

it('renders section fallbacks as truthful overview exits without repeated destination titles', async () => {
  const entries: PagePortLink[] = [
    { port: 'julia', name: 'Julia', links: [{ href: '/pr-42/en/julia/v1.2.3/topics/ownership/' }] },
    { port: 'py', name: 'Python', links: [{ href: '/pr-42/en/py/stable/topics/', label: 'Topics overview', fallback: 'section' }],
      home: { href: '/pr-42/en/py/stable/', label: 'Go to Python home' } },
    { port: 'lua', name: 'Lua', links: [], home: { href: '/pr-42/en/lua/latest/', label: 'Go to Lua home' } },
  ]
  await renderPicker(entries)
  const current = win.document.querySelector('[data-picker-option][data-port="julia"]')!
  expect(current.tagName).toBe('A')
  expect(current.getAttribute('href')).toBe(entries[0].links[0].href)
  expect(current.getAttribute('aria-current')).toBe('page')
  const overview = win.document.querySelector('[data-picker-option][data-port="py"]')!
  expect(overview.tagName).toBe('DIV')
  expect(overview.textContent.trim()).toBe('PythonNo matching page')
  expect(overview.textContent).not.toContain('Topics overview')
  const exit = overview.querySelector('[data-picker-home]')!
  expect(exit.getAttribute('href')).toBe(entries[1].links[0].href)
  expect(exit.getAttribute('aria-label')).toBe('Go to Python Topics overview')
  expect(exit.getAttribute('title')).toBe('Go to Python Topics overview')
  expect(exit.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  expect(overview.querySelector('[aria-disabled]')).toBeNull()
  expect(overview.hasAttribute('aria-current')).toBe(false)
  const home = win.document.querySelector('[data-port="lua"] [data-picker-home]')!
  expect(home.getAttribute('href')).toBe(entries[2].home!.href)
  expect(home.getAttribute('aria-label')).toBe('Go to Lua home')

  // These ordinary anchors also work without the shared client initializer.
  expect(win.document.querySelectorAll('[data-port="py"] a')).toHaveLength(1)
  initDocumentationNavigation()
  const picker = win.document.querySelector('details')!
  picker.open = true
  picker.dispatchEvent(new win.Event('toggle'))
  const input = win.document.querySelector('input')!
  input.value = 'python topics'
  input.dispatchEvent(new win.Event('input'))
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  expect(win.document.activeElement).toBe(exit)
  let clicked = false
  exit.addEventListener('click', (event) => { event.preventDefault(); clicked = true })
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  expect(clicked).toBe(true)
})

it('keeps single native distinctions accessible and genuine multiple choices visible', async () => {
  const entries: PagePortLink[] = [
    { port: 'julia', name: 'Julia', links: [{ href: '/en/julia/latest/reference/libtmux-sessions/', label: 'sessions (function)' }] },
    { port: 'powershell', name: 'PowerShell', links: [{ href: '/en/powershell/latest/reference/libtmux-get-tmuxsession/', label: 'Get-TmuxSession (cmdlet)' }] },
    { port: 'ruby', name: 'Ruby', links: [
      { href: '/en/ruby/latest/mcp/guides/connect-client/', label: 'Connect a client' },
      { href: '/en/ruby/latest/mcp/source-guide/', label: 'MCP server guide' },
    ] },
  ]
  await renderPicker(entries)
  for (const entry of entries.slice(0, 2)) {
    const link = win.document.querySelector(`[data-picker-option][data-port="${entry.port}"]`)!
    expect(link.querySelector('small')).toBeNull()
    expect(link.getAttribute('href')).toBe(entry.links[0].href)
    expect(link.getAttribute('aria-label')).toBe(`${entry.name}: ${entry.links[0].label}`)
    expect(link.getAttribute('title')).toBe(`${entry.name}: ${entry.links[0].label}`)
  }
  const choices = [...win.document.querySelectorAll('[data-picker-option][data-port="ruby"]')]
  expect(choices.map((choice) => choice.querySelector('small')?.textContent)).toEqual(['Connect a client', 'MCP server guide'])
  expect(choices.map((choice) => choice.getAttribute('href'))).toEqual(entries[2].links.map((link) => link.href))
})
