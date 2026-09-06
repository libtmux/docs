import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PORTS } from '../src/lib/ports'
import { SITE_BUILT, BUCKET_ROOT } from './site-root'

/** Built switcher links must resolve within the assembled site. */
const SITE = BUCKET_ROOT

const describeIfAssembled = SITE_BUILT ? describe : describe.skip

/** Pages that exercise a different combination of the port, version and locale axes. */
function samplePages(): string[] {
  const prefix = existsSync(join(SITE, 'en/index.html')) ? 'en/' : ''
  const wanted = [
    'index.html', 'concepts/index.html', 'mcp/tools/index.html',
    'topics/architecture/index.html', 'py/index.html',
    'py/latest/topics/architecture/index.html', 'ts/latest/topics/architecture/index.html',
    'rs/index.html', 'reference/index.html', 'reference/ts/index.html',
    'reference/ts/session-session-panes/index.html', 'reference/ts/session-session-sessionbrand/index.html',
  ].map((page) => prefix + page)
  wanted.push('ja/index.html', 'ja/concepts/index.html')
  const present = wanted.filter((page) => existsSync(join(SITE, page)))

  return present
}

/** Resolve a site-absolute or absolute URL to a file in the built tree. */
function resolves(href: string): boolean {
  let path: string
  try {
    path = href.startsWith('http') ? new URL(href).pathname : href
  } catch {
    return false
  }
  if (path.startsWith('#') || path.startsWith('mailto:')) return true
  const clean = path.split('#')[0].split('?')[0].replace(/^\//, '')
  if (clean === '') return existsSync(join(SITE, 'index.html'))
  return existsSync(join(SITE, clean)) || existsSync(join(SITE, clean, 'index.html'))
}

const pages = samplePages()

describeIfAssembled('switcher targets', () => {
  it('has pages to check', () => {
    expect(pages.length).toBeGreaterThan(3)
  })

  it.each(pages.map((p) => [p]))('%s: port homes and page counterparts resolve', (page) => {
    const html = readFileSync(join(SITE, page), 'utf8')
    const nav = /<nav[^>]*aria-label="Language"[^>]*>([\s\S]*?)<\/nav>/.exec(html)
    if (!nav) return // not every page carries the switcher

    const hrefs = [...nav[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs).toHaveLength(PORTS.length)
    expect(hrefs.filter((h) => !resolves(h)), `${page}: port links with no page`).toEqual([])
    for (const port of PORTS) {
      const pattern = new RegExp(`/${port.slug}/${port.versionedDocs ? '[^/]+/' : ''}$`)
      expect(hrefs.some((href) => pattern.test(href)), `${page}: ${port.slug} root`).toBe(true)
    }
    const menu = /<details[^>]*data-page-port-switcher[^>]*>([\s\S]*?)<\/details>/.exec(html)
    expect(menu, `${page} has a matching-page control`).not.toBeNull()
    const counterparts = [...menu![1].matchAll(/href="([^"]+)"/g)].map((match) => match[1])
    expect(counterparts.length, `${page} has an available counterpart`).toBeGreaterThan(0)
    expect(counterparts.filter((href) => !resolves(href)), `${page}: matching pages missing on disk`).toEqual([])
  })

  it.each(pages.map((p) => [p]))('%s: every hreflang alternate resolves', (page) => {
    const html = readFileSync(join(SITE, page), 'utf8')
    const hrefs = [...html.matchAll(/<link[^>]+hreflang="[^"]+"[^>]+href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs.filter((h) => !resolves(h)), `${page}: alternates with no page`).toEqual([])
  })

  it('never offers a port link that carries a reference path', () => {
    // Bug 2, stated directly. The reference lives only at the root, so a port
    // link must never transplant `reference/<port>/…` under `/<port>/<version>/`.
    for (const page of pages) {
      const html = readFileSync(join(SITE, page), 'utf8')
      const nav = /<nav[^>]*aria-label="Language"[^>]*>([\s\S]*?)<\/nav>/.exec(html)
      if (!nav) continue
      const bad = [...nav[1].matchAll(/href="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((h) => /\/[a-z]+\/[^/]+\/reference\//.test(h))
      expect(bad, `${page}: port link carrying a reference path`).toEqual([])
    }
  })
})
