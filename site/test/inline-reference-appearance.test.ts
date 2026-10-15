import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { productApiIndex } from '../src/lib/product-api'
import { linkTmuxDoc } from '../src/lib/tmux-links'
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
  for (const link of win.document.querySelectorAll('a')) if (policy.candidate(link, win.location.href)) policy.mark(link)
}

it('assigns one dotted decoration to each real preview link, including nested and mixed labels', () => {
  win.document.body.innerHTML = `<p>
    <a id="nested" class="api-xref" href="../observation-close/"><code class="api-literal api-literal--link">close()</code></a>
    <code class="api-literal">Observation#<a id="bare" class="api-literal--link" href="../observation-close/">close</a></code>
    <a id="plain" href="../server/">Server</a>
    <a id="mixed" href="../server/">See <code class="api-literal api-literal--link">Server</code> now</a>
    <a id="go" class="api-xref" href="/en/go/latest/reference/tmux-pane/"><code class="api-literal api-literal--link">Pane</code></a>
    <a id="badge" class="api-badge api-badge--kind-class" href="../glossary/#class"><span class="api-badge__label">class</span></a>
    </p><nav><a id="nav" href="../server/">Server</a></nav>
    <div class="api-index-card"><a id="card" href="../server/"><code>Server</code></a></div>`
  const original = win.document.body.textContent
  markPreviews()
  for (const id of ['nested', 'bare', 'plain', 'mixed', 'go', 'badge']) {
    const link = win.document.getElementById(id)!
    const owners = [link, ...link.querySelectorAll('*')].filter((node) => win.getComputedStyle(node).textDecorationLine.includes('underline'))
    expect(owners, id).toHaveLength(1)
    expect(win.getComputedStyle(owners[0]).textDecorationStyle).toBe('dotted')
  }
  for (const id of ['nested', 'mixed']) {
    const link = win.document.getElementById(id)!
    expect(win.getComputedStyle(link).color).toBe(win.getComputedStyle(link.querySelector('code')!).color)
    expect(win.getComputedStyle(link.querySelector('code')!).borderTopStyle).toBe('solid')
  }
  for (const id of ['nav', 'card']) {
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

it('leaves unrelated hashes, source comments and URL fragments unchanged', async () => {
  const model = API_MODELS.scala
  const index = productApiIndex(model, 'latest')
  const container = await experimental_AstroContainer.create()
  const text = '`C#` `F#` `# comment` `https://example.test/#fragment` `#{pane_id}`'
  win.document.body.innerHTML = await container.renderToString(await docComponent(), { props: { text, index } })
  expect(win.document.querySelectorAll('.api-reference-separator')).toHaveLength(0)
  expect(win.document.body.textContent).toBe('C# F# # comment https://example.test/#fragment #{pane_id}')
})
