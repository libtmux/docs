import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pageHeads } from '../src/integrations/sitemap-heads'
import { headVerdict } from '../src/lib/sitemap-heads'
import { treePages, writePortSitemap } from '../../scripts/gen-port-sitemap.mjs'

const URL_OF = 'https://libtmux.org/en/ts/latest/guides/panes/'
const page = (head: string) => `<!doctype html><html><head>${head}</head><body><svg><title>inline</title></svg></body></html>`

describe('what a page head says about its sitemap entry', () => {
  it('lists a page with an index robots tag and a self canonical', () => {
    expect(headVerdict(page(`<meta name="robots" content="index, follow"><link rel="canonical" href="${URL_OF}">`), URL_OF)).toEqual({ listed: true })
  })

  it('lists a native page that states neither robots nor canonical', () => {
    expect(headVerdict(page('<title>Server</title>'), URL_OF).listed).toBe(true)
  })

  it.each([
    ['noindex', '<meta name="robots" content="noindex, nofollow">', 'noindex'],
    ['a noindex written with single quotes', "<meta name='robots' content='noindex'>", 'noindex'],
    ['a meta refresh', '<noscript><meta http-equiv="refresh" content="0;url=/en/"></noscript>', 'redirect'],
    ['a canonical elsewhere', '<link rel="canonical" href="https://libtmux.org/en/ts/v0.1.0/guides/panes/">', 'canonical'],
  ])('keeps out a page with %s', (_name, head, reason) => {
    expect(headVerdict(page(head), URL_OF)).toEqual({ listed: false, reason })
  })

  it('reads the head only, not a noindex quoted in the body', () => {
    const html = `<html><head><link rel="canonical" href="${URL_OF}"></head><body><meta name="robots" content="noindex"></body></html>`
    expect(headVerdict(html, URL_OF).listed).toBe(true)
  })

  it('compares canonicals without a trailing slash or a query', () => {
    expect(headVerdict(page(`<link rel="canonical" href="${URL_OF.slice(0, -1)}?x=1">`), URL_OF).listed).toBe(true)
  })
})

describe('a port tree sitemap', () => {
  const dirs: string[] = []
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  function tree(pages: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'port-sitemap-'))
    dirs.push(dir)
    for (const [path, html] of Object.entries(pages)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), html)
    }
    return dir
  }
  const PUBLIC = 'https://libtmux.org/en/ts/latest/'
  const files = {
    'index.html': page(`<meta name="robots" content="index, follow"><link rel="canonical" href="${PUBLIC}">`),
    'guides/panes/index.html': page(`<link rel="canonical" href="${PUBLIC}guides/panes/">`),
    'api/topics/pane/index.html': page('<title>Native</title>'),
    'reference/index.html': page('<meta name="robots" content="noindex, nofollow">'),
    'old/index.html': page('<noscript><meta http-equiv="refresh" content="0;url=/en/ts/latest/"></noscript>'),
    'api/_static/page/index.html': page('<title>not a page</title>'),
    'pagefind/index.html': page('<title>not a page</title>'),
  }

  it('lists the home, a prose page and a native page, and keeps out the rest', () => {
    const { urls, skipped } = treePages(tree(files), PUBLIC)
    expect(urls).toEqual([PUBLIC, `${PUBLIC}api/topics/pane/`, `${PUBLIC}guides/panes/`])
    expect(skipped).toEqual({ noindex: 1, redirect: 1, canonical: 0 })
  })

  it('writes one sitemap and an index that names it', () => {
    const dir = tree(files)
    expect(writePortSitemap(dir, PUBLIC).urls).toBe(3)
    const xml = readFileSync(join(dir, 'sitemap-0.xml'), 'utf8')
    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])).toEqual([PUBLIC, `${PUBLIC}api/topics/pane/`, `${PUBLIC}guides/panes/`])
    expect(readFileSync(join(dir, 'sitemap-index.xml'), 'utf8')).toContain(`<loc>${PUBLIC}sitemap-0.xml</loc>`)
  })

  it('escapes characters XML reserves in a URL', () => {
    const dir = tree({ 'a&b/index.html': page('<title>x</title>') })
    writePortSitemap(dir, PUBLIC)
    expect(readFileSync(join(dir, 'sitemap-0.xml'), 'utf8')).toContain(`<loc>${PUBLIC}a&amp;b/</loc>`)
  })

  it('fails instead of dropping pages when a tree outgrows the file', () => {
    expect(() => writePortSitemap(tree(files), PUBLIC, 2)).toThrow(/exceed/)
  })
})

describe('the build hook that records pages their own head excludes', () => {
  const dirs: string[] = []
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

  it('lets the sitemap filter ask which URLs stay out', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sitemap-heads-'))
    dirs.push(dir)
    const write = (path: string, html: string) => {
      mkdirSync(join(dir, path), { recursive: true })
      writeFileSync(join(dir, path, 'index.html'), html)
    }
    write('guides/panes', page('<link rel="canonical" href="https://libtmux.org/en/guides/panes/">'))
    write('search', page('<meta name="robots" content="noindex">'))
    const heads = pageHeads('https://libtmux.org', '/en/')
    const info = vi.fn()
    ;(heads.integration.hooks['astro:build:done'] as (input: unknown) => void)({
      dir: pathToFileURL(`${dir}/`), pages: [{ pathname: 'guides/panes/' }, { pathname: '/search/' }, { pathname: 'missing/' }], logger: { info },
    })
    expect(heads.listed('https://libtmux.org/en/guides/panes/')).toBe(true)
    expect(heads.listed('https://libtmux.org/en/search/')).toBe(false)
    expect(heads.listed('https://libtmux.org/en/missing/')).toBe(true)
  })
})
