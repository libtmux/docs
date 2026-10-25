import { afterEach, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { readFileSync, realpathSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window, type Document, type Element, type HTMLElement } from 'happy-dom'
import ts from 'typescript'
import { compile as compileTailwind } from 'tailwindcss'
import * as model from '@libtmux/api-model'
import * as glossary from '../src/lib/api-glossary'
import { NATIVE_API_GLOSSARIES } from '../src/lib/api-glossary-native'
import * as models from '../src/lib/api-models'
import * as sections from '../src/lib/api-sections'
import * as relationships from '../src/lib/api-relationships'
import * as tree from '../src/lib/api-tree'
import * as search from '../src/lib/api-search'
import * as apiSidebar from '../src/lib/api-sidebar'
import * as treeState from '../src/components/api/api-tree-state'
import * as labels from '../src/lib/api-labels'
import * as wordBreak from '../src/lib/word-break'
import * as nativeName from '../src/lib/native-name'
import * as ports from '../src/lib/ports'
import * as products from '../src/lib/product-api'
import * as versions from '../src/lib/versions'
import * as roots from '../src/lib/site-root'
import * as sidebar from '../src/lib/sidebar'
import * as documentation from '../src/lib/documentation-navigation'
import * as pagePorts from '../src/lib/page-ports-for'
import * as markdown from '../src/lib/markdown-twins'
import * as manual from '../src/lib/tmux-manual-data'
import * as reference from '../src/lib/tmux-reference'
import * as catalog from '../src/lib/tmux-catalog'
import * as locales from '../src/i18n/locales'
import * as resolve from '../src/i18n/resolve'
import * as contribute from '../src/i18n/contribute'
import * as ui from '../src/i18n/ui'
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

/**
 * Keep the edited templates, native catalogs, API tree and both contents renderers real.
 * `stubs` replaces a stubbed child, keyed by its path below `src/components`.
 */
async function components(stubs: Readonly<Record<string, string>> = {}) {
  const modules: Record<string, object> = {
    '@libtmux/api-model': model,
    ...Object.fromEntries(Object.entries({
      'api-glossary': glossary, 'api-models': models, 'api-sections': sections,
      'api-relationships': relationships, 'api-tree': tree, 'api-search': search, 'api-sidebar': apiSidebar,
      'api-labels': labels, 'word-break': wordBreak, 'native-name': nativeName, ports, 'product-api': products,
      versions, 'site-root': roots, sidebar, 'documentation-navigation': documentation,
      'page-ports-for': pagePorts, 'markdown-twins': markdown, 'tmux-manual-data': manual, 'tmux-reference': reference, 'tmux-catalog': catalog,
      branding,
    }).map(([name, exports]) => [new URL(`../src/lib/${name}.ts`, import.meta.url).href, exports])),
    ...Object.fromEntries(Object.entries({ locales, resolve, contribute, ui }).map(([name, exports]) =>
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
    'docs/DocumentationContext.astro', 'docs/DocumentationNavigationButtons.astro',
  ].map((name) => new URL(`../src/components/${name}`, import.meta.url).href))
  realTemplates.add(new URL('../src/layouts/DocsLayout.astro', import.meta.url).href)
  const compiled = new Map<string, string>()
  const styles: string[] = []
  // Collection loading and outer chrome are outside this regression. No glossary or TOC stub.
  const shell = (await transform('<slot /><slot name="context" /><slot name="header-navigation" />', {
    filename: 'glossary-test-chrome.astro', internalURL: 'astro/compiler-runtime', resultScopedSlot: true,
    resolvePath: (specifier: string) => specifier,
  })).code.replaceAll('"astro/compiler-runtime"', JSON.stringify(runtime))
  const chrome = `data:text/javascript;base64,${Buffer.from(shell).toString('base64')}`
  const replacements = new Map<string, string>()
  for (const [name, source] of Object.entries(stubs)) {
    const code = (await transform(source, {
      filename: `stub-${name}`, internalURL: 'astro/compiler-runtime', resultScopedSlot: true,
      resolvePath: (specifier: string) => specifier,
    })).code.replaceAll('"astro/compiler-runtime"', JSON.stringify(runtime))
    replacements.set(new URL(`../src/components/${name}`, import.meta.url).href, `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  }

  async function compile(file: URL): Promise<string> {
    if (compiled.has(file.href)) return compiled.get(file.href)!
    const source = readFileSync(file, 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
      .replace(/^import ['"][^'"\n]+\.css['"];?\s*$/gm, '')
    const result = await transform(source, { filename: file.pathname, internalURL: 'astro/compiler-runtime',
      resultScopedSlot: true, scopedStyleStrategy: 'attribute', resolvePath: (specifier: string) => specifier })
    expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
    styles.push(...result.css)
    let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(runtime))
      .replace(/^import ["'][^"'\n]+\?astro&type=style[^"'\n]+["'];?\s*$/gm, '')
    const specifiers = [...code.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1])
    for (const specifier of new Set(specifiers)) {
      if (specifier === 'astro/compiler-runtime' || specifier === runtime || specifier.startsWith('node:')) continue
      const path = specifier.startsWith('.') ? new URL(specifier, file) : undefined
      let replacement: string
      if (specifier.endsWith('.astro')) {
        replacement = realTemplates.has(path!.href) ? await compile(path!) : replacements.get(path!.href) ?? chrome
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
  return Object.assign(async (name: string) =>
    (await import(/* @vite-ignore */ await compile(new URL(`../src/components/api/${name}.astro`, import.meta.url)))).default, { styles })
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

it.each([{ port: 'go', term: 'struct' }, { port: 'ts', term: 'class' }])('renders $port core glossary contents without replacing the API browse tree', async ({ port, term }) => {
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
  expect(win.document.querySelector('.api-nav a[aria-current="page"]')?.textContent?.trim()).toBe('API glossary')
  expect(win.document.querySelector('.api-nav [data-api-root]')?.getAttribute('href')).toBe(ports.referenceUrl(ports.PORT_BY_SLUG[port], 'v9-proof'))
  checkContents(win.document, path)
  expect([...win.document.querySelectorAll('details')].some((details) =>
    details.querySelector('summary')?.textContent === 'On this page' && details.querySelector(`a[href="#${term}"]`))).toBe(true)
  checkHeadings(win.document, path)
  expect(win.document.querySelector('a[href$=".json"]')?.getAttribute('href')).toBe(`${path.slice(0, -1)}.json`)
})

it.each(['outline', 'focus', 'grouped'] as const)('keeps Full manual visible and current in the %s sidebar', async (presentation) => {
  const component = await (await components())('ApiTree')
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  windows.push(win)
  win.document.body.innerHTML = await container.renderToString(component, { props: {
    presentation, inventory: { port: 'tmux', buckets: [], members: {} },
    referenceBase: '/en/tmux/3.7c/manual/', portName: 'tmux', tree: [], members: [], withMembers: new Set(),
    currentPath: '/en/tmux/3.7c/manual/full/', version: '3.7c',
    glossaryHref: '/en/tmux/3.7c/manual/full/', glossaryLabel: 'Full manual',
  } })
  const link = win.document.querySelector('.api-nav a[aria-current="page"]')
  expect(link?.textContent?.trim()).toBe('Full manual')
  expect(link?.getAttribute('href')).toBe('/en/tmux/3.7c/manual/full/')
  expect(link?.closest('details')).toBeNull()
})

it('renders Up to the immediate parent before the sidebar script loads', async () => {
  const component = await (await components())('ApiTree')
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  windows.push(win)
  win.document.body.innerHTML = await container.renderToString(component, { props: {
    presentation: 'outline', selectedSymbol: 'create', inventory: { port: 'kotlin',
      buckets: [{ id: 'objects', label: 'Objects', count: 1, slug: 'session', children: [], types: [
        { id: 'session', name: 'Session', slug: 'session', kind: 'class', m: 1 },
      ] }], members: { session: [['Companion', 'companion', 'companion', 'module', 'types']], companion: [['create', 'create', 'create', 'method']] },
    }, referenceBase: '/pr-42/en/kotlin/latest/reference/', portName: 'Kotlin', tree: [], members: [], withMembers: new Set(),
    currentPath: '/pr-42/en/kotlin/latest/reference/create/', version: 'test',
  } })
  const up = win.document.querySelector('[data-api-owner-back]')!
  expect(up.getAttribute('href')).toBe('/pr-42/en/kotlin/latest/reference/companion/')
  expect(up.getAttribute('aria-label')).toBe('Up to Companion')
  // The client moves Up in place from this identity, so the markup must carry it.
  expect(up.getAttribute('data-symbol')).toBe('companion')
  expect(up.hasAttribute('hidden')).toBe(false)
})

it.each([
  { page: 'a top-level declaration', selectedSymbol: 'session', path: 'session/', hidden: false },
  { page: 'the reference root', selectedSymbol: '', path: '', hidden: true },
])('sends Up from $page to the reference root and hides it only at the root', async ({ selectedSymbol, path, hidden }) => {
  const component = await (await components())('ApiTree')
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  windows.push(win)
  const referenceBase = '/pr-42/en/kotlin/latest/reference/'
  win.document.body.innerHTML = await container.renderToString(component, { props: {
    presentation: 'outline', selectedSymbol, inventory: { port: 'kotlin',
      buckets: [{ id: 'objects', label: 'Objects', count: 1, slug: 'session', children: [], types: [
        { id: 'session', name: 'Session', slug: 'session', kind: 'class', m: 0 },
      ] }], members: {},
    }, referenceBase, portName: 'Kotlin', tree: [], members: [], withMembers: new Set(),
    currentPath: `${referenceBase}${path}`, version: 'test',
  } })
  const up = win.document.querySelector('[data-api-owner-back]')!
  expect(up.getAttribute('href')).toBe(referenceBase)
  expect(up.getAttribute('aria-label')).toBe('Up to reference root')
  expect(up.hasAttribute('hidden')).toBe(hidden)
  expect(up.getAttribute('data-symbol') ?? '').toBe('')
})

it('labels the owner picker before the sidebar script loads with the owner in its own spelling', async () => {
  const component = await (await components())('ApiTree')
  const container = await experimental_AstroContainer.create()
  const win = new Window()
  windows.push(win)
  const inventory = (spelling?: string) => ({ port: 'cxx',
    buckets: [{ id: 'objects', label: 'Objects', count: 1, slug: 'session', children: [], types: [
      { id: 'session', name: 'Session', slug: 'session', kind: 'class', m: 1 },
    ] }], members: { session: [['Node', 'node', 'node', 'class', 'types', '', 'libtmux::Session::Node', spelling] as never], node: [['leaf', 'leaf', 'leaf', 'method']] } })
  const label = async (spelling?: string) => {
    win.document.body.innerHTML = await container.renderToString(component, { props: {
      presentation: 'outline', selectedSymbol: 'leaf', inventory: inventory(spelling), referenceBase: '/en/cxx/latest/reference/', portName: 'C++',
      tree: [], members: [], withMembers: new Set(), currentPath: '/en/cxx/latest/reference/leaf/', version: 'test',
    } })
    return win.document.querySelector('[data-api-owner-label]')?.textContent
  }
  expect(await label('Session::Node')).toBe('Session::Node')
  expect(await label()).toBe('Node')
})

const PORT_SLUGS = ports.API_MODEL_PORTS.map((port) => port.slug)
/** What one rendered sidebar may add to a page, before and after compression. */
const SIDEBAR_RAW_BUDGET = 96 * 1024
const SIDEBAR_GZIP_BUDGET = 12 * 1024

async function sidebarMarkup(component: unknown, port: string, inventory: search.ApiTreeJson, selected: { id: string; slug: string }, presentation = 'outline') {
  const container = await experimental_AstroContainer.create()
  return container.renderToString(component as never, { props: {
    presentation, inventory, selectedSymbol: selected.id,
    referenceBase: `/en/${port}/latest/reference/`, portName: port, tree: [], members: [], withMembers: new Set(),
    currentPath: `/en/${port}/latest/reference/${selected.slug}/`, version: 'test',
  } })
}

it.each(PORT_SLUGS)('bounds the initial %s sidebar to its current path and deferred picker', async (port) => {
  const inventory = tree.referenceTree(port)
  const selected = inventory.buckets[0]!.types.find((entry) => !entry.shortcut)!
  const component = await (await components())('ApiTree')
  const html = await sidebarMarkup(component, port, inventory, selected)
  expect(Buffer.byteLength(html), `${port} sidebar bytes`).toBeLessThan(SIDEBAR_RAW_BUDGET)
  expect(gzipSync(html).byteLength, `${port} sidebar gzip bytes`).toBeLessThan(SIDEBAR_GZIP_BUDGET)
  const win = new Window()
  windows.push(win)
  win.document.body.innerHTML = html
  expect(win.document.querySelectorAll('[data-owner-id]')).toHaveLength(0)
  const top = win.document.querySelectorAll('.api-nav__tree > [data-lazy^="bucket:"]')
  expect(top.length).toBe(inventory.buckets.length)
  expect([...top].filter((row) => row.getAttribute('aria-expanded') === 'true')).toHaveLength(1)
  expect(win.document.querySelector('.api-nav__tree [aria-current="page"]')?.getAttribute('href'))
    .toBe(search.apiTreeHref(`/en/${port}/latest/reference/`, selected, inventory.hrefs))
}, 30_000)

// The heaviest sidebar belongs to whichever declaration opens the most rows, not to a
// type or a first entry. Ranking every declaration's rows finds it without rendering
// them all; the heaviest few are rendered and each must fit.
it.each(PORT_SLUGS)('keeps the heaviest %s sidebar inside the page-weight budget', async (port) => {
  const inventory = tree.referenceTree(port)
  const base = `/en/${port}/latest/reference/`
  const heaviest = apiSidebar.sidebarCatalog(inventory).records
    .map((record) => ({ record, rows: JSON.stringify(apiSidebar.sidebarNodes(inventory, base, 'outline', record.id)).length }))
    .sort((a, z) => z.rows - a.rows).slice(0, 5)
  const component = await (await components())('ApiTree')
  const sizes: number[] = []
  for (const { record } of heaviest) {
    const html = await sidebarMarkup(component, port, inventory, record)
    sizes.push(Buffer.byteLength(html))
    expect(sizes.at(-1), `${port} ${record.id} sidebar bytes`).toBeLessThan(SIDEBAR_RAW_BUDGET)
    expect(gzipSync(html).byteLength, `${port} ${record.id} sidebar gzip bytes`).toBeLessThan(SIDEBAR_GZIP_BUDGET)
  }
  // The ranking must lead to heavy pages: any page picked without it, such as a category's first, weighs no more.
  const first = inventory.buckets[0]!.types.find((entry) => !entry.shortcut)!
  expect(Math.max(...sizes), `${port} ranking finds the heaviest sidebar`)
    .toBeGreaterThanOrEqual(Buffer.byteLength(await sidebarMarkup(component, port, inventory, first)))
}, 60_000)

it('names each folded row by what it holds, and links it to the first page it holds only without a script', async () => {
  const members = Array.from({ length: 300 }, (_, i): [string, string, string, string] => [`member_${i}`, `big-member-${i}`, `big.member_${i}`, 'method'])
  const inventory: search.ApiTreeJson = { port: 'sample', members: { big: members }, buckets: [{ id: 'objects', label: 'Objects', count: 1, slug: 'big', children: [], types: [
    { id: 'big', name: 'Big', slug: 'big', m: 1, kind: 'class', category: 'types' }] }] }
  const templates = await components()
  const html = await sidebarMarkup(await templates('ApiTree'), 'sample', inventory, { id: 'big.member_150', slug: 'big-member-150' })
  for (const javascript of [true, false]) {
    const win = new Window()
    windows.push(win)
    // Select the real noscript payload for the DOM fixture, as the contents tests do.
    win.document.body.innerHTML = html.replace(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/g, javascript ? '' : '$1')
    await paint(win, [...templates.styles, readFileSync(new URL('../src/styles/api-tree.css', import.meta.url), 'utf8')])
    const folded = [...win.document.querySelectorAll('[data-lazy^="more:"]')]
    expect(folded, `folded rows (JavaScript ${javascript})`).toHaveLength(2)
    for (const row of folded) {
      const label = row.querySelector(':scope > .api-nav__row > span.api-nav__label')!
      const link = row.querySelector(':scope > .api-nav__row a')
      const first = Number(row.getAttribute('data-lazy')!.split(':').at(-1)!.split('-')[0])
      expect(label.textContent!.trim(), 'the name says what the row holds').toMatch(/^\d+ more members$/)
      expect(win.document.getElementById(row.getAttribute('aria-labelledby')!)).toBe(label)
      expect(row.getAttribute('aria-expanded')).toBe('false')
      if (javascript) expect(link, 'a script opens the row, so it is not a link').toBeNull()
      else {
        expect(link?.getAttribute('href')).toBe(`/en/sample/latest/reference/big-member-${first}/`)
        expect(link?.textContent?.trim()).toBe(label.textContent!.trim())
        expect(displayed(win, link), 'the link is shown').toBe(true)
        expect(displayed(win, label), 'and the text it stands in for is not').toBe(false)
      }
    }
  }
}, 60_000)

it('measures a sidebar that lists every member as over budget, and the same owner in Outline as within it', async () => {
  const members = Array.from({ length: 3000 }, (_, i): [string, string, string, string] => [`member_${i}`, `huge-member-${i}`, `huge.member_${i}`, 'method'])
  const inventory: search.ApiTreeJson = { port: 'sample', members: { huge: members }, buckets: [{ id: 'objects', label: 'Objects', count: 1, slug: 'huge', children: [], types: [
    { id: 'huge', name: 'Huge', slug: 'huge', m: 1, kind: 'class', category: 'types' }] }] }
  const component = await (await components())('ApiTree')
  const selected = { id: 'huge.member_1500', slug: 'huge-member-1500' }
  // Focus exists to list the owner's members, so it is the clean control for the measurement.
  const everyMember = await sidebarMarkup(component, 'sample', inventory, selected, 'focus')
  expect(Buffer.byteLength(everyMember)).toBeGreaterThan(SIDEBAR_RAW_BUDGET)
  expect(gzipSync(everyMember).byteLength).toBeGreaterThan(SIDEBAR_GZIP_BUDGET)
  const outline = await sidebarMarkup(component, 'sample', inventory, selected)
  expect(Buffer.byteLength(outline)).toBeLessThan(SIDEBAR_RAW_BUDGET)
  expect(gzipSync(outline).byteLength).toBeLessThan(SIDEBAR_GZIP_BUDGET)
  expect(outline).toContain('huge-member-1500')
}, 60_000)

it.each([undefined, 'mcp', 'workspace'] as const)('preserves real DocsLayout contents and adds %s glossary permalinks', async (product) => {
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

it.each(Object.keys(NATIVE_API_GLOSSARIES))('keeps %s filtered native glossary targets and definitions in every product', async (port) => {
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

// Use the installed Tailwind theme and actual emitted component CSS. No
// hand-written breakpoint styles stand in for the production controls.
async function paint(win: Window, styles: string[]) {
  const require = createRequire(new URL('../package.json', import.meta.url))
  const theme = readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8')
  const compiler = await compileTailwind(`${theme}\n@tailwind utilities;`)
  const classes = [...win.document.querySelectorAll('[class]')].flatMap((element) => [...element.classList])
  const style = win.document.createElement('style')
  style.textContent = `${compiler.build(classes)}\n${styles.join('\n')}`
  win.document.head.append(style)
}

function displayed(win: Window, element: Element | null): boolean {
  if (!element) return false
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (win.getComputedStyle(current).display === 'none') return false
  }
  return true
}

async function contentsPage(product: 'mcp' | undefined, width: number, javascript = true, empty = false) {
  const path = pathFor(product)
  const templates = await components()
  const container = await experimental_AstroContainer.create()
  const html = await container.renderToString(await templates(empty ? '../../layouts/DocsLayout' : 'ApiGlossary'), {
    props: empty
      ? { title: 'No headings', ...(product ? { port: 'go' } : {}), version: 'latest', navigation: [], pagePorts: [], breadcrumbs: [] }
      : { ...(product ? { port: 'go', product } : {}), version: 'latest' },
    request: new Request(`https://libtmux.org${path}`),
  })
  const win = new Window({ url: `https://libtmux.org${path}`, width, height: 899 })
  windows.push(win)
  // Select the real noscript payload for the DOM fixture. This does not claim
  // browser no-JavaScript rendering or geometry acceptance.
  win.document.body.innerHTML = html.replace(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/g, javascript ? '' : '$1')
  await paint(win, templates.styles)
  return win
}

const contentsCases = (widths: number[]) => [undefined, 'mcp' as const].flatMap((product) =>
  [true, false].flatMap((javascript) => widths.map((width) => ({ product, javascript, width }))))

async function checkContentsHandoff({ product, javascript, width }: ReturnType<typeof contentsCases>[number]) {
  const win = await contentsPage(product, width, javascript)
  const doc = win.document
  const desktop = doc.querySelector('main + aside nav.toc-nav')
  const fallback = [...doc.querySelectorAll('.mobile-fallback details')]
  const browse = fallback.find((details) => details.querySelector('summary')?.textContent === 'Browse documentation')
  const contents = fallback.find((details) => details.querySelector('summary')?.textContent === 'On this page')
  const compact = javascript ? doc.getElementById('mobile-toc-toggle') : contents ?? null
  expect(displayed(win, compact), 'compact contents remains available until its desktop replacement').toBe(width < 1280)
  expect(displayed(win, desktop), 'desktop contents retains its existing 80rem handoff').toBe(width >= 1280)
  expect([compact, desktop].filter((element) => displayed(win, element))).toHaveLength(1)
  if (javascript) {
    expect(displayed(win, doc.getElementById('mobile-sidebar-toggle')), 'navigation still hands off at 64rem').toBe(width < 1024)
    expect(displayed(win, doc.getElementById('mobile-toc'))).toBe(width < 1280)
    expect(displayed(win, doc.getElementById('mobile-toc-overlay'))).toBe(width < 1280)
    expect(doc.getElementById('mobile-toc-toggle')?.getAttribute('aria-controls')).toBe('mobile-toc')
    expect(doc.getElementById('mobile-toc')?.hasAttribute('inert')).toBe(true)
  } else {
    expect(displayed(win, browse ?? null), 'native navigation still hands off at 64rem').toBe(width < 1024)
    expect(displayed(win, doc.getElementById('mobile-toc-toggle'))).toBe(false)
    expect(displayed(win, doc.getElementById('mobile-toc'))).toBe(false)
    expect(contents?.querySelector('summary')?.textContent).toBe('On this page')
  }
  checkContents(doc, pathFor(product))
}

function pathFor(product: 'mcp' | undefined) {
  return product ? '/en/go/latest/mcp/reference/glossary/' : glossary.API_GLOSSARY_PATH
}

it.each(contentsCases([390, 1023, 1280, 1440]))('retains contents handoff controls at $width, product=$product, JS=$javascript', checkContentsHandoff)
it.each(contentsCases([1024, 1036, 1279]))('bridges contents handoff at $width, product=$product, JS=$javascript', checkContentsHandoff)

function hydrateDrawers(win: Window) {
  for (const name of ['layouts/DocsLayout.astro', 'components/MobileToC.astro']) {
    const source = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
    const script = source.match(/<script>([\s\S]*?)<\/script>/)![1]
    win.eval(ts.transpileModule(`(() => {${script}})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)
  }
}

function drawerState(win: Window, open: boolean) {
  const doc = win.document
  expect(doc.getElementById('mobile-toc-toggle')?.getAttribute('aria-expanded')).toBe(String(open))
  expect((doc.getElementById('mobile-toc') as HTMLElement | null)?.inert).toBe(!open)
  expect(doc.getElementById('mobile-toc')?.classList.contains('translate-x-full')).toBe(!open)
  expect(doc.getElementById('mobile-toc-overlay')?.classList.contains('invisible')).toBe(!open)
  expect(doc.body.style.overflow).toBe(open ? 'hidden' : '')
}

it.each([undefined, 'mcp' as const])('requests scroll-preserving %s contents focus on open and dismissal', async (product) => {
  const win = await contentsPage(product, 1036)
  hydrateDrawers(win)
  const doc = win.document
  const toggle = doc.getElementById('mobile-toc-toggle')! as HTMLElement
  const close = doc.getElementById('mobile-toc-close')! as HTMLElement
  toggle.focus()
  const enter = vi.spyOn(close, 'focus')
  const restore = vi.spyOn(toggle, 'focus')
  toggle.click()
  drawerState(win, true)
  expect(doc.activeElement).toBe(close)
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  drawerState(win, false)
  expect(doc.activeElement).toBe(toggle)
  expect({ enter: enter.mock.calls, restore: restore.mock.calls }).toEqual({
    enter: [[{ preventScroll: true }]],
    restore: [[{ preventScroll: true }]],
  })
})

it('keeps open contents through the sidebar handoff and cleans up at its desktop handoff', async () => {
  const win = await contentsPage('mcp', 1023)
  hydrateDrawers(win)
  ;(win.document.getElementById('mobile-toc-toggle') as HTMLElement)!.click()
  drawerState(win, true)
  for (const width of [1024, 1036, 1279]) {
    win.happyDOM.setWindowSize({ width, height: 899 })
    drawerState(win, true)
  }
  win.happyDOM.setWindowSize({ width: 1280, height: 899 })
  drawerState(win, false)
})

it.each([undefined, 'mcp' as const])('retains %s drawer focus, dismissal and one-drawer ownership', async (product) => {
  const win = await contentsPage(product, 390)
  hydrateDrawers(win)
  const doc = win.document
  const toggle = doc.getElementById('mobile-toc-toggle')! as HTMLElement
  const open = () => { toggle.focus(); toggle.click(); drawerState(win, true); expect(doc.activeElement?.id).toBe('mobile-toc-close') }
  open()
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  drawerState(win, false)
  expect(doc.activeElement).toBe(toggle)
  open()
  ;(doc.getElementById('mobile-toc-overlay') as HTMLElement)!.click()
  drawerState(win, false)
  expect(doc.activeElement).toBe(toggle)
  open()
  doc.querySelector<HTMLElement>('#mobile-toc a')!.click()
  drawerState(win, false)
  expect(doc.activeElement).toBe(toggle)
  open()
  ;(doc.getElementById('mobile-sidebar-toggle') as HTMLElement)!.click()
  expect((doc.getElementById('mobile-toc') as HTMLElement | null)?.inert).toBe(true)
  expect((doc.getElementById('mobile-sidebar') as HTMLElement | null)?.inert).toBe(false)
  expect(doc.body.style.overflow).toBe('hidden')
  win.happyDOM.setWindowSize({ width: 1036, height: 899 })
  expect((doc.getElementById('mobile-sidebar') as HTMLElement | null)?.inert).toBe(true)
  expect(doc.body.style.overflow).toBe('')
  let opened = 0
  doc.addEventListener('libtmux:drawer-open', () => opened++)
  doc.dispatchEvent(new win.Event('astro:after-swap'))
  doc.dispatchEvent(new win.Event('astro:after-swap'))
  open()
  expect(opened).toBe(1)
})

it.each([undefined, 'mcp' as const])('does not retain an empty %s toolbar after navigation becomes desktop', async (product) => {
  const win = await contentsPage(product, 1036, false, true)
  expect(win.document.getElementById('mobile-toc-toggle')).toBeNull()
  expect(displayed(win, win.document.querySelector('.mobile-toolbar'))).toBe(false)
  expect(displayed(win, win.document.querySelector('.mobile-fallback'))).toBe(false)
  expect(displayed(win, win.document.getElementById('mobile-sidebar-toggle'))).toBe(false)
})

it.each([895, 896, 1036])('preserves native/reference controls and their 56rem cutoff at %s', async (width) => {
  const templates = await components()
  const container = await experimental_AstroContainer.create()
  const navigation = await container.renderToString(await templates('../docs/DocumentationNavigationButtons'), {
    props: { tableOfContents: true, native: true },
  })
  const html = await container.renderToString(await templates('../docs/DocumentationContext'), {
    props: { port: 'go', version: 'latest', locale: 'en', sourcePath: 'go/latest/reference/', reference: true },
    slots: { navigation }, request: new Request('https://libtmux.org/en/go/latest/reference/'),
  })
  const win = new Window({ width, height: 899 })
  windows.push(win)
  win.document.body.innerHTML = html
  await paint(win, templates.styles)
  for (const [id, target] of [['mobile-sidebar-toggle', '__navigation'], ['mobile-toc-toggle', '__toc']]) {
    const control = win.document.getElementById(id)!
    expect(control.tagName).toBe('LABEL')
    expect(control.getAttribute('for')).toBe(target)
    expect(control.getAttribute('tabindex')).toBe('0')
    expect(displayed(win, control)).toBe(width < 896)
  }
})

// Renders the navigation the layout hands its sidebar as plain links.
const SIDEBAR_LINKS = `---
const { navigation = [] } = Astro.props
const links = (items) => items.flatMap((item) => item.type === 'group' ? links(item.items ?? []) : [item])
---
<nav data-sidebar-links>{links(navigation).map((item) => <a href={item.href}>{item.label}</a>)}</nav>`

it('points the tmux sidebar at tmux releases, not at the docs build slug', async () => {
  // A pull-request preview builds every page under its own slug.
  vi.stubEnv('LIBTMUX_DOCS_VERSION', 'pr-157')
  const templates = await components({ 'docs/Sidebar.astro': SIDEBAR_LINKS })
  const container = await experimental_AstroContainer.create()
  const html = await container.renderToString(await templates('../../layouts/DocsLayout'), {
    props: { title: 'Topics', pagePath: 'tmux/topics', pagePorts: [], breadcrumbs: [] },
    request: new Request('https://libtmux.org/tmux/topics/'),
  })
  const win = new Window({ url: 'https://libtmux.org/tmux/topics/' })
  windows.push(win)
  win.document.body.innerHTML = html
  const hrefs = [...win.document.querySelectorAll('[data-sidebar-links] a')].map((link) => link.getAttribute('href'))
  expect(hrefs).toContain(manual.tmuxManualUrl())
  expect(hrefs).toContain(catalog.tmuxCatalogUrl())
  expect(hrefs).toContain(reference.tmuxReferenceUrl())
  expect(hrefs.filter((href) => href?.includes('pr-157'))).toEqual([])
})
