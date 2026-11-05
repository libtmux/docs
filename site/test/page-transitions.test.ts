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

  it('hide only the API tree while the gate runs', () => {
    const body = pages.filter(({ head }) => /html\.fonts-pending body|html\.link-hints-pending body/.test(head))
    expect(body.map(({ path }) => path).slice(0, 5)).toEqual([])
    const tree = pages.filter(({ head }) => head.includes('html.fonts-pending .api-nav [role="tree"]'))
    expect(tree.length).toBe(pages.length)
  })
})
