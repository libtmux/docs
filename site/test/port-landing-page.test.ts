import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { landingExcerpt, landingProducts, type CachedSource, type LandingExcerpt, type LandingTable } from '../src/lib/port-landing'
import { PORTS, PORT_BY_SLUG, type DocProduct } from '../src/lib/ports'
import LANDING from '../src/data/landing-examples.json'
import SOURCES from '../src/data/example-sources.json'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const table = LANDING as LandingTable
const cache = SOURCES as Record<string, CachedSource>

// The page brings its own copy of the code-block component; this stands in with a marked element.
const Code = createComponent((_result: unknown, props: { code: string; lang: string; title?: string }) =>
  renderTemplate`<pre data-lang="${props.lang}" data-title="${props.title ?? ''}">${props.code}</pre>`)
const stubs = {
  'components/HomeExample.astro': '---\nconst { port, language } = Astro.props\n---\n<div data-home-example={port} data-language={language} />',
  'components/widgets/PackageInstall.astro': '---\nconst { ports, packageId = "core" } = Astro.props\n---\n<div data-package-install={ports.join()} data-package-id={packageId} />',
  'components/widgets/McpInstall.astro': '---\nconst { port } = Astro.props\n---\n<div data-mcp-install={port} />',
}

async function renderHtml(slug: string, modules: Record<string, Record<string, unknown>> = {}) {
  const template = await loadAstroTemplate('components/PortLanding.astro', {
    stubs,
    modules: { 'astro-expressive-code/components': { Code }, ...modules },
  })
  return renderAstroTemplate(template, { props: { port: PORT_BY_SLUG[slug], version: 'latest' } })
}

async function render(slug: string) {
  const window = new Window()
  window.document.body.innerHTML = await renderHtml(slug)
  return window.document as unknown as Document
}

describe('the landing page markup', () => {
  it('offers Core API, MCP and Workspace Manager as a selector for a port that ships all three', async () => {
    const document = await render('go')
    const options = [...document.querySelectorAll<HTMLInputElement>('input[data-landing-product]')]
    expect(options.map((input) => input.value)).toEqual(['core', 'mcp', 'workspace'])
    expect(options.map((input) => input.closest('label')!.textContent!.trim())).toEqual(['Core API', 'MCP', 'Workspace Manager'])
    expect(options.map((input) => input.type)).toEqual(['radio', 'radio', 'radio'])
    expect(options.map((input) => input.checked)).toEqual([true, false, false])
    expect(new Set(options.map((input) => input.name)).size, 'one radio group').toBe(1)
  })

  it('keeps menu entries to labels', async () => {
    const document = await render('go')
    for (const label of document.querySelectorAll('.landing-products label')) expect(label.textContent!.trim().split(/\s+/).length).toBeLessThanOrEqual(3)
  })

  it('shows no selector where there is nothing to choose', async () => {
    for (const slug of ['lua', 'elixir', 'kotlin', 'scala', 'fsharp']) {
      const document = await render(slug)
      expect(document.querySelector('input[data-landing-product]'), slug).toBeNull()
      expect([...document.querySelectorAll('[data-landing-panel]')].map((panel) => panel.getAttribute('data-landing-panel')), slug).toEqual(['core'])
    }
  })

  it('fixes the Core API panel to the port language with the homepage example', async () => {
    const document = await render('py')
    const home = document.querySelector('[data-landing-panel="core"] [data-home-example]')!
    expect(home.getAttribute('data-home-example')).toBe('py')
    expect(home.getAttribute('data-language')).toBe('Python')
    expect(document.querySelector('[data-landing-panel="core"] [data-package-install]')!.getAttribute('data-package-id')).toBe('core')
    expect(document.querySelector('[data-home-language]'), 'no language switcher').toBeNull()
  })

  it('shows each tested excerpt with its file, source and CI step', async () => {
    const document = await render('go')
    const entry = table.go!.mcp as LandingExcerpt
    const resolved = landingExcerpt(PORT_BY_SLUG.go!, 'mcp', table, cache)!
    const block = document.querySelector('[data-landing-panel="mcp"] pre')!
    expect(block.textContent).toBe(resolved.code)
    expect(block.getAttribute('data-title')).toBe(entry.file)
    expect(block.getAttribute('data-lang')).toBe('go')
    const caption = document.querySelector('[data-landing-panel="mcp"] .landing-source')!
    expect(caption.querySelector('a')!.getAttribute('href')).toBe(resolved.sourceUrl)
    expect(caption.textContent).toContain(entry.ci.workflow)
    expect(caption.textContent).toContain(entry.ci.command)
  })

  it('keeps the full install widget of each product in its panel', async () => {
    const document = await render('ts')
    const within = (product: string, selector: string) => document.querySelector(`[data-landing-panel="${product}"] ${selector}`)
    expect(within('core', '[data-package-install]')!.getAttribute('data-package-id')).toBe('core')
    expect(within('mcp', '[data-mcp-install]')!.getAttribute('data-mcp-install')).toBe('ts')
    expect(within('workspace', '[data-package-install]')!.getAttribute('data-package-id')).toBe('workspace')
    expect(within('mcp', '[data-package-install]')).toBeNull()
  })

  it('installs the .NET tool in the PowerShell MCP panel', async () => {
    const document = await render('powershell')
    expect(document.querySelector('[data-landing-panel="mcp"] [data-mcp-install]')!.getAttribute('data-mcp-install')).toBe('csharp')
    expect(document.querySelector('[data-landing-panel="mcp"] a[href="/powershell/latest/guides/mcp/"]')).not.toBeNull()
    expect(document.querySelector('[data-landing-panel="mcp"] .landing-note')!.textContent).toMatch(/PowerShell has no MCP package of its own.*C# port's LibTmux\.Mcp/)
    expect(document.querySelector('[data-landing-panel="workspace"] .landing-note'), 'Workspace Manager is PowerShell\'s own').toBeNull()
  })

  it('shows an excerpt in every panel but the one the port has no program for', async () => {
    for (const port of PORTS) {
      const document = await render(port.slug)
      for (const product of landingProducts(port).filter((candidate): candidate is DocProduct => candidate !== 'core')) {
        const gap = port.slug === 'julia' && product === 'mcp'
        const excerpt = document.querySelector(`[data-landing-panel="${product}"] [data-landing-excerpt]`)
        expect(excerpt === null, `${port.slug} ${product}`).toBe(gap)
        if (excerpt) expect(excerpt.querySelector('pre')!.textContent, `${port.slug} ${product}`).toBe(landingExcerpt(port, product, table, cache)!.code)
      }
    }
  })

  it('keeps the install widget and the documentation link where the port has no program for a product', async () => {
    const document = await render('julia')
    expect(document.querySelector('[data-landing-panel="mcp"] [data-landing-excerpt]')).toBeNull()
    expect(document.querySelector('[data-landing-panel="mcp"] [data-mcp-install]')!.getAttribute('data-mcp-install')).toBe('julia')
    expect(document.querySelector('[data-landing-panel="mcp"] a[href="/julia/latest/mcp/"]')).not.toBeNull()
  })
})

describe('the version root of a port', () => {
  afterEach(() => vi.unstubAllEnvs())

  async function renderRoot(slug: string) {
    vi.stubEnv('LIBTMUX_DOCS_PORT', slug)
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
    const page = await loadAstroTemplate('pages/index.astro', {
      real: ['components/PortLanding.astro'],
      stubs: { ...stubs, 'layouts/DocsLayout.astro': '---\n---\n<main><slot /></main>' },
      modules: {
        'astro-expressive-code/components': { Code },
        'astro:content': { getCollection: async () => [], render: async () => ({}) },
        '../i18n/resolve': { ALL_TRANSLATED: {}, buildLocale: () => 'en', localesFor: async () => ['en'] },
        '../lib/documentation-navigation': { getDocumentationSurfaces: async () => [] },
      },
    })
    const window = new Window()
    window.document.body.innerHTML = await renderAstroTemplate(page, { url: `https://libtmux.org/en/${slug}/latest/` })
    return window.document as unknown as Document
  }

  it('offers the selector instead of one long install list', async () => {
    const document = await renderRoot('go')
    expect(document.querySelectorAll('[data-port-landing]')).toHaveLength(1)
    expect(document.querySelector('[data-port-landing]')!.getAttribute('data-port-landing')).toBe('go')
    expect([...document.querySelectorAll<HTMLInputElement>('input[data-landing-product]')].map((input) => input.value)).toEqual(['core', 'mcp', 'workspace'])
    expect([...document.querySelectorAll('h2')].map((heading) => heading.textContent!.trim())).not.toContain('Install')
  })

  it('installs each product once, inside its own panel', async () => {
    const document = await renderRoot('go')
    expect(document.querySelectorAll('[data-package-install]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-mcp-install]')).toHaveLength(1)
    for (const widget of document.querySelectorAll('[data-package-install], [data-mcp-install]')) expect(widget.closest('[data-landing-panel]')).not.toBeNull()
  })

  it('shows a port that ships only the library as that library alone', async () => {
    const document = await renderRoot('lua')
    expect(document.querySelector('input[data-landing-product]')).toBeNull()
    expect(document.querySelectorAll('[data-landing-panel]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-package-install]')).toHaveLength(1)
  })
})

describe('the product panels of a port page', () => {
  it('names each panel from its tab, so the tab says what it controls', async () => {
    const document = await render('go')
    const tabs = [...document.querySelectorAll<HTMLInputElement>('input[data-landing-product]')]
    expect(tabs.map((input) => input.getAttribute('aria-controls'))).toEqual(['landing-panel-core', 'landing-panel-mcp', 'landing-panel-workspace'])
    for (const tab of tabs) expect(document.getElementById(tab.getAttribute('aria-controls')!)!.getAttribute('data-landing-panel'), tab.value).toBe(tab.value)
    expect(new Set([...document.querySelectorAll('[id]')].map((element) => element.id)).size, 'ids are unique').toBe(document.querySelectorAll('[id]').length)
  })

  it('refuses to render a port that has no homepage example, rather than a bare heading', async () => {
    await expect(renderHtml('go', { '../lib/quickstarts': { QUICKSTARTS: {}, homeCodeColumns: () => 80 } })).rejects.toThrow(/PortLanding: go has no complete homepage example/)
  })
})

/**
 * The selector's script, evaluated in a DOM the way install-widgets.test.ts
 * evaluates the install widgets', against the markup the component renders.
 * Each behaviour has a control: the same script with that one handler
 * disabled must leave the page as it was, so a test that passes without its
 * handler is caught here.
 */
describe('the selector script', () => {
  const PAGE = 'https://libtmux.org/en/go/latest/'
  const component = readFileSync(new URL('../src/components/PortLanding.astro', import.meta.url), 'utf8')
  const script = /<script>([\s\S]*?)<\/script>/.exec(component)![1]!
  const address = readFileSync(new URL('../src/lib/landing-selection.ts', import.meta.url), 'utf8')
  const commonjs = (source: string) => transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText

  /** `source` with the code `pattern` matches replaced, which must change it. */
  function without(source: string, pattern: RegExp, replacement = ''): string {
    const changed = source.replace(pattern, replacement)
    expect(changed, `the script still has ${pattern}`).not.toBe(source)
    return changed
  }

  async function mount(url: string, disabled?: (source: string) => string) {
    const window = new Window({ url })
    window.document.body.innerHTML = await renderHtml('go')
    const helpers: { exports: Record<string, unknown> } = { exports: {} }
    window.eval(`(function(module, exports) {\n${commonjs(address)}\n})`)(helpers, helpers.exports)
    const source = commonjs(disabled ? disabled(script) : script)
    window.eval(`(function(require, module, exports) {\n${source}\n})`)(() => helpers.exports, { exports: {} }, {})
    return window
  }

  const dom = (window: Window) => window.document as unknown as Document
  const chosen = (window: Window) => [...dom(window).querySelectorAll<HTMLInputElement>('input[data-landing-product]')].filter((input) => input.checked).map((input) => input.value)
  const choose = (window: Window, product: string) => {
    const input = dom(window).querySelector<HTMLInputElement>(`input[data-landing-product][value="${product}"]`)!
    input.checked = true
    input.dispatchEvent(new window.Event('change', { bubbles: true }) as unknown as Event)
  }

  it('selects the product the address names when the page loads', async () => {
    expect(chosen(await mount(`${PAGE}?product=mcp`))).toEqual(['mcp'])
    expect(chosen(await mount(`${PAGE}?cleanup=1&product=workspace`))).toEqual(['workspace'])
    expect(chosen(await mount(`${PAGE}?product=unknown`)), 'an unknown product leaves the first').toEqual(['core'])
    expect(chosen(await mount(`${PAGE}?product=mcp`, (source) => without(source, /\n    restore\(\)\n/, '\n'))), 'control: no restore on load').toEqual(['core'])
  })

  it('writes the choice to the address and keeps what else the address and history hold', async () => {
    const window = await mount(`${PAGE}?errors=1`)
    window.history.replaceState({ kept: true }, '')
    choose(window, 'mcp')
    expect(window.location.search).toBe('?errors=1&product=mcp')
    expect(window.history.state).toEqual({ kept: true })
    choose(window, 'workspace')
    expect(window.location.search).toBe('?errors=1&product=workspace')
    choose(window, 'core')
    expect(window.location.search, 'the first product leaves the address as it was').toBe('?errors=1')

    const control = await mount(PAGE, (source) => without(source, /document\.addEventListener\('change'/, "document.addEventListener('never'"))
    choose(control, 'mcp')
    expect(control.location.search, 'control: no change listener').toBe('')
  })

  it('follows the address back and forward on the same page', async () => {
    const window = await mount(PAGE)
    window.history.pushState({}, '', `${PAGE}?product=workspace`)
    window.dispatchEvent(new window.Event('popstate'))
    expect(chosen(window)).toEqual(['workspace'])
    window.history.pushState({}, '', PAGE)
    window.dispatchEvent(new window.Event('popstate'))
    expect(chosen(window), 'an address with no product is the first').toEqual(['core'])
    window.history.pushState({}, '', 'https://libtmux.org/en/go/latest/guides/?product=mcp')
    window.dispatchEvent(new window.Event('popstate'))
    expect(chosen(window), 'another page is not this selector\'s to restore').toEqual(['core'])

    const control = await mount(PAGE, (source) => without(source, /window\.addEventListener\('popstate'/, "window.addEventListener('never'"))
    control.history.pushState({}, '', `${PAGE}?product=workspace`)
    control.dispatchEvent(new control.Event('popstate'))
    expect(chosen(control), 'control: no popstate listener').toEqual(['core'])
    const unguarded = await mount(PAGE, (source) => without(source, /\n      if \(location\.pathname !== path\) return/, ''))
    unguarded.history.pushState({}, '', 'https://libtmux.org/en/go/latest/guides/?product=mcp')
    unguarded.dispatchEvent(new unguarded.Event('popstate'))
    expect(chosen(unguarded), 'control: no same-page guard').toEqual(['mcp'])
  })

  it('binds the markup a client-side navigation swaps in', async () => {
    const window = await mount(PAGE)
    const markup = window.document.body.innerHTML
    window.document.body.innerHTML = markup
    window.history.replaceState({}, '', `${PAGE}?product=workspace`)
    window.document.dispatchEvent(new window.Event('astro:after-swap'))
    expect(chosen(window)).toEqual(['workspace'])
    choose(window, 'mcp')
    expect(window.location.search, 'the swapped-in inputs write their choice too').toBe('?product=mcp')

    const control = await mount(PAGE, (source) => without(source, /document\.addEventListener\('astro:after-swap'/, "document.addEventListener('never'"))
    control.document.body.innerHTML = markup
    control.history.replaceState({}, '', `${PAGE}?product=workspace`)
    control.document.dispatchEvent(new control.Event('astro:after-swap'))
    expect(chosen(control), 'control: no rebinding after a swap').toEqual(['core'])
  })
})
