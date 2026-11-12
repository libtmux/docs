import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installExternalLinks } from '../public/_shell/external-links.js'
import { externalLinks, markExternalLinks, markExternalLinksIn } from '../src/integrations/external-links'

/**
 * The glyph rule matches `a[data-external-link]`. A script used to set that attribute after the page parsed,
 * so a link painted without its glyph and grew one a moment later. The built HTML now carries it.
 */
const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`
const dom = (html: string, url = 'https://libtmux.org/en/ts/latest/mcp/') => {
  const win = new Window({ url })
  win.document.write(html)
  return win
}
const marks = (html: string) => {
  const { document } = dom(html)
  return [...document.querySelectorAll('a[href]')].map((link) => [link.getAttribute('href'),
    link.getAttribute('data-external-link'), link.hasAttribute('data-external-link-icon')] as const)
}

const disposals: (() => void)[] = []
afterEach(() => disposals.splice(0).forEach((dispose) => dispose()))

describe('external links in the built HTML', () => {
  it('writes the marker into a prose link before any script runs', () => {
    const html = markExternalLinks(page('<main><p>Installs from <a href="https://cooldowns.dev/">cooldowns.dev</a>.</p></main>'))
    const link = dom(html).document.querySelector('main a')!
    expect(link.getAttribute('data-external-link')).toBe('cooldowns.dev')
    expect(link.hasAttribute('data-external-link-icon')).toBe(false)
  })

  it('marks only destinations outside the site, with the same hostname the runtime reads', () => {
    const html = markExternalLinks(page(`
      <a href="https://docs.python.org/3/">a</a><a href="//learn.microsoft.com/dotnet">b</a>
      <a href="http://example.com:8080/x">c</a><a href='https://Example.ORG/Path'>d</a>
      <a href="/en/py/latest/">e</a><a href="../up/">f</a><a href="#top">g</a><a href="?q=1">h</a>
      <a href="mailto:a@example.com">i</a><a href="javascript:void(0)">j</a><a>k</a><a href="">l</a>`))
    expect(marks(html).filter(([, host]) => host)).toEqual([
      ['https://docs.python.org/3/', 'docs.python.org', false],
      ['//learn.microsoft.com/dotnet', 'learn.microsoft.com', false],
      ['http://example.com:8080/x', 'example.com', false],
      ['https://Example.ORG/Path', 'example.org', false],
    ])
  })

  it('treats libtmux.org as internal in every build, including a preview under a path prefix', () => {
    const body = `<a href="https://libtmux.org/en/py/latest/">production</a><a href="https://libtmux.org/pr-7/en/">preview</a>
      <a href="https://preview.example.test/pr-7/en/">own</a><a href="https://github.com/libtmux/docs">github</a>`
    const internal = (site: string) => marks(markExternalLinks(page(body), site)).filter(([, host]) => !host).map(([href]) => href)
    expect(internal('https://libtmux.org')).toEqual(['https://libtmux.org/en/py/latest/', 'https://libtmux.org/pr-7/en/'])
    expect(internal('https://preview.example.test')).toEqual([
      'https://libtmux.org/en/py/latest/', 'https://libtmux.org/pr-7/en/', 'https://preview.example.test/pr-7/en/'])
    expect(markExternalLinks(page('<a href="/pr-7/en/">own</a>'), 'https://preview.example.test')).toBe(page('<a href="/pr-7/en/">own</a>'))
  })

  it('applies the runtime icon-only rule', () => {
    const html = markExternalLinks(page(`
      <a id="svg" href="https://github.com/libtmux/docs" aria-label="GitHub"><svg><title>GitHub</title><path /></svg></a>
      <a id="img" href="https://example.com/"><img alt="Example" src="icon.svg"><span class="sr-only">Example</span></a>
      <a id="mixed" href="https://example.com/"><svg aria-hidden="true"><path /></svg><span>Documentation</span></a>
      <a id="labelled" href="https://example.com/" aria-label="Documentation">Documentation</a>
      <a id="hidden" href="https://example.com/"><picture><img alt="" src="a.png"></picture><span hidden>Hidden</span><b aria-hidden="true">x</b></a>
      <a id="code" href="https://example.com/"><code>Example</code></a>`))
    const { document } = dom(html)
    const icon = (id: string) => document.getElementById(id)!.hasAttribute('data-external-link-icon')
    expect(['svg', 'img', 'mixed', 'labelled', 'hidden', 'code'].map(icon)).toEqual([true, true, false, false, true, false])
  })

  it('agrees with the runtime on every link of a mixed page', () => {
    const body = `
      <a href="https://docs.python.org/3/"><code>os</code></a><a href="//learn.microsoft.com/x"><svg></svg></a>
      <a href="/en/"><svg></svg></a><a href="https://libtmux.org/en/">own</a>
      <a href="https://example.com/"><svg aria-hidden="true"></svg> <span class="visually-hidden">Docs</span></a>
      <a href="https://example.com/"><img alt="x" src="x.png">Text</a>`
    const runtime = dom(page(body)).document
    disposals.push(installExternalLinks(runtime.defaultView as unknown as typeof window))
    const built = dom(markExternalLinks(page(body))).document
    const read = (document: typeof runtime) => [...document.querySelectorAll('a')].map((link) =>
      [link.getAttribute('data-external-link'), link.hasAttribute('data-external-link-icon')])
    expect(read(built)).toEqual(read(runtime))
    expect(read(built).filter(([host]) => host)).toHaveLength(4)
  })

  it('inserts attributes only: other bytes, raw text and a marked page are unchanged', () => {
    const inert = `<script type="application/json">{"html":"<a href=\\"https://example.com/\\">x</a>"}</script>
      <pre><code>&lt;a href="https://example.com/"&gt;x&lt;/a&gt;</code></pre><!-- <a href="https://example.com/">x</a> -->
      <textarea><a href="https://example.com/">x</a></textarea><style>a[href="https://example.com/"] { color: red }</style>`
    expect(markExternalLinks(page(inert))).toBe(page(inert))
    const source = page(`<p class="a"  >Text <a  class="x"
      href=https://example.com/a>one</a> and <a href="https://example.com/b" target=_blank >two</a> <a href="https://example.com/c"/></p>`)
    const marked = markExternalLinks(source)
    expect(marked).not.toBe(source)
    expect(marked.replace(/ data-external-link="[^"]+"/g, '')).toBe(source)
    expect(markExternalLinks(marked)).toBe(marked)
    expect(marked.match(/data-external-link=/g)).toHaveLength(3)
  })

  it('keeps an existing marker and adds only what is missing', () => {
    const source = page('<a href="https://example.com/" data-external-link="example.com"><svg></svg></a>')
    const marked = markExternalLinks(source)
    expect(marked).toBe(page('<a href="https://example.com/" data-external-link="example.com" data-external-link-icon><svg></svg></a>'))
  })

  it('marks links inside a template, which a script clones into the page later', () => {
    const html = markExternalLinks(page('<template><a href="https://example.com/">x</a></template>'))
    expect(html).toContain('<a href="https://example.com/" data-external-link="example.com">')
  })

  it('does not parse a page that has no absolute link', () => {
    const html = page('<a href="/en/">home</a><p>https://example.com/</p>')
    expect(markExternalLinks(html)).toBe(html)
  })

  it('marks every built page in a directory once', () => {
    const out = mkdtempSync(join(tmpdir(), 'external-links-'))
    try {
      mkdirSync(join(out, 'en/a'), { recursive: true })
      writeFileSync(join(out, 'en/a/index.html'), page('<a href="https://example.com/">x</a>'))
      writeFileSync(join(out, 'en/index.html'), page('<a href="/en/a/">x</a>'))
      writeFileSync(join(out, 'en/a/index.md'), '[x](https://example.com/)')
      expect(markExternalLinksIn(out)).toBe(1)
      expect(readFileSync(join(out, 'en/a/index.html'), 'utf8')).toBe(page('<a href="https://example.com/" data-external-link="example.com">x</a>'))
      expect(readFileSync(join(out, 'en/a/index.md'), 'utf8')).toBe('[x](https://example.com/)')
      expect(markExternalLinksIn(out)).toBe(0)
    } finally { rmSync(out, { recursive: true, force: true }) }
  })
})

describe('the integration', () => {
  it("reads the build's origin from the Astro config and marks the output directory at build end", () => {
    const out = mkdtempSync(join(tmpdir(), 'external-links-'))
    try {
      writeFileSync(join(out, 'index.html'), page('<a href="https://preview.example.test/pr-7/en/">own</a><a href="https://github.com/libtmux/docs">github</a>'))
      const { hooks } = externalLinks()
      const info = vi.fn()
      const hook = <T,>(name: string) => hooks[name as keyof typeof hooks] as unknown as (options: T) => void
      hook<{ config: { site: string } }>('astro:config:done')({ config: { site: 'https://preview.example.test' } })
      hook<{ dir: URL; logger: { info: typeof info } }>('astro:build:done')({ dir: pathToFileURL(`${out}/`), logger: { info } })
      expect(readFileSync(join(out, 'index.html'), 'utf8')).toBe(page(
        '<a href="https://preview.example.test/pr-7/en/">own</a><a href="https://github.com/libtmux/docs" data-external-link="github.com">github</a>'))
      expect(info).toHaveBeenCalledOnce()
    } finally { rmSync(out, { recursive: true, force: true }) }
  })
})

describe('the runtime on a page that already carries the marker', () => {
  const source = page(`<a id="text" href="https://example.com/a">Docs</a><a id="icon" href="https://example.com/b"><svg></svg></a>
    <a id="own" href="/en/">Home</a>`)

  it('leaves the server attributes as they are and adds only the title and description', () => {
    const win = dom(markExternalLinks(source))
    const { document } = win
    const writes = vi.spyOn(win.Element.prototype, 'setAttribute')
    const toggles = vi.spyOn(win.Element.prototype, 'toggleAttribute')
    const before = [...document.querySelectorAll('a')].map((link) => link.outerHTML)
    disposals.push(installExternalLinks(win as unknown as typeof window))
    const names = writes.mock.calls.map(([name]) => name)
    expect(names).not.toContain('data-external-link')
    expect(names.sort()).toEqual(['aria-description', 'aria-description', 'title', 'title'])
    expect(toggles.mock.calls.every(([name]) => name === 'data-external-link-icon')).toBe(true)
    for (const [index, link] of [...document.querySelectorAll('a')].entries()) {
      expect(link.outerHTML.replace(/ (?:title|aria-description)="[^"]*"/g, '')).toBe(before[index])
    }
    expect(document.getElementById('text')!.getAttribute('title')).toBe('View on example.com')
    expect(document.getElementById('icon')!.hasAttribute('data-external-link-icon')).toBe(true)
  })

  it('gives the same result as decorating an unmarked page', () => {
    const marked = dom(markExternalLinks(source))
    const bare = dom(source)
    disposals.push(installExternalLinks(marked as unknown as typeof window), installExternalLinks(bare as unknown as typeof window))
    expect(marked.document.body.innerHTML).toBe(bare.document.body.innerHTML)
  })

  it('still removes the marker from a link whose destination becomes internal', async () => {
    const win = dom(markExternalLinks(source))
    disposals.push(installExternalLinks(win as unknown as typeof window), () => { void win.happyDOM.abort() })
    const link = win.document.getElementById('text')!
    link.setAttribute('href', '/en/py/')
    await win.happyDOM.waitUntilComplete()
    expect(link.hasAttribute('data-external-link')).toBe(false)
    expect(link.hasAttribute('title')).toBe(false)
  })
})
