import { readFileSync } from 'node:fs'
import { Window, type Document, type HTMLButtonElement } from 'happy-dom'
import ts from 'typescript'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createComponent, render } from 'astro/compiler-runtime'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'
import {
  CONCEPT_DESCRIPTION, DOC_PRODUCTS, PORT_BY_SLUG, PORTS, PRODUCT_STATUS_GUIDE,
  productDescription, productInDevelopment, productIsConcept, releaseMaturity, type DocProduct,
} from '../src/lib/ports'
import { registryFor } from '../src/lib/registry'

/**
 * A product's status is a dismissible bar under the header, the same kind of
 * notice as the release bar, and never an admonition in the article.
 *
 * The notice, the layouts that place it and the head script that remembers a
 * dismissal are the real templates; only unrelated page chrome is stubbed.
 */
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const script = (text: string, what: string) => {
  const found = /<script>([\s\S]*?)<\/script>/.exec(text)?.[1]
  if (!found) throw new Error(`${what} has no bundled script`)
  return found
}
const KEY = 'libtmux-docs.product-notice.'
const IN_DEVELOPMENT = 'Server behavior and tool contracts may change. Tool availability depends on the server configuration.'
const PRODUCTS = Object.keys(DOC_PRODUCTS) as DocProduct[]
const PRIMARY = PORTS.filter((port) => !port.parentLibrary)
const windows: Window[] = []

/** What a port's product says about itself, written out from the support policy rather than read from the notice. */
function expectedStatus(slug: string, product: DocProduct) {
  const port = PORT_BY_SLUG[slug]!
  if (productIsConcept(port, product)) return { id: `${product}-concept`, badge: 'Concept example', text: CONCEPT_DESCRIPTION }
  if (productInDevelopment(port, product)) {
    return { id: `${product}-in-development`, badge: 'In development', text: product === 'workspace' ? productDescription(port, product) : IN_DEVELOPMENT }
  }
  return undefined
}

function parse(html: string, url = 'https://libtmux.org/en/ocaml/latest/workspace/') {
  const win = new Window({ url })
  windows.push(win)
  win.document.write(html)
  return win
}

afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.abort()
  vi.unstubAllEnvs()
})

describe('the status bar of a product', () => {
  let notice: Awaited<ReturnType<typeof loadAstroTemplate>>
  beforeAll(async () => { notice = await loadAstroTemplate('components/ProductNotice.astro') })

  const bar = async (port: string, product: DocProduct) => {
    const html = withoutScope(await renderAstroTemplate(notice, { props: { port, product } }))
    return { html, document: parse(html).document }
  }

  it.each([
    ['ocaml', 'workspace', 'workspace-concept'],
    ['ts', 'workspace', 'workspace-concept'],
    ['java', 'mcp', 'mcp-concept'],
    ['go', 'mcp', 'mcp-concept'],
    ['py', 'mcp', 'mcp-in-development'],
  ] as const)('names the %s %s page status %s in a bar, not in an admonition', async (port, product, id) => {
    const { document } = await bar(port, product)
    const element = document.querySelector('[data-product-notice]')!
    expect(element, `${port} ${product} draws a bar`).not.toBeNull()
    expect(element.getAttribute('data-product-notice')).toBe(id)
    expect(element.classList.contains('prerelease-notice')).toBe(true)
    expect(document.querySelectorAll('[role="note"], aside, .lm-aside')).toHaveLength(0)
  })

  it.each([['py', 'workspace'], ['lua', 'mcp'], ['ocaml', 'mcp'], ['lisp', 'mcp']] as const)('has nothing to say on the %s %s page', async (port, product) => {
    expect((await bar(port, product)).html.trim()).toBe('')
  })

  it.each(PRIMARY.flatMap((port) => PRODUCTS.map((product) => [port.slug, product] as const)))('renders %s %s as its support policy says, dismissible and visible without JavaScript', async (port, product) => {
    const { html, document } = await bar(port, product)
    const expected = expectedStatus(port, product)
    if (!expected) {
      expect(html.trim(), 'a product with no status draws no bar').toBe('')
      return
    }
    const element = document.querySelector('[data-product-notice]')!
    expect(element, `${port} ${product} draws a bar`).not.toBeNull()
    expect(element.getAttribute('data-product-notice')).toBe(expected.id)
    expect(element.querySelector('.prerelease-notice__badge')?.textContent?.trim()).toBe(expected.badge)
    const text = element.querySelector('.prerelease-notice__text')!
    expect(text.textContent).toContain(expected.text)
    expect(text.querySelector('code'), 'a bar carries prose with no code span to link').toBeNull()
    const guide = [...text.querySelectorAll('a')]
    if (expected.badge === 'Concept example') {
      expect(guide.map((link) => link.textContent?.trim())).toEqual(['What concept means'])
      expect(guide[0]!.getAttribute('href')).toMatch(new RegExp(`${PRODUCT_STATUS_GUIDE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    } else expect(guide).toHaveLength(0)
    const dismiss = element.querySelector('button[data-product-notice-dismiss]')!
    expect(dismiss.getAttribute('type')).toBe('button')
    expect(dismiss.getAttribute('data-product-notice-dismiss')).toBe(expected.id)
    expect(dismiss.getAttribute('aria-label')).toBe(`Dismiss the ${DOC_PRODUCTS[product].label} ${expected.badge.toLowerCase()} notice`)
    expect(dismiss.querySelector('.prerelease-notice__dismiss-label')?.textContent).toBe('Dismiss')
    // Without JavaScript nothing hides the bar: only a root attribute that a script sets does.
    expect(element.hasAttribute('hidden')).toBe(false)
    expect(element.hasAttribute('style')).toBe(false)
    expect(document.querySelectorAll('[role="note"], aside, .lm-aside')).toHaveLength(0)
  })
})

describe('where a page puts the bar', () => {
  const layouts = {
    real: ['layouts/DocsLayout.astro', 'layouts/BaseLayout.astro', 'components/PrereleaseNotice.astro', 'components/ProductNotice.astro', 'components/Aside.astro'],
    stubs: { 'components/ProseText.astro': '---\nconst { text } = Astro.props\n---\n<p>{text}</p>' },
  }
  let docs: Awaited<ReturnType<typeof loadAstroTemplate>>
  beforeAll(async () => { docs = await loadAstroTemplate('layouts/DocsLayout.astro', layouts) })

  async function page(props: Record<string, unknown>) {
    vi.stubEnv('LIBTMUX_DOCS_BASE', '/en/')
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
    const url = `https://libtmux.org/en/${props.port}/latest/${props.pagePath}/`
    const html = await renderAstroTemplate(docs, {
      url, props: { version: 'latest', pagePorts: [], locale: 'en', pageSource: { repo: 'libtmux/docs', ref: 'main', path: 'site/src/pages/index.astro' }, ...props },
      slots: { default: '<p data-page-body>Page body</p>' },
    })
    return parse(withoutScope(html), url).document
  }

  /** The status the article used to open with: an admonition naming the concept scope or the development state. */
  const statusNotes = (document: Document) => [...document.querySelectorAll('main [role="note"]')]
    .filter((note) => /concept example|in development|working example of the core/i.test(note.textContent ?? ''))

  it.each([
    ['ocaml', 'workspace', 'workspace', 'workspace-concept'],
    ['java', 'mcp', 'mcp', 'mcp-concept'],
    ['ts', 'workspace', 'workspace/guides/installation', 'workspace-concept'],
    ['py', 'mcp', 'mcp/guides/clients', 'mcp-in-development'],
  ] as const)('opens the %s %s page %s with its bar under the release bar and an article free of status notes', async (port, product, pagePath, id) => {
    const document = await page({ title: DOC_PRODUCTS[product].label, port, product, pagePath })
    expect(statusNotes(document).map((note) => note.textContent?.trim().slice(0, 60)), 'the article opens with no status admonition').toEqual([])
    const release = document.querySelector('[data-prerelease-notice]')!
    const status = document.querySelector('[data-product-notice]')!
    expect(status, 'a bar carries the status').not.toBeNull()
    expect(status.getAttribute('data-product-notice')).toBe(id)
    expect(release.compareDocumentPosition(status) & 4, 'the product bar follows the release bar').toBeTruthy()
    expect(status.compareDocumentPosition(document.querySelector('article')!) & 4, 'and precedes the article').toBeTruthy()
    expect(status.closest('article, main, [data-pagefind-body]'), 'outside the article and the search index').toBeNull()
    expect(document.querySelectorAll('[data-product-notice]')).toHaveLength(1)
    expect(document.querySelector('article [data-page-body]')).not.toBeNull()
  })

  it.each(['lua', 'haskell'])('leaves the %s core page to the release bar: no product bar and no status note', async (port) => {
    const document = await page({ title: `tmux client library for ${PORT_BY_SLUG[port]!.name}`, port, pagePath: 'core' })
    expect(statusNotes(document)).toHaveLength(0)
    expect(document.querySelector('[data-product-notice]')).toBeNull()
    const unreleased = releaseMaturity(registryFor(PORT_BY_SLUG[port]!), PORT_BY_SLUG[port]!.tagGrammar) === 'unreleased'
    expect(document.querySelector('[data-prerelease-notice] .prerelease-notice__badge')?.textContent?.trim()).toBe(unreleased ? 'Unreleased' : 'Early release')
  })

  it('shows a protocol reference page, which keeps the core navigation, the MCP bar', async () => {
    const protocol = await loadAstroTemplate('components/mcp/ProtocolReference.astro', {
      real: [...layouts.real, 'components/docs/Sidebar.astro', 'components/docs/SidebarSection.astro', 'components/docs/SidebarLink.astro',
        'components/PageToolbar.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro'],
      stubs: layouts.stubs,
      modules: { 'astro-expressive-code/components': { Code: createComponent(() => render`<pre></pre>`) } },
    })
    vi.stubEnv('LIBTMUX_DOCS_BASE', '/en/')
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
    const html = await renderAstroTemplate(protocol, { url: 'https://libtmux.org/en/rs/latest/mcp/tools/', props: { port: 'rs', version: 'latest', section: 'tools' } })
    const document = parse(withoutScope(html), 'https://libtmux.org/en/rs/latest/mcp/tools/').document
    expect(statusNotes(document).map((note) => note.textContent?.trim().slice(0, 60))).toEqual([])
    expect(document.querySelector('[data-product-notice]')?.getAttribute('data-product-notice')).toBe('mcp-concept')
    expect(document.querySelector('[data-product-notice]')?.closest('main, [data-pagefind-body]')).toBeNull()
  })

  it('draws no bar on a page without the site header, such as an embedded preview', async () => {
    const base = await loadAstroTemplate('layouts/BaseLayout.astro', { real: ['components/PrereleaseNotice.astro'] })
    vi.stubEnv('LIBTMUX_DOCS_BASE', '/en/')
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
    const probe = (bare: boolean) => renderAstroTemplate(base, {
      url: 'https://libtmux.org/en/ocaml/latest/workspace/',
      props: { title: 'Workspace', pagePath: 'workspace', portSlug: 'ocaml', bare, pageSource: { repo: 'libtmux/docs', ref: 'main', path: 'x.astro' } },
      slots: { status: '<div data-status-slot></div>', default: '<main></main>' },
    })
    expect(await probe(false)).toContain('data-status-slot')
    expect(await probe(true)).not.toContain('data-status-slot')
  })

  it('has no admonition in a page template that reports status', () => {
    expect(source('components/ProductNotice.astro')).not.toMatch(/Aside|role="note"/)
    expect(source('layouts/DocsLayout.astro')).not.toContain('<ProductNotice port={port} product={product} overview')
    expect(source('components/mcp/ProtocolReference.astro')).not.toMatch(/<ProductNotice/)
  })
})

describe('remembering a dismissal', () => {
  const head = /<script is:inline>([\s\S]*?)<\/script>/.exec(source('components/ThemeScript.astro'))![1]!
  const rules = [...readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
    .matchAll(/^(html\[data-(?:prerelease|product-notice-dismissed)[^{]+)\{[^}]*\}/gm)].map((match) => match[0])
  const client = () => ts.transpileModule(script(source('components/ProductNotice.astro'), 'ProductNotice.astro'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let notice: Awaited<ReturnType<typeof loadAstroTemplate>>
  beforeAll(async () => { notice = await loadAstroTemplate('components/ProductNotice.astro') })

  async function reader(saved: Record<string, string> = {}, bars: readonly (readonly [string, DocProduct])[] = [['ocaml', 'workspace']]) {
    const win = new Window({ url: 'https://libtmux.org/en/ocaml/latest/workspace/' })
    windows.push(win)
    for (const [key, value] of Object.entries(saved)) win.localStorage.setItem(key, value)
    // The head script runs before any body markup is parsed, so the root has its attributes first.
    win.eval(head)
    const markup = await Promise.all(bars.map(async ([port, product]) => withoutScope(await renderAstroTemplate(notice, { props: { port, product } }))))
    win.document.body.innerHTML = `<div class="prerelease-notice" data-prerelease-notice><button data-prerelease-dismiss></button></div>${markup.join('')}`
    win.document.head.innerHTML = `<style>${rules.join('\n')}</style>`
    return win
  }
  const shown = (win: Window, selector: string) => win.getComputedStyle(win.document.querySelector(selector)!).display !== 'none'

  it('has a rule that hides each bar the site can draw, keyed on the root attribute and nothing else', () => {
    const hide = rules.filter((rule) => rule.includes('data-product-notice-dismissed')).join('\n')
    for (const port of PRIMARY) for (const product of PRODUCTS) {
      const id = expectedStatus(port.slug, product)?.id
      if (id) expect(hide, `${id} has a hide rule`).toContain(`html[data-product-notice-dismissed~='${id}'] [data-product-notice='${id}']`)
    }
    expect(hide).toMatch(/display:\s*none/)
    expect(hide).not.toMatch(/:not\(|\[data-js|\.no-js/)
  })

  it('sets the dismissed bars on the root in <head>, so a dismissed bar is never painted', async () => {
    const win = await reader({ [`${KEY}workspace-concept`]: 'dismissed', [`${KEY}mcp-in-development`]: 'dismissed', [`${KEY}mcp-concept`]: 'later' })
    expect(win.document.documentElement.getAttribute('data-product-notice-dismissed')?.split(' ').sort()).toEqual(['mcp-in-development', 'workspace-concept'])
    expect(win.document.documentElement.hasAttribute('data-prerelease')).toBe(false)
    expect(shown(win, '[data-product-notice]')).toBe(false)
  })

  it('ignores a stored key that names no status', async () => {
    const win = await reader({ [`${KEY}x" onload="y`]: 'dismissed', [`${KEY}Workspace_Concept`]: 'dismissed' })
    expect(win.document.documentElement.hasAttribute('data-product-notice-dismissed')).toBe(false)
    expect(shown(win, '[data-product-notice]')).toBe(true)
  })

  it('shows a bar nobody dismissed, and keeps it when only the release bar was dismissed', async () => {
    const win = await reader({ 'libtmux-docs.release-notice-0.1': 'dismissed' })
    expect(win.document.documentElement.getAttribute('data-prerelease')).toBe('dismissed')
    expect(win.document.documentElement.hasAttribute('data-product-notice-dismissed')).toBe(false)
    expect(shown(win, '[data-prerelease-notice]')).toBe(false)
    expect(shown(win, '[data-product-notice]')).toBe(true)
  })

  it('hides one status of one product and leaves the others', async () => {
    const win = await reader({ [`${KEY}mcp-concept`]: 'dismissed' }, [['rs', 'mcp'], ['rs', 'workspace']])
    expect(shown(win, '[data-product-notice="mcp-concept"]')).toBe(false)
    expect(shown(win, '[data-product-notice="workspace-concept"]')).toBe(true)
  })

  it('dismisses on click: stores the status, hides that bar at once and binds again after a swap', async () => {
    const win = await reader({}, [['rs', 'mcp'], ['rs', 'workspace']])
    win.eval(client())
    const button = (id: string) => win.document.querySelector<HTMLButtonElement>(`[data-product-notice-dismiss="${id}"]`)!
    expect(button('mcp-concept').dataset.bound).toBe('yes')
    button('mcp-concept').click()
    expect(win.localStorage.getItem(`${KEY}mcp-concept`)).toBe('dismissed')
    expect(win.localStorage.getItem(`${KEY}workspace-concept`)).toBeNull()
    expect(win.document.documentElement.getAttribute('data-product-notice-dismissed')).toBe('mcp-concept')
    expect(shown(win, '[data-product-notice="mcp-concept"]')).toBe(false)
    expect(shown(win, '[data-product-notice="workspace-concept"]')).toBe(true)
    expect(win.localStorage.getItem('libtmux-docs.release-notice-0.1')).toBeNull()
    button('workspace-concept').click()
    expect(win.document.documentElement.getAttribute('data-product-notice-dismissed')?.split(' ').sort()).toEqual(['mcp-concept', 'workspace-concept'])
    // A client-routed page brings a fresh bar, which needs its own listener.
    win.document.body.innerHTML = win.document.body.innerHTML.replaceAll(' data-bound="yes"', '')
    win.document.dispatchEvent(new win.Event('astro:after-swap'))
    expect(button('mcp-concept').dataset.bound).toBe('yes')
  })

  it('still hides the bar for this page when storage is blocked', async () => {
    const win = await reader({}, [['rs', 'mcp']])
    vi.spyOn(win.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    win.eval(client())
    win.document.querySelector<HTMLButtonElement>('[data-product-notice-dismiss]')!.click()
    expect(win.document.documentElement.getAttribute('data-product-notice-dismissed')).toBe('mcp-concept')
  })

  it('re-reads storage after a client-routed swap through the same head function', () => {
    expect(source('components/ThemeScript.astro')).toContain('window.__applyProductNotices = applyProductNotices')
    expect(source('components/ThemeScript.astro')).toContain('window.__applyProductNotices?.()')
  })
})
