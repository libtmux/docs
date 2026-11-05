import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadHeaderTemplates, renderPage } from './header-page'
import { SITE_BUILT, SITE_ROOT } from './site-root'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('shell sources', () => {
  it('hides only the API tree while the readiness gate runs', () => {
    const style = /<style is:inline>([\s\S]*?)<\/style>/.exec(read('../src/components/ShellHead.astro'))![1]!
    const hiding = [...style.matchAll(/([^{}]+)\{[^{}]*visibility:\s*hidden[^{}]*\}/g)]
      .flatMap(([, selectors]) => selectors!.split(',').map((selector) => selector.trim()))
    expect(hiding.length).toBeGreaterThan(0)
    for (const selector of hiding) expect(selector).toMatch(/^html\.(?:fonts|link-hints)-pending \.api-nav \[role="tree"\]$/)
  })

  it('enables the client router in the head of every shell page', () => {
    const layout = read('../src/layouts/BaseLayout.astro')
    expect(layout).toMatch(/import \{ ClientRouter \} from 'astro:transitions'/)
    expect(/<head>([\s\S]*?)<\/head>/.exec(layout)![1]).toContain('<ClientRouter fallback="swap" />')
  })

  it('renders the router meta tags in the head of the base layout', async () => {
    const { baseLayout } = await loadHeaderTemplates()
    const html = await renderPage(baseLayout, 'https://libtmux.org/en/ts/latest/guides/panes/', { pagePath: 'guides/panes', portSlug: 'ts' })
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)![1]!
    expect(head).toContain('<meta name="astro-view-transitions-enabled" content="true"')
    expect(head).toContain('<meta name="astro-view-transitions-fallback" content="swap"')
    vi.unstubAllEnvs()
  })

  it('guards navigation between independently built trees', () => {
    expect(read('../src/components/docs/DocumentationScript.astro')).toMatch(/guardTreeNavigation\(\)/)
  })

  it('holds the first frame until the header bar is parsed', async () => {
    const header = read('../src/components/SiteHeader.astro')
    const panel = header.indexOf('id="site-header-panel"')
    expect(panel).toBeGreaterThan(header.indexOf('site-header__menu-button'))
    expect(panel).toBeGreaterThan(header.indexOf('site-header__always'))
    const { baseLayout } = await loadHeaderTemplates()
    const html = await renderPage(baseLayout, 'https://libtmux.org/en/ts/latest/guides/panes/', { pagePath: 'guides/panes', portSlug: 'ts' })
    expect(/<head>([\s\S]*?)<\/head>/.exec(html)![1]).toContain('<link rel="expect" href="#site-header-panel" blocking="render">')
    expect(html).toContain('id="site-header-panel"')
    vi.unstubAllEnvs()
  })

  it('guards navigation within a page before the router listens for history', () => {
    const head = /<head>([\s\S]*?)<\/head>/.exec(read('../src/layouts/BaseLayout.astro'))![1]!
    const guard = head.indexOf('guardPageNavigation()')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(head.indexOf('<ClientRouter'))
  })
})

/** The first and last bytes of a file; the head and the end of a page are all these checks read. */
function ends(path: string, size = 16_384) {
  const fd = openSync(path, 'r')
  try {
    const length = statSync(path).size
    const head = Buffer.alloc(Math.min(size, length))
    readSync(fd, head, 0, head.length, 0)
    const tail = Buffer.alloc(Math.min(size, length))
    readSync(fd, tail, 0, tail.length, length - tail.length)
    return { head: head.toString('utf8'), tail: tail.toString('utf8') }
  } finally { closeSync(fd) }
}

/** Every page the Astro shell built, native Sphinx and generated pages excluded. */
function shellPages() {
  const pages: { path: string; head: string; tail: string }[] = []
  for (const file of readdirSync(SITE_ROOT, { recursive: true }) as string[]) {
    if (!file.endsWith('.html')) continue
    const path = join(SITE_ROOT, file)
    const { head, tail } = ends(path)
    if (/<html\b[^>]*\bdata-shell-base=/.test(head) && !/<html\b[^>]*\bdata-native-shell-export/.test(head)) pages.push({ path, head, tail })
  }
  return pages
}

describe.skipIf(!SITE_BUILT)('built shell pages', () => {
  const pages = SITE_BUILT ? shellPages() : []

  it('are found', () => { expect(pages.length).toBeGreaterThan(0) })

  it('enable the client router so a link swaps the page in place', () => {
    const without = pages.filter(({ head }) => !head.includes('<meta name="astro-view-transitions-enabled" content="true"')
      || !/<meta name="astro-view-transitions-fallback" content="swap"/.test(head))
    expect(without.map(({ path }) => path).slice(0, 5)).toEqual([])
  })

  it('end at </body> and </html>, so the zone-injected beacon follows every required module', () => {
    const late = pages.filter(({ tail }) => !/<\/body>\s*<\/html>\s*$/.test(tail))
    expect(late.map(({ path }) => path).slice(0, 5)).toEqual([])
  })

  it('hide only the API tree while the gate runs', () => {
    const body = pages.filter(({ head }) => /html\.fonts-pending body|html\.link-hints-pending body/.test(head))
    expect(body.map(({ path }) => path).slice(0, 5)).toEqual([])
    const tree = pages.filter(({ head }) => head.includes('html.fonts-pending .api-nav [role="tree"]'))
    expect(tree.length).toBe(pages.length)
  })
})

describe.skipIf(!SITE_BUILT)('built pages with code frames', () => {
  // Reading every page body is slow on a full assembly, so an evenly spaced sample stands for them.
  const framed = (SITE_BUILT ? shellPages() : []).filter((_, index) => index % 40 === 0)
    .map(({ path }) => ({ path, html: readFileSync(path, 'utf8') }))
    .filter(({ html }) => html.includes('class="expressive-code"'))
  const stylesheet = /<link rel="stylesheet" href="[^"]*\/ec\.[A-Za-z0-9_-]+\.css"\s*\/?>/g

  it('are sampled', () => { expect(framed.length).toBeGreaterThan(0) })

  it('load the code stylesheet from the head, where the router preloads it before a swap', () => {
    for (const { path, html } of framed) {
      const body = html.indexOf('<body')
      expect(html.slice(0, body).match(stylesheet) ?? [], `${path}: one link in the head`).toHaveLength(1)
      expect(html.slice(body).match(/<link\b[^>]*rel="stylesheet"/g) ?? [], `${path}: no stylesheet link in the body`).toEqual([])
    }
  })
})

