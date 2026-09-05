import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SITE_BUILT, SITE_ROOT } from './site-root'

/**
 * Every link a switcher offers must land on a page that exists.
 *
 * This one bug shape has now shipped three times in three disguises, each
 * time because a control that carries the reader's place across an axis was
 * pointed at an axis where that place has no counterpart:
 *
 *  1. The locale prefix travelled across ports, so switching language from a
 *     Japanese page asked for `/py/stable/ja/…`, which is not a URL this site
 *     has ever produced.
 *  2. The port switcher kept the path on `/reference/`, which is root-only, so
 *     every one of 1,009 reference pages offered `/cxx/stable/reference/ts/…`.
 *     8,221 broken links from one header change.
 *  3. A repeated port closed a code-tab run and dropped the rest of the page's
 *     examples out of the tabs entirely.
 *
 * Each was found by hand, after shipping. The shape is what generalises, so
 * the assertion is about the shape: harvest every switcher link on a sample
 * of real pages and require its target to exist on disk. A fourth variant
 * fails here rather than in someone's browser.
 *
 * Sampled rather than exhaustive: the full tree is 4,000 pages and
 * `check-links.mjs` already walks all of them during the assembly. This runs
 * in the unit suite, where the cost has to stay in milliseconds, and covers
 * one page of every kind that carries a switcher.
 */
const SITE = SITE_ROOT

const describeIfAssembled = SITE_BUILT ? describe : describe.skip

/** Pages that exercise a different combination of the port, version and locale axes. */
function samplePages(): string[] {
  const wanted = [
    'index.html',
    'ja/index.html',
    'concepts/index.html',
    'ja/concepts/index.html',
    'topics/architecture/index.html',
    'py/index.html',
    'py/stable/topics/architecture/index.html',
    'ts/latest/topics/architecture/index.html',
    'rs/index.html',
    'reference/index.html',
  ]
  const present = wanted.filter((p) => existsSync(join(SITE, p)))

  // One real reference page, whichever exists — this is the axis that broke.
  try {
    const found = execFileSync('find', [join(SITE, 'reference'), '-name', 'index.html', '-mindepth', '2'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')
      .filter(Boolean)
    if (found.length) present.push(found[0].replace(`${SITE}/`, ''))
  } catch {
    /* no reference tree in this build */
  }
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

  it.each(pages.map((p) => [p]))('%s: every port-switcher link resolves', (page) => {
    const html = readFileSync(join(SITE, page), 'utf8')
    const nav = /<nav[^>]*aria-label="Language"[^>]*>([\s\S]*?)<\/nav>/.exec(html)
    if (!nav) return // not every page carries the switcher

    const hrefs = [...nav[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs.length, `${page} offers ports`).toBeGreaterThan(0)
    expect(hrefs.filter((h) => !resolves(h)), `${page}: port links with no page`).toEqual([])
  })

  it.each(pages.map((p) => [p]))('%s: every hreflang alternate resolves', (page) => {
    const html = readFileSync(join(SITE, page), 'utf8')
    const hrefs = [...html.matchAll(/<link[^>]+hreflang="[^"]+"[^>]+href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs.filter((h) => !resolves(h)), `${page}: alternates with no page`).toEqual([])
  })

  it('never offers a port link that carries a locale prefix', () => {
    // Bug 1, stated directly. `/py/stable/ja/…` is not a URL shape this site
    // produces, and the reference is never localised.
    for (const page of pages) {
      const html = readFileSync(join(SITE, page), 'utf8')
      const nav = /<nav[^>]*aria-label="Language"[^>]*>([\s\S]*?)<\/nav>/.exec(html)
      if (!nav) continue
      const bad = [...nav[1].matchAll(/href="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((h) => /\/(ja|en)\//.test(h))
      expect(bad, `${page}: port link carrying a locale`).toEqual([])
    }
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
