import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type HTMLButtonElement } from 'happy-dom'
import ts from 'typescript'
import { abbreviateNamespace, splitQualifiedName } from '../src/lib/api-labels'
import { API_MODELS } from '../src/lib/api-models'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))

const windows: Window[] = []
const sourceUrl = new URL('../src/components/api/ApiQualifiedName.astro', import.meta.url)
const componentSource = readFileSync(sourceUrl, 'utf8')
const apiCss = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
const kindCss = readFileSync(new URL('../src/styles/api-kinds.css', import.meta.url), 'utf8')
const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))

afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.abort()
})

/** Render the actual component; exercise its separately bundled script below. */
async function component() {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  async function compile(url: URL, imports: Record<string, string>) {
    const source = readFileSync(url, 'utf8').replace(/<script>[\s\S]*?<\/script>/g, '')
    const result = await transform(source, { filename: url.pathname,
      internalURL: 'astro/compiler-runtime', resultScopedSlot: true,
      resolvePath: (specifier: string) => specifier })
    expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
    let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
    for (const [specifier, href] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(href))
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  }
  const symbolName = await compile(new URL('../src/components/api/SymbolName.astro', import.meta.url), {
    '../../lib/word-break': new URL('../src/lib/word-break.ts', import.meta.url).href,
  })
  const url = await compile(sourceUrl, {
    './SymbolName.astro': symbolName,
    '../../lib/api-labels': new URL('../src/lib/api-labels.ts', import.meta.url).href,
  })
  return (await import(/* @vite-ignore */ url)).default
}

async function render(props: { name: string; kind?: string }) {
  const win = new Window()
  windows.push(win)
  const container = await experimental_AstroContainer.create()
  win.document.head.innerHTML = `<style>:root { --color-muted: #53606d; --color-link: #6f1a24; }${apiCss}${kindCss}</style>`
  win.document.body.innerHTML = await container.renderToString(await component(), { props: { kind: 'class', ...props } })
  return win
}

describe('qualified namespace labels', () => {
  it.each([
    '', 'libtmux', 'libtmux.common', 'libtmux._internal.constants',
    'LibTmux.Query.Json', 'LibTmux.Workspace', 'LibTmux\\Workspace',
    'libtmux::workspace', 'github.com/libtmux/libtmux-go/tmux',
    'io.github.libtmux.scaladsl.streaming',
  ])('keeps an ordinary namespace fully spelled: %s', (namespace) => {
    expect(abbreviateNamespace(namespace)).toBe(namespace)
  })

  it('keeps 48 graphemes and abbreviates only beyond that boundary', () => {
    const boundary = `library.${'n'.repeat(40)}`
    expect(boundary).toHaveLength(48)
    expect(abbreviateNamespace(boundary)).toBe(boundary)
    expect(abbreviateNamespace(`${boundary}x`)).toBe(`l.${'n'.repeat(40)}x`)
  })

  it('counts a combined Unicode character once when deciding whether to shorten', () => {
    const namespace = `${'e\u0301'.repeat(40)}.common`
    expect(abbreviateNamespace(namespace)).toBe(namespace)
  })

  it.each([
    ['company.product.services.execution.workspaces.management.runtime', 'c.p.s.e.w.m.runtime'],
    ['very_long_library::internal_adapters::compatibility::query_runtime', 'v::i::c::query_runtime'],
    ['github.com/exampleorganization/verylongrepository/internal/runtime', 'g.c/e/v/i/runtime'],
    ['e\u0301ngineering.product.services.execution.workspaces.management.runtime', 'e\u0301.p.s.e.w.m.runtime'],
  ])('retains the final segment and native separators for a long path: %s', (namespace, expected) => {
    expect(abbreviateNamespace(namespace)).toBe(expected)
  })

  it('leaves a long unqualified identifier intact', () => {
    const name = 'NamespaceWithoutASeparatorThatShouldNotGainAnExpansionControl'
    expect(abbreviateNamespace(name)).toBe(name)
  })

  it('renders the full name with a button that copies it', async () => {
    const name = 'libtmux.common.EnvironmentMixin'
    const win = await render({ name })
    expect(win.document.querySelector('.api-qualified-name code')?.textContent.trim()).toBe(name)
    const button = win.document.querySelector<HTMLButtonElement>('[data-api-copy-name]')!
    expect(button.getAttribute('data-api-copy-name')).toBe(name)
    expect(button.getAttribute('aria-label')).toBe('Copy fully qualified name')
    expect(win.document.querySelector('[data-api-expand-name], .api-namespace-short, .api-qualified-label')).toBeNull()
  })

  it('copies the name and reports it, and says so when the clipboard refuses', async () => {
    const name = 'company.product.services.execution.workspaces.management.runtime.Server'
    const win = await render({ name })
    const copied: string[] = []
    let refuse = false
    Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async (text: string) => { if (refuse) throw new Error('denied'); copied.push(text) } } })
    const script = /<script>([\s\S]*?)<\/script>/.exec(componentSource)?.[1]
    if (!script) throw new Error('Qualified-name client script is missing')
    win.eval(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)
    win.document.querySelector<HTMLButtonElement>('[data-api-copy-name]')!.click()
    await expect.poll(() => win.document.querySelector('[role="status"]')?.textContent, { timeout: 1000 }).toBe('Name copied')
    expect(copied).toEqual([name])
    refuse = true
    win.document.querySelector<HTMLButtonElement>('[data-api-copy-name]')!.click()
    await expect.poll(() => win.document.querySelector('[role="status"]')?.textContent, { timeout: 1000 }).toBe(`Copy failed. Select and copy: ${name}`)
  })

  it('hides the copy button without scripting', async () => {
    const win = await render({ name: 'libtmux.Server' })
    expect(win.document.querySelector('noscript')?.textContent ?? '').toContain('.api-copy-name { display: none; }')
  })
})

describe('a qualified name as a path to one declaration', () => {
  it.each([
    ['Rust', 'libtmux::pane::Pane::send_keys', 'libtmux::pane::Pane::', 'send_keys'],
    ['Rust tuple field', 'libtmux::control::Subscription::Pane.0', 'libtmux::control::Subscription::Pane.', '0'],
    ['Python', 'libtmux.common.EnvironmentMixin', 'libtmux.common.', 'EnvironmentMixin'],
    ['Ruby instance method', 'LibTmux::Async::Scope#close', 'LibTmux::Async::Scope#', 'close'],
    ['Ruby operator', 'LibTmux::Entity#==', 'LibTmux::Entity#', '=='],
    ['Lua method', 'libtmux.Buffer:reference', 'libtmux.Buffer:', 'reference'],
    ['PowerShell cmdlet', 'LibTmux.Workspace\\ConvertTo-TmuxWorkspace', 'LibTmux.Workspace\\', 'ConvertTo-TmuxWorkspace'],
    ['Elixir function', 'LibTmux.Capture.fetch/2', 'LibTmux.Capture.', 'fetch/2'],
    // A Swift name ends in its argument labels, which are part of the name: their colons are not a separator.
    ['Swift method', 'Window.filterFieldType(_:)', 'Window.', 'filterFieldType(_:)'],
    ['Swift operator', 'Client.!=(_:_:)', 'Client.', '!=(_:_:)'],
    ['a name with no owner', 'Server', '', 'Server'],
    ['a name with no owner and labels', 'buffers(_:)', '', 'buffers(_:)'],
  ])('splits %s at the declaration\'s own name', (_, name, path, leaf) => {
    expect(splitQualifiedName(name)).toEqual([path, leaf])
  })

  it('draws the path quiet and the declaration in its kind, and still copies the whole name', async () => {
    const name = 'libtmux::pane::Pane::send_keys'
    const win = await render({ name, kind: 'method' })
    const code = win.document.querySelector('.api-qualified-name code')!
    expect(code.textContent).toBe(name)
    expect(code.querySelector('.api-qualified-name__path')?.textContent).toBe('libtmux::pane::Pane::')
    const leaf = code.querySelector('.api-qualified-name__leaf')!
    expect([leaf.textContent, leaf.getAttribute('data-api-kind'), leaf.matches('.api-doc-link')]).toEqual(['send_keys', 'method', true])
    expect(win.document.querySelector('[data-api-copy-name]')?.getAttribute('data-api-copy-name')).toBe(name)
    const ink = (element: Parameters<Window['getComputedStyle']>[0]) => win.getComputedStyle(element).color
    expect(ink(leaf)).toBe(win.getComputedStyle(win.document.documentElement).getPropertyValue('--mark-callables-ink'))
    expect(ink(code.querySelector('.api-qualified-name__path')!)).toBe('#53606d')
  })

  it.each([
    ['class', 'types'], ['trait', 'traits'], ['method', 'callables'], ['attribute', 'members'],
  ])('tints a %s with the %s ink', async (kind, family) => {
    const win = await render({ name: 'libtmux::pane::Thing', kind })
    expect(win.getComputedStyle(win.document.querySelector('.api-qualified-name__leaf')!).color)
      .toBe(win.getComputedStyle(win.document.documentElement).getPropertyValue(`--mark-${family}-ink`))
  })

  it('has no path to quiet for a name with no owner', async () => {
    const win = await render({ name: 'Server', kind: 'class' })
    expect(win.document.querySelector('.api-qualified-name__path')).toBeNull()
    expect(win.document.querySelector('.api-qualified-name__leaf')?.textContent).toBe('Server')
  })
})

describe('the rows of the source and package disclosure', () => {
  const model = API_MODELS.rs
  const options = {
    real: ['components/api/ApiType.astro', 'components/api/SymbolName.astro', 'components/api/ApiBadge.astro', 'components/api/ApiQualifiedName.astro'],
    modules: {
      'astro-expressive-code/components': { Code: () => '' },
      '../../lib/page-ports-for': { pagePortsFor: async () => [] },
      '../../lib/sidebar': { pageBreadcrumbs: async () => [] },
    },
  }

  /** The real `ApiReference` page of one Rust member, with its shell stubbed. */
  async function page(id: string) {
    const template = await loadAstroTemplate('components/api/ApiReference.astro', options)
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, { props: { model, owner: model.symbols.find((symbol) => symbol.id === id)! } }))
    return win.document
  }
  /** The `dd` that follows the `dt` with this label. */
  const row = (document: Awaited<ReturnType<typeof page>>, label: string) =>
    [...document.querySelectorAll('.api-source-details dt')].find((term) => term.textContent === label)?.nextElementSibling

  it('names the declaring type as a code link in the type\'s own ink, like a link in prose', async () => {
    const link = row(await page('pane.Pane.send_keys'), 'Declared in')!.querySelector('a')!
    expect(link.textContent).toBe('Pane')
    expect(link.matches('.api-xref.api-mention.api-doc-link')).toBe(true)
    expect([link.getAttribute('data-api-kind'), link.getAttribute('title'), link.getAttribute('aria-label')]).toEqual(['struct', 'struct', 'struct: Pane'])
    expect(link.getAttribute('href')).toMatch(/\/reference\/pane-pane\/$/)
    expect(link.querySelector(':scope > code.api-literal.api-literal--link')?.textContent).toBe('Pane')
  })

  it('draws the qualified name with its path quiet and the method in the method ink', async () => {
    const name = row(await page('pane.Pane.send_keys'), 'Qualified name')!
    expect(name.querySelector('.api-qualified-name__path')?.textContent).toBe('libtmux::pane::Pane::')
    expect([name.querySelector('.api-qualified-name__leaf')?.textContent, name.querySelector('.api-qualified-name__leaf')?.getAttribute('data-api-kind')]).toEqual(['send_keys', 'method'])
  })
})

/**
 * The qualified name lives in the source and package disclosure, not under the
 * heading: the heading carries the name, and the disclosure carries where it is.
 * Returns what breaks that, so a control can prove the check is able to fail.
 */
function placement(source: string): string[] {
  const problems: string[] = []
  const header = source.slice(source.indexOf('<header'), source.indexOf('</header>'))
  if (/ApiQualifiedName|api-qualified-name/.test(header)) problems.push('the heading still carries the qualified name')
  const panel = source.slice(source.indexOf('<details class="api-source-details"'), source.indexOf('</details>', source.indexOf('<details class="api-source-details"')))
  if (!/<dt>Qualified name<\/dt>\s*<dd><ApiQualifiedName name=\{nativeQualifiedName\(model, owner\)\}[^>]*\/><\/dd>/.test(panel)) problems.push('the disclosure has no qualified name row')
  else if (!/<ApiQualifiedName [^>]*\bkind=\{owner\.kind\}/.test(panel)) problems.push('the qualified name is drawn without the declaration\'s kind')
  if (!/<dt>\{moduleLabel\}<\/dt>/.test(panel)) problems.push('the disclosure does not label its module row for the port')
  return problems
}

describe('where the qualified name lives', () => {
  const reference = readFileSync(new URL('../src/components/api/ApiReference.astro', import.meta.url), 'utf8')

  it('is a row of the source and package disclosure, with the module row named for the port', () => {
    expect(placement(reference)).toEqual([])
  })

  it('gives the distribution row another name where the module row says Package', () => {
    expect(reference).toContain("<dt>{moduleLabel === 'Package' ? 'Distribution' : 'Package'}</dt>")
  })

  describe('negative controls', () => {
    it('notices the line back under the heading', () => {
      const regressed = reference.replace('<h1 ', '<ApiQualifiedName name="x" /><h1 ')
      expect(placement(regressed)).toContain('the heading still carries the qualified name')
    })
    it('notices a qualified name drawn without the declaration\'s kind', () => {
      expect(placement(reference.replace(' kind={owner.kind}', ''))).toEqual(['the qualified name is drawn without the declaration\'s kind'])
    })
    it('notices a disclosure with no qualified name', () => {
      expect(placement(reference.replace('<dt>Qualified name</dt>', '<dt>Name</dt>'))).toContain('the disclosure has no qualified name row')
    })
  })
})
