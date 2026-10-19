import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { productApiIndex } from '../src/lib/product-api'
import { linkTmuxDoc } from '../src/lib/tmux-links'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { createLinkPreviewPolicy } from '../src/lib/link-preview-paint'

const preview = readFileSync(new URL('../src/components/LinkPreview.astro', import.meta.url), 'utf8')
const previewCss = preview.match(/<style is:global>([\s\S]*?)<\/style>/)![1]
const apiCss = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
const badgeCss = readFileSync(new URL('../src/styles/api-kinds.css', import.meta.url), 'utf8')
const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
let win: Window
beforeEach(() => {
  win = new Window({ url: 'https://libtmux.org/en/scala/latest/reference/io-github-libtmux-scaladsl-server/' })
  vi.stubGlobal('Element', win.Element)
  vi.stubGlobal('__apiDocSourceLinker', linkTmuxDoc)
  win.document.head.innerHTML = `<style>:root { --color-link: #6f1a24; --color-foreground-primary: #202830; --color-background-border: #d6dce3; --color-inline-code-background: #f3f5f7; }
    body { color: #202830; }${apiCss}${badgeCss}${previewCss}</style>`
})
afterEach(async () => { await win.happyDOM.abort(); vi.unstubAllGlobals() })

function markPreviews() {
  const policy = createLinkPreviewPolicy()
  for (const fixtureLink of win.document.querySelectorAll('a')) {
    // Adapt happy-dom's separate DOM declarations at the browser-policy boundary.
    const link = fixtureLink as unknown as HTMLAnchorElement
    if (policy.candidate(link, win.location.href)) policy.mark(link)
  }
}

const kindMark = (label: string) => `<span class="api-link-kind api-nav__kind api-badge--kind-class" aria-hidden="true"><span class="api-badge__label">${label}</span></span>`

it('assigns one dotted decoration to each real preview link, including nested and mixed labels', () => {
  win.document.body.innerHTML = `<p>
    <a id="nested" class="api-xref" href="../observation-close/"><code class="api-literal api-literal--link">close()</code></a>
    <code class="api-literal">Observation#<a id="bare" class="api-literal--link" href="../observation-close/">close</a></code>
    <a id="plain" href="../server/">Server</a>
    <a id="mixed" href="../server/">See <code class="api-literal api-literal--link">Server</code> now</a>
    <a id="go" class="api-xref" href="/en/go/latest/reference/tmux-pane/"><code class="api-literal api-literal--link">Pane</code></a>
    <a id="badge" class="api-badge api-badge--kind-class" href="../glossary/#class"><span class="api-badge__label">class</span></a>
    <a id="kind-chip" class="api-mention" href="../server/">${kindMark('C')}<span class="api-symbol-link__name"><code>Server</code></span></a>
    <a id="kind-name" href="../server/">${kindMark('S')}<span class="api-symbol-link__name">Server</span></a>
    <a id="kind-code" href="../server/">${kindMark('M')}<code>Server</code></a>
    </p><nav><a id="nav" href="../server/">Server</a></nav>
    <div class="api-index-card"><a id="card" href="../server/"><code>Server</code></a></div>
    <a id="doc-card" class="doc-card" href="../server/"><h3>Server</h3><p>Runtime requirements.</p></a>`
  const original = win.document.body.textContent
  markPreviews()
  for (const id of ['nested', 'bare', 'plain', 'mixed', 'go', 'badge', 'kind-chip', 'kind-name', 'kind-code']) {
    const link = win.document.getElementById(id)!
    const owners = [link, ...link.querySelectorAll('*')].filter((node) => win.getComputedStyle(node).textDecorationLine.includes('underline'))
    expect(owners, id).toHaveLength(1)
    expect(win.getComputedStyle(owners[0]).textDecorationStyle).toBe('dotted')
  }
  // A decoration on the link would also run under the kind badge, so the name carries it.
  for (const id of ['kind-chip', 'kind-name', 'kind-code']) {
    const link = win.document.getElementById(id)!
    const [owner] = [link, ...link.querySelectorAll('*')].filter((node) => win.getComputedStyle(node).textDecorationLine.includes('underline'))
    expect(owner.matches('.api-symbol-link__name, code'), id).toBe(true)
    expect(link.querySelector('.api-nav__kind')!.contains(owner), id).toBe(false)
  }
  for (const id of ['nested', 'mixed']) {
    const link = win.document.getElementById(id)!
    expect(win.getComputedStyle(link).color).toBe(win.getComputedStyle(link.querySelector('code')!).color)
    expect(win.getComputedStyle(link.querySelector('code')!).borderTopStyle).toBe('solid')
  }
  for (const id of ['nav', 'card', 'doc-card']) {
    const link = win.document.getElementById(id)!
    expect(link.hasAttribute('data-link-preview')).toBe(false)
    expect(win.getComputedStyle(link).textDecorationStyle).not.toBe('dotted')
  }
  expect(win.document.body.textContent).toBe(original)
})

async function docComponent() {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  const file = new URL('../src/components/api/ApiDoc.astro', import.meta.url)
  const result = await transform(readFileSync(file, 'utf8'), { filename: file.pathname, internalURL: 'astro/compiler-runtime', resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
  expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
  // Reuse the real Vite-loaded linker when importing the small compiled Astro component.
  const linker = `data:text/javascript,export const linkTmuxDoc = globalThis.__apiDocSourceLinker`
  const code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
    .replaceAll('"../../lib/tmux-links"', JSON.stringify(linker))
  return (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
}

it.each(['java.lang.AutoCloseable#close', 'java.lang.AutoCloseable#notAnActualMember'])('marks only the qualified member separator while preserving %s', async (label) => {
  const model = API_MODELS.scala
  const index = productApiIndex(model, 'latest')
  const context = model.symbols.find((symbol) => symbol.id === 'io.github.libtmux.scaladsl.Server')!
  const text = `{@link ${label}}`
  const before = index.linkText(text, context)
  const container = await experimental_AstroContainer.create()
  win.document.body.innerHTML = await container.renderToString(await docComponent(), { props: { text, index, context } })
  const code = win.document.querySelector('code.api-literal')!
  expect(code.textContent).toBe(label)
  expect(code.querySelectorAll('.api-reference-separator')).toHaveLength(1)
  const separator = code.querySelector('.api-reference-separator')!
  expect(separator.textContent).toBe('#')
  expect(separator.hasAttribute('aria-hidden')).toBe(false)
  expect(separator.hasAttribute('role')).toBe(false)
  expect(win.document.querySelector('button')).toBeNull()
  const expected = before.flatMap((span) => span.kind === 'ref' ? span.link ? [span.link.href] : index.linkType(span.label, context).flatMap((part) => part.link ? [part.link.href] : []) : [])
  const links = code.closest('a') ? [code.closest('a')!] : [...code.querySelectorAll('a')]
  expect(links.map((link) => link.getAttribute('href'))).toEqual(expected)
})

it('colors only marked reference separators from the active port palette', () => {
  const rule = apiCss.match(/\.api-literal \.api-reference-separator\s*\{([^}]+)\}/)?.[1]
  expect(rule).toContain('var(--color-link)')
  expect(rule).toContain('color-mix(')
  expect(rule).not.toMatch(/#[\da-f]{3,8}\b/i)
})

it('renders the WhereOf generic as one code expression with independent native links', async () => {
  const model = API_MODELS.ts
  const context = model.symbols.find((symbol) => symbol.id === 'selection.WhereOf')!
  const index = productApiIndex(model, 'next')
  const text = context.doc!.body!
  const container = await experimental_AstroContainer.create()
  win.document.body.innerHTML = await container.renderToString(await docComponent(), { props: { text, index, context } })
  const code = win.document.querySelector('code.api-literal')!
  expect(code.textContent).toBe('Selection<Pane>')
  expect(win.document.body.textContent).toBe(text.replaceAll('`', ''))
  expect([...code.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
    ['Selection', '/ts/next/reference/selection-selection/'],
    ['Pane', '/ts/next/reference/pane-pane/'],
  ])
  for (const link of code.querySelectorAll('a')) {
    expect(link.hasAttribute('tabindex')).toBe(false)
    expect(link.hasAttribute('onclick')).toBe(false)
    expect(link.hasAttribute('aria-hidden')).toBe(false)
  }
  markPreviews()
  for (const link of code.querySelectorAll('a')) {
    const owners = [link, ...link.querySelectorAll('*')].filter((node) => win.getComputedStyle(node).textDecorationLine.includes('underline'))
    expect(owners).toHaveLength(1)
    expect(win.getComputedStyle(owners[0]).textDecorationStyle).toBe('dotted')
  }
})

it('keeps a keyword argument plain while its bare name still links', async () => {
  const model = API_MODELS.ruby
  const index = productApiIndex(model, 'latest')
  const container = await experimental_AstroContainer.create()
  const text = '`cancel:` `clients: true` `where:` `cancel`'
  win.document.body.innerHTML = await container.renderToString(await docComponent(), { props: { text, index } })
  const codes = [...win.document.querySelectorAll('code.api-literal')]
  expect(codes.map((code) => code.textContent)).toEqual(['cancel:', 'clients: true', 'where:', 'cancel'])
  expect(codes.slice(0, 3).map((code) => code.querySelectorAll('a').length)).toEqual([0, 0, 0])
  expect(win.document.querySelectorAll('a[href*="cancellation-cancel"]')).toHaveLength(1)
  // Markdown links code literals for TypeScript; the same rule keeps an option key plain there.
  const ts = API_MODELS.ts
  const summary = '`socketPath:` `socketPath`'
  const server = { ...ts.symbols.find((entry) => entry.id === 'server.Server')!, doc: { summary } }
  const markdown = symbolMarkdown({ model: ts, symbol: server, index: productApiIndex(ts, 'latest') })
  expect(markdown).toContain('`socketPath:` [`socketPath`](')
})

it('leaves unrelated hashes, source comments and URL fragments unchanged', async () => {
  const model = API_MODELS.scala
  const index = productApiIndex(model, 'latest')
  const container = await experimental_AstroContainer.create()
  const text = '`C#` `F#` `# comment` `https://example.test/#fragment` `#{pane_id}`'
  win.document.body.innerHTML = await container.renderToString(await docComponent(), { props: { text, index } })
  expect(win.document.querySelectorAll('.api-reference-separator')).toHaveLength(0)
  expect(win.document.body.textContent).toBe('C# F# # comment https://example.test/#fragment #{pane_id}')
})
