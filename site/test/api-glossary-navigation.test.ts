import { afterEach, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import * as model from '@libtmux/api-model'
import * as glossary from '../src/lib/api-glossary'
import { NATIVE_API_GLOSSARIES } from '../src/lib/api-glossary-native'
import * as models from '../src/lib/api-models'
import * as sections from '../src/lib/api-sections'
import * as relationships from '../src/lib/api-relationships'
import * as tree from '../src/lib/api-tree'
import * as search from '../src/lib/api-search'
import * as treeState from '../src/components/api/api-tree-state'
import * as labels from '../src/lib/api-labels'
import * as wordBreak from '../src/lib/word-break'
import * as ports from '../src/lib/ports'
import * as products from '../src/lib/product-api'
import * as versions from '../src/lib/versions'
import * as roots from '../src/lib/site-root'
import * as sidebar from '../src/lib/sidebar'
import * as documentation from '../src/lib/documentation-navigation'
import * as pagePorts from '../src/lib/page-ports-for'
import * as markdown from '../src/lib/markdown-twins'
import * as manual from '../src/lib/tmux-manual-data'
import * as locales from '../src/i18n/locales'
import * as resolve from '../src/i18n/resolve'
import * as contribute from '../src/i18n/contribute'
import * as constants from '../src/constants'
import * as toc from '../src/utils/generateToC'
import * as branding from '../src/lib/branding'
import mentions from '../src/data/mentions.json'

const windows: Window[] = []
afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.abort()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** Keep the edited templates, native catalogs, API tree and both contents renderers real. */
async function components() {
  const modules: Record<string, object> = {
    '@libtmux/api-model': model,
    ...Object.fromEntries(Object.entries({
      'api-glossary': glossary, 'api-models': models, 'api-sections': sections,
      'api-relationships': relationships, 'api-tree': tree, 'api-search': search,
      'api-labels': labels, 'word-break': wordBreak, ports, 'product-api': products,
      versions, 'site-root': roots, sidebar, 'documentation-navigation': documentation,
      'page-ports-for': pagePorts, 'markdown-twins': markdown, 'tmux-manual-data': manual,
      branding,
    }).map(([name, exports]) => [new URL(`../src/lib/${name}.ts`, import.meta.url).href, exports])),
    ...Object.fromEntries(Object.entries({ locales, resolve, contribute }).map(([name, exports]) =>
      [new URL(`../src/i18n/${name}.ts`, import.meta.url).href, exports])),
    [new URL('../src/components/api/api-tree-state.ts', import.meta.url).href]: treeState,
    [new URL('../src/constants.ts', import.meta.url).href]: constants,
    [new URL('../src/utils/generateToC.ts', import.meta.url).href]: toc,
    [new URL('../src/data/mentions.json', import.meta.url).href]: { default: mentions },
  }
  vi.stubGlobal('__glossaryNavigationModules', modules)
  const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  const runtime = pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href
  const realTemplates = new Set([
    'api/ApiReference.astro', 'api/ApiGlossary.astro', 'api/ApiGlossaryContent.astro',
    'api/ApiPageContents.astro', 'api/ApiTree.astro', 'api/ApiTreeItems.astro',
    'api/ApiBadge.astro', 'api/SymbolName.astro', 'TableOfContents/TableOfContents.astro',
    'TableOfContents/TableOfContentsList.astro', 'MobileToC.astro',
  ].map((name) => new URL(`../src/components/${name}`, import.meta.url).href))
  realTemplates.add(new URL('../src/layouts/DocsLayout.astro', import.meta.url).href)
  const compiled = new Map<string, string>()
  // Collection loading and outer chrome are outside this regression. No glossary or TOC stub.
  const shell = (await transform('<slot /><slot name="context" /><slot name="header-navigation" />', {
    filename: 'glossary-test-chrome.astro', internalURL: 'astro/compiler-runtime', resultScopedSlot: true,
    resolvePath: (specifier: string) => specifier,
  })).code.replaceAll('"astro/compiler-runtime"', JSON.stringify(runtime))
  const chrome = `data:text/javascript;base64,${Buffer.from(shell).toString('base64')}`

  async function compile(file: URL): Promise<string> {
    if (compiled.has(file.href)) return compiled.get(file.href)!
    const source = readFileSync(file, 'utf8')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
      .replace(/^import ['"][^'"\n]+\.css['"];?\s*$/gm, '')
    const result = await transform(source, { filename: file.pathname, internalURL: 'astro/compiler-runtime',
      resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
    expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
    let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(runtime))
    const specifiers = [...code.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1])
    for (const specifier of new Set(specifiers)) {
      if (specifier === 'astro/compiler-runtime' || specifier === runtime || specifier.startsWith('node:')) continue
      const path = specifier.startsWith('.') ? new URL(specifier, file) : undefined
      let replacement: string
      if (specifier.endsWith('.astro')) {
        replacement = realTemplates.has(path!.href) ? await compile(path!) : chrome
      } else {
        const key = path ? `${path.href}${/\.(?:ts|json)$/.test(path.pathname) ? '' : '.ts'}` : specifier
        const exports = modules[key]
        if (!exports) throw new Error(`Unbound real helper ${specifier} in ${file.pathname}`)
        const access = `globalThis.__glossaryNavigationModules[${JSON.stringify(key)}]`
        const names = Object.keys(exports).filter((name) => name !== 'default')
        const bridge = `${names.length ? `export const { ${names.join(', ')} } = ${access};` : ''}${'default' in exports ? `export default ${access}.default;` : ''}`
        replacement = `data:text/javascript;base64,${Buffer.from(bridge).toString('base64')}`
      }
      code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(replacement))
    }
    const url = `data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=${file.pathname}`).toString('base64')}`
    compiled.set(file.href, url)
    return url
  }
  return async (name: string) => (await import(/* @vite-ignore */ await compile(new URL(`../src/components/api/${name}.astro`, import.meta.url)))).default
}

function expectedHeadings(path: string) {
  return glossary.apiGlossary(path).groups.flatMap((group) => [
    { id: group.id, text: group.title }, ...group.terms.map((term) => ({ id: term.id, text: term.id })),
  ])
}

function checkHeadings(document: Document, path: string) {
  const expected = expectedHeadings(path)
  for (const { id, text } of expected) {
    const targets = [...document.querySelectorAll('[id]')].filter((element) => element.id === id)
    expect(targets, `${path} has one target for ${id}`).toHaveLength(1)
    const heading = targets[0]
    expect(['H2', 'H3']).toContain(heading.tagName)
    const permalink = heading.querySelector('a')!
    expect(permalink, `${path} heading ${id} has a permalink`).not.toBeNull()
    expect(permalink.getAttribute('href')).toBe(`#${id}`)
    expect(permalink.getAttribute('aria-label')).toContain(text)
    expect(permalink.textContent).toBe('#')
    expect(heading.lastElementChild).toBe(permalink)
    expect(permalink.getAttribute('data-pagefind-ignore')).toBe('all')
    expect(permalink.getAttribute('tabindex')).not.toBe('-1')
    if (heading.tagName === 'H3') expect(heading.querySelector('code')?.textContent).toBe(id)
  }
  expect(document.querySelectorAll('a a')).toHaveLength(0)
}

function checkContents(document: Document, path: string) {
  const expected = expectedHeadings(path)
  const outlets = document.querySelectorAll('nav[aria-label="On this page"], nav.toc-nav')
  expect(outlets.length, `${path} has within-page navigation`).toBeGreaterThan(0)
  for (const nav of outlets) {
    expect([...nav.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(expected.map(({ id }) => `#${id}`))
  }
}

it.fails.each([{ port: 'go', term: 'struct' }, { port: 'ts', term: 'class' }])('renders $port core glossary contents without replacing the API browse tree', async ({ port, term }) => {
  vi.stubEnv('LIBTMUX_DOCS_VERSION', 'v9-proof')
  const path = `${ports.referenceUrl(ports.PORT_BY_SLUG[port], 'v9-proof')}glossary/`
  const component = await (await components())('ApiReference')
  const container = await experimental_AstroContainer.create()
  const win = new Window({ url: `https://libtmux.org${path}#${term}` })
  windows.push(win)
  win.document.body.innerHTML = await container.renderToString(component, {
    props: { model: models.API_MODELS[port], glossary: true }, params: { slug: 'glossary' },
    request: new Request(`https://libtmux.org${path}`),
  })
  expect(win.document.querySelector('.api-nav-column [role="tree"]')).not.toBeNull()
  expect(win.document.querySelector(`.api-nav a[href="${path}"]`)?.getAttribute('aria-current')).toBe('page')
  checkContents(win.document, path)
  expect([...win.document.querySelectorAll('details')].some((details) =>
    details.querySelector('summary')?.textContent === 'On this page' && details.querySelector(`a[href="#${term}"]`))).toBe(true)
  checkHeadings(win.document, path)
  expect(win.document.querySelector('a[href$=".json"]')?.getAttribute('href')).toBe(`${path.slice(0, -1)}.json`)
})

it.fails.each([undefined, 'mcp', 'workspace'] as const)('preserves real DocsLayout contents and adds %s glossary permalinks', async (product) => {
  const path = product ? `${ports.referenceUrl(ports.PORT_BY_SLUG.go, 'v9-proof', product)}glossary/` : glossary.API_GLOSSARY_PATH
  const component = await (await components())('ApiGlossary')
  const container = await experimental_AstroContainer.create()
  const win = new Window({ url: `https://libtmux.org${path}` })
  windows.push(win)
  win.document.body.innerHTML = await container.renderToString(component, {
    props: { ...(product ? { port: 'go', product } : {}), version: 'v9-proof' },
    request: new Request(`https://libtmux.org${path}`),
  })
  checkContents(win.document, path)
  expect(win.document.querySelector('#mobile-toc nav.toc-nav')).not.toBeNull()
  checkHeadings(win.document, path)
})

it.fails.each(Object.keys(NATIVE_API_GLOSSARIES))('keeps %s filtered native glossary targets and definitions in every product', async (port) => {
  const component = await (await components())('ApiGlossaryContent')
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  windows.push(win)
  for (const product of ['', 'mcp/', 'workspace/']) {
    const path = `/preview-17/en/${port}/v9-proof/${product}reference/glossary/`
    win.document.body.innerHTML = await container.renderToString(component, { props: { contextPath: path } })
    const native = glossary.apiGlossary(path)
    expect([...win.document.querySelectorAll('h2[id], h3[id]')].map((heading) => heading.id)).toEqual(expectedHeadings(path).map(({ id }) => id))
    for (const group of native.groups) for (const term of group.terms) {
      const section = win.document.querySelector(`section[aria-labelledby="${term.id}"]`)!
      expect(section.textContent).toContain(term.definition)
      expect([...section.querySelectorAll('p a')].map((link) => link.getAttribute('href'))).toEqual(term.references.map((reference) => reference.url))
    }
    checkHeadings(win.document, path)
    expect(win.document.querySelector('a[href$=".json"]')?.getAttribute('href')).toBe(`${path.slice(0, -1)}.json`)
  }
})
