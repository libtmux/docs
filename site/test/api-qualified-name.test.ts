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
    const result = await transform(source, {
      filename: url.pathname,
      internalURL: 'astro/compiler-runtime',
      resultScopedSlot: true,
      resolvePath: (specifier: string) => specifier,
    })
    expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
    let code = result.code.replaceAll(
      '"astro/compiler-runtime"',
      JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href),
    )
    for (const [specifier, href] of Object.entries(imports))
      code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(href))
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

async function render(props: { name: string; namespace?: string; href?: string }) {
  const win = new Window()
  windows.push(win)
  const container = await experimental_AstroContainer.create()
  win.document.body.innerHTML = await container.renderToString(await component(), { props })
  return win
}

describe('qualified namespace labels', () => {
  it.each([
    '',
    'libtmux',
    'libtmux.common',
    'libtmux._internal.constants',
    'LibTmux.Query.Json',
    'LibTmux.Workspace',
    'LibTmux\\Workspace',
    'libtmux::workspace',
    'github.com/libtmux/libtmux-go/tmux',
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

  it('renders libtmux.common fully, with its original link and fully qualified copy value', async () => {
    const name = 'libtmux.common.EnvironmentMixin'
    const href = '/en/py/stable/reference/#libtmux.common'
    const win = await render({ name, namespace: 'libtmux.common', href })
    expect(win.document.querySelector('.api-qualified-namespace')?.textContent.trim()).toBe('libtmux.common')
    expect(win.document.querySelector('.api-qualified-namespace a')?.getAttribute('href')).toBe(href)
    expect(win.document.querySelector('.api-qualified-namespace a')?.getAttribute('aria-label')).toBe('libtmux.common')
    expect(win.document.querySelector('.api-namespace-short')).toBeNull()
    expect(win.document.querySelector('.api-namespace-full')).toBeNull()
    expect(win.document.querySelector('[data-api-expand-name]')).toBeNull()
    expect(win.document.querySelector('[data-api-copy-name]')?.getAttribute('data-api-copy-name')).toBe(name)
  })

  it('retains accessible expansion and full-name copying for long namespaces', async () => {
    const namespace = 'company.product.services.execution.workspaces.management.runtime'
    const name = `${namespace}.Server`
    const win = await render({ name, namespace, href: '/reference/#runtime' })
    const full = win.document.querySelector('.api-namespace-full')!
    const short = win.document.querySelector('.api-namespace-short')!
    const expand = win.document.querySelector<HTMLButtonElement>('[data-api-expand-name]')!
    expect(full.textContent).toBe(namespace)
    expect(short.textContent).toBe('c.p.s.e.w.m.runtime')
    expect(short.getAttribute('aria-hidden')).toBe('true')
    expect(expand.getAttribute('aria-controls')).toBe('api-namespace-path')
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    const copied: string[] = []
    Object.defineProperty(win.navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          copied.push(text)
        },
      },
    })
    const script = /<script>([\s\S]*?)<\/script>/.exec(componentSource)?.[1]
    if (!script) throw new Error('Qualified-name client script is missing')
    win.eval(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)
    expand.click()
    expect(expand.getAttribute('aria-expanded')).toBe('true')
    expect(win.document.querySelector('.api-qualified-name')?.hasAttribute('data-expanded')).toBe(true)
    expect(expand.textContent).toBe('Collapse')
    win.document.querySelector<HTMLButtonElement>('[data-api-copy-name]')!.click()
    await Promise.resolve()
    expect(copied).toEqual([name])
    await expect
      .poll(() => win.document.querySelector('[role="status"]')?.textContent, { timeout: 1000 })
      .toBe('Name copied')
    expand.click()
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    expect(expand.textContent).toBe('Show full name')
  })

  it('retains the existing no-JS full-name fallback', async () => {
    const namespace = 'company.product.services.execution.workspaces.management.runtime'
    const win = await render({ name: `${namespace}.Server`, namespace })
    const nojs = win.document.querySelector('noscript')?.textContent ?? ''
    expect(nojs).toContain('.api-copy-name, .api-expand-name, .api-namespace-short { display: none; }')
    expect(nojs).toContain('.api-qualified-name .api-namespace-full { display: inline; }')
  })
})
