import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type HTMLButtonElement } from 'happy-dom'
import ts from 'typescript'
import { abbreviateNamespace } from '../src/lib/api-labels'

const windows: Window[] = []
const sourceUrl = new URL('../src/components/api/ApiQualifiedName.astro', import.meta.url)
const componentSource = readFileSync(sourceUrl, 'utf8')
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

async function render(props: { name: string }) {
  const win = new Window()
  windows.push(win)
  const container = await experimental_AstroContainer.create()
  win.document.body.innerHTML = await container.renderToString(await component(), { props })
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
  if (!/<dt>Qualified name<\/dt>\s*<dd><ApiQualifiedName name=\{qualifiedNameOf\(owner\)\} \/><\/dd>/.test(panel)) problems.push('the disclosure has no qualified name row')
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
    it('notices a disclosure with no qualified name', () => {
      expect(placement(reference.replace('<dt>Qualified name</dt>', '<dt>Name</dt>'))).toContain('the disclosure has no qualified name row')
    })
  })
})
