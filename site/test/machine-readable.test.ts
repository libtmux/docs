import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOCALES } from '../src/i18n/locales'
import { PORTS } from '../src/lib/ports'
import { TMUX_REPOSITORY } from '../src/lib/tmux-manual-data'
import { BUCKET_ROOT, ASSEMBLY_ROOT, PREVIEW_PREFIX, REPO_ROOT, SITE_BUILT } from './site-root'

/**
 * Every page names its source and links its machine-readable forms.
 *
 * The footer follows gp-sphinx's `page-source` line on libtmux.git-pull.com:
 * the source path, then Markdown, raw source, docs.json, llms.txt and
 * llms-full.txt. The Markdown link is the part that rots silently. The footer
 * computes it while rendering, and another route or the post-build conversion
 * writes the file, so only the built tree shows whether the two agree.
 * gp-sphinx shipped that bug: generated pages linked `.md` twins it never
 * wrote (notes/upstream/sphinx-gp-llms-md-twins.md).
 */

/** Native Sphinx output the publisher deletes before upload. */
const NATIVE = /^(?:pr-\d+\/)?[a-z]{2}\/py\/[^/]+\/api\//
const DATA = fileURLToPath(new URL('../src/data/', import.meta.url))
const json = (file: string) => JSON.parse(readFileSync(join(DATA, file), 'utf8'))

/** This repository, and every repository the site's data names as a source. */
const REPOS = new Set<string>(['libtmux/docs', TMUX_REPOSITORY, ...PORTS.map((port) => port.repo)])
for (const file of readdirSync(join(DATA, 'api')).filter((name) => name.endsWith('.json'))) {
  const model = json(`api/${file}`)
  for (const repo of [model.repo, ...(model.sources ?? []).map((source: { repo?: string }) => source.repo),
    ...(model.symbols ?? []).map((symbol: { source?: { repo?: string } }) => symbol.source?.repo)]) if (repo) REPOS.add(repo)
}
for (const port of Object.values(json('mcp-tools.json').ports) as { registrations?: { source?: { repo?: string } }[] }[]) {
  for (const tool of port.registrations ?? []) if (tool.source?.repo) REPOS.add(tool.source.repo)
}
const attr = (name: string) => new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`)
const value = (tag: string, name: string) => {
  const match = attr(name).exec(tag)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

/** Directory links must belong to the page's library, not just a known repository. */
function githubSourceMatches(href: string | undefined, page: string): boolean {
  if (!href) return false
  const path = page.replace(/^pr-[1-9][0-9]*\//, '')
  if (/^[a-z]{2}\/tmux\/[^/]+\/manual\//.test(path)) {
    return href === `https://github.com/${TMUX_REPOSITORY}/`
  }
  const port = PORTS.find((entry) => entry.slug === path.split('/')[1])
  if (port?.source) {
    const tree = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/tree\/([^/?#]+)\/(.+?)\/?$/.exec(href)
    return tree?.[1] === port.repo && tree[3] === port.source.path
  }
  const repo = /^https:\/\/github\.com\/([^/]+\/[^/]+?)\/?$/.exec(href)?.[1]
  return !!repo && REPOS.has(repo)
}

describe('GitHub footer targets', () => {
  it('identifies tmux command sources independently of the library ports', () => {
    for (const prefix of ['', 'pr-67/']) {
      const page = `${prefix}en/tmux/3.2a/manual/capture-pane/index.html`
      expect(githubSourceMatches('https://github.com/tmux/tmux/', page)).toBe(true)
      expect(githubSourceMatches('https://github.com/libtmux/docs/', page)).toBe(false)
      expect(githubSourceMatches('https://github.com/unrelated/tmux/', page)).toBe(false)
      expect(REPOS.has(TMUX_REPOSITORY)).toBe(true)
    }
  })

  it.each(['kotlin', 'scala'])('accepts the declared %s directory at a branch, tag or revision', (slug) => {
    for (const ref of ['master', 'v0.0.1-alpha.17', 'a'.repeat(40), 'feature%2Fsource-links']) {
      for (const prefix of ['', 'pr-50/']) {
        expect(githubSourceMatches(`https://github.com/libtmux/libtmux-java/tree/${ref}/libtmux-${slug}`, `${prefix}en/${slug}/latest/index.html`)).toBe(true)
      }
    }
  })

  it('retains repository roots for core libraries, companions and shared docs', () => {
    expect(githubSourceMatches('https://github.com/libtmux/libtmux-java/', 'en/java/latest/index.html')).toBe(true)
    expect(githubSourceMatches('https://github.com/tmux-python/libtmux-mcp/', 'en/py/latest/mcp/index.html')).toBe(true)
    expect(githubSourceMatches('https://github.com/libtmux/docs/', 'en/index.html')).toBe(true)
  })

  it.each([
    undefined,
    'https://github.com/libtmux/libtmux-java/',
    'https://github.com/libtmux/libtmux-java/tree/master/libtmux-scala',
    'https://github.com/libtmux/libtmux-java/tree/master/other-directory',
    'https://github.com/libtmux/libtmux-java/tree/master/libtmux-kotlin/README.md',
    'https://github.com/libtmux/libtmux-java/tree//libtmux-kotlin',
    'https://github.com/unrelated/project/tree/master/libtmux-kotlin',
    'https://example.com/libtmux/libtmux-java/tree/master/libtmux-kotlin',
  ])('rejects an undeclared Kotlin target: %s', (href) => {
    for (const prefix of ['', 'pr-50/']) {
      expect(githubSourceMatches(href, `${prefix}en/kotlin/latest/index.html`)).toBe(false)
    }
  })
})

function htmlFiles(): string[] {
  return LOCALES.filter((locale) => existsSync(join(ASSEMBLY_ROOT, locale))).flatMap((locale) =>
    (readdirSync(join(ASSEMBLY_ROOT, locale), { recursive: true }) as string[])
      .filter((file) => file.endsWith('.html'))
      .map((file) => `${PREVIEW_PREFIX.slice(1)}${PREVIEW_PREFIX ? '/' : ''}${locale}/${file.replaceAll('\\', '/')}`))
}

function resolves(href: string, page: string): boolean {
  const url = new URL(href, `https://libtmux.org/${page}`)
  if (url.origin !== 'https://libtmux.org') return false
  const file = join(BUCKET_ROOT, decodeURIComponent(url.pathname).replace(/^\//, ''))
  return existsSync(file) && statSync(file).isFile()
}

/** Files at HEAD, for footers that name a source in this repository. */
function trackedFiles(): Set<string> {
  const out = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
  return new Set(out.split('\n').filter(Boolean))
}

interface Footer {
  source?: string
  markdown?: string
  raw?: string
  manifest?: string
  llms?: string
  llmsFull?: string
  github?: string
  alternate?: string
  canonical?: string
}

function footerOf(html: string): Footer | undefined {
  const block = /<div\b[^>]*\bclass=(?:"[^"]*\bpage-source\b[^"]*"|page-source\b)[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1]
  if (block === undefined) return undefined
  const hrefs = [...block.matchAll(/<a\b[^>]*>/g)].map((tag) => value(tag[0], 'href') ?? '')
  const icon = [...html.slice(html.indexOf(block)).matchAll(/<a\b[^>]*>/g)].map((tag) => tag[0])
    .find((tag) => value(tag, 'aria-label') === 'GitHub')
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map((tag) => tag[0])
  const alternate = links.find((tag) => value(tag, 'rel') === 'alternate' && value(tag, 'type') === 'text/markdown')
  const canonical = links.find((tag) => value(tag, 'rel') === 'canonical')
  return {
    source: /<code>([^<]+)<\/code>/.exec(block)?.[1],
    markdown: hrefs.find((href) => href.endsWith('.md')),
    raw: hrefs.find((href) => href.startsWith('https://github.com/')),
    manifest: hrefs.find((href) => href.endsWith('/docs.json')),
    llms: hrefs.find((href) => href.endsWith('/llms.txt')),
    llmsFull: hrefs.find((href) => href.endsWith('/llms-full.txt')),
    github: icon && value(icon, 'href'),
    alternate: alternate && value(alternate, 'href'),
    canonical: canonical && value(canonical, 'href'),
  }
}

describe.skipIf(!SITE_BUILT)('machine-readable footer', () => {
  it('links every page to its source and to Markdown, docs.json and llms files that exist', () => {
    const tracked = trackedFiles()
    const problems: string[] = []
    let checked = 0
    for (const page of htmlFiles()) {
      const html = readFileSync(join(BUCKET_ROOT, page), 'utf8')
      if (/http-equiv=(?:"refresh"|refresh)/.test(html)) continue
      if (NATIVE.test(page)) continue
      const root = /<html\b[^>]*>/.exec(html)?.[0] ?? ''
      if (!value(root, 'data-brand')) {
        problems.push(`${page}: neither a shell page nor native API output`)
        continue
      }
      checked++
      const footer = footerOf(html)
      if (!footer) {
        problems.push(`${page}: no page-source footer`)
        continue
      }
      for (const [name, href] of Object.entries({ markdown: footer.markdown, manifest: footer.manifest, llms: footer.llms, llmsFull: footer.llmsFull })) {
        if (!href) problems.push(`${page}: no ${name} link`)
        else if (!resolves(href, page)) problems.push(`${page}: ${name} ${href} does not exist`)
      }
      if (footer.alternate !== footer.markdown) problems.push(`${page}: <head> Markdown ${footer.alternate} differs from footer ${footer.markdown}`)
      if (footer.markdown && resolves(footer.markdown, page)) {
        const twin = new URL(footer.markdown, `https://libtmux.org/${page}`).pathname
        const text = readFileSync(join(BUCKET_ROOT, twin.replace(/^\//, '')), 'utf8')
        if (!text.startsWith('# ')) problems.push(`${page}: Markdown ${footer.markdown} has no title`)
        // A prose twin names its own page and a converted one the page's
        // canonical URL; symbol twins have their own header.
        const named = /^Source: (\S+)$/.exec(text.split('\n')[2] ?? '')?.[1]
        if (named) {
          const path = new URL(named).pathname
          const own = (twin.endsWith('/index.md') ? `${path}index.md` : `${path.replace(/\/$/, '')}.md`) === twin
          const canonical = footer.canonical && new URL(footer.canonical, `https://libtmux.org/${page}`).pathname === path
          if (!own && !canonical) problems.push(`${page}: Markdown ${footer.markdown} names ${named}, neither its page nor its canonical URL`)
        }
      }
      const raw = footer.raw && /^https:\/\/github\.com\/([^/]+\/[^/]+)\/raw\/[^/]+\/(.+)$/.exec(footer.raw)
      if (!raw) problems.push(`${page}: raw source ${footer.raw} is not a GitHub raw URL`)
      else {
        if (!REPOS.has(raw[1])) problems.push(`${page}: raw source repository ${raw[1]} is unknown`)
        if (footer.source !== raw[2]) problems.push(`${page}: source ${footer.source} differs from raw path ${raw[2]}`)
        if (raw[1] === 'libtmux/docs' && !tracked.has(raw[2])) problems.push(`${page}: source ${raw[2]} is not tracked`)
      }
      if (!githubSourceMatches(footer.github, page)) problems.push(`${page}: GitHub icon ${footer.github} is not a declared source target`)
    }
    expect(checked, 'shell pages found').toBeGreaterThan(0)
    expect(problems.slice(0, 40), `${problems.length} footer problems across ${checked} pages`).toEqual([])
  }, 600_000)

  // llms-full.txt is the page twins concatenated, so the two cannot drift:
  // a section and the twin of the page it names are the same text.
  it('keeps llms-full.txt and the page twins in step', () => {
    const problems: string[] = []
    let checked = 0
    for (const locale of LOCALES.filter((locale) => existsSync(join(ASSEMBLY_ROOT, locale, 'llms-full.txt')))) {
      for (const section of readFileSync(join(ASSEMBLY_ROOT, locale, 'llms-full.txt'), 'utf8').split('\n---\n\n').slice(1)) {
        const url = /^Source: (\S+)$/m.exec(section)?.[1]
        if (!url) {
          problems.push(`${locale}/llms-full.txt: a section names no page`)
          continue
        }
        const page = join(BUCKET_ROOT, decodeURIComponent(new URL(url).pathname).replace(/^\//, ''), 'index.html')
        if (!existsSync(page)) {
          problems.push(`${locale}/llms-full.txt: ${url} has no page`)
          continue
        }
        const alternate = footerOf(readFileSync(page, 'utf8'))?.alternate
        const path = alternate && new URL(alternate, url).pathname
        const twin = path && join(BUCKET_ROOT, path.replace(/^\//, ''))
        if (!path || !twin || !existsSync(twin)) {
          problems.push(`${locale}/llms-full.txt: ${url} names no Markdown`)
          continue
        }
        // A placeholder names the original's twin rather than duplicating it,
        // so only a page that owns its Markdown can be compared with it.
        const here = new URL(url).pathname
        if (path !== (path.endsWith('/index.md') ? `${here}index.md` : `${here.replace(/\/$/, '')}.md`)) continue
        checked++
        if (readFileSync(twin, 'utf8').trim() !== section.trim()) problems.push(`${locale}/llms-full.txt: ${url} differs from ${alternate}`)
      }
    }
    expect(checked, 'llms-full.txt sections found').toBeGreaterThan(0)
    expect(problems.slice(0, 20), `${problems.length} llms-full.txt problems across ${checked} sections`).toEqual([])
  })

  // A translation build lists English entries at its own URLs, where a page is
  // either a translation with its own twin or a placeholder linking English.
  it('gives each docs.json page the Markdown that page names', () => {
    const problems: string[] = []
    let checked = 0
    for (const locale of LOCALES.filter((locale) => existsSync(join(ASSEMBLY_ROOT, locale, 'docs.json')))) {
      const manifest = JSON.parse(readFileSync(join(ASSEMBLY_ROOT, locale, 'docs.json'), 'utf8')) as { pages: { url: string; markdownUrl: string; title: string }[] }
      for (const entry of manifest.pages) {
        const file = join(BUCKET_ROOT, decodeURIComponent(new URL(entry.url).pathname).replace(/^\//, ''), 'index.html')
        if (!existsSync(file)) {
          problems.push(`${locale}/docs.json: ${entry.url} has no page`)
          continue
        }
        checked++
        const alternate = footerOf(readFileSync(file, 'utf8'))?.alternate
        const twin = new URL(entry.markdownUrl).pathname
        if (!alternate || new URL(alternate, entry.url).pathname !== twin) {
          problems.push(`${locale}/docs.json: ${entry.url} lists ${entry.markdownUrl}, its page names ${alternate}`)
          continue
        }
        // A manifest entry describes the document that locale serves, so a
        // translated page is titled in its own language, not the original's.
        const md = join(BUCKET_ROOT, twin.replace(/^\//, ''))
        const title = existsSync(md) ? readFileSync(md, 'utf8').split('\n')[0].replace(/^# /, '') : undefined
        if (title !== undefined && title !== entry.title) {
          problems.push(`${locale}/docs.json: ${entry.url} is titled "${entry.title}", its Markdown "${title}"`)
        }
      }
    }
    expect(checked, 'docs.json pages found').toBeGreaterThan(0)
    expect(problems.slice(0, 40), `${problems.length} manifest problems across ${checked} pages`).toEqual([])
  })
})
