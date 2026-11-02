import { describe, expect, it } from 'vitest'
import {
  audit, brandOfAsset, locate, pageFindings, parseHead, RULES, setFindings, SITE_NAME, slugTitle, TITLE_BUDGET,
} from '../scripts/audit-head-rules.mjs'
import { branding, documentationTitle } from '../src/lib/branding'
import { PORTS, portHomeTitle } from '../src/lib/ports'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { SCHEME } from './document-title.test'

/*
 * The audit decides what a snag is, so each rule is tested against a head
 * planted with exactly that snag, and against the same head without it. A
 * rule that stops firing, or starts firing on a clean head, fails here.
 */

const ORIGIN = 'https://libtmux.org'
const PORT_PAGE = `${ORIGIN}/en/ts/latest/mcp/resources/capabilities/`

interface Spec {
  title: string | null
  description: string | null
  canonical: string | null
  robots: string | null
  lang: string
  ogTitle: string | null
  ogSiteName: string | null
  ogUrl: string | null
  ogImage: string | null
  ogImageType: string | null
  twitterTitle: string | null
  twitterImage: string | null
  ogDescription: string | null
  icons: string[]
  manifest: string | null
  hreflang: [string, string][]
  refresh: boolean
}

/** A head the audit accepts for `url`, built from the same scheme the site uses. */
function cleanSpec(url: string): Spec {
  const where = locate(url)
  const pagePath = where.kind === 'tmux' ? `tmux/${where.pagePath}` : where.pagePath
  const brand = branding(where.port, where.pagePath, `/${where.locale}`)
  const { title, social } = documentationTitle({ title: where.kind === 'site' ? 'Support' : 'capabilities', pagePath, portSlug: where.port })
  const asset = (file: string) => `${ORIGIN}${brand.asset(file)}`
  return {
    title, description: 'The frozen structured-tool surface and its capability declarations.', canonical: url,
    robots: 'index, follow', lang: where.locale ?? 'en', ogTitle: social, ogSiteName: SITE_NAME, ogUrl: url,
    ogImage: asset('opengraph-light.png'), ogImageType: 'image/png', twitterTitle: social, twitterImage: asset('twitter-light.png'),
    ogDescription: null,
    icons: [
      `<link rel="icon" href="${asset('favicon.ico')}" sizes="16x16 32x32 48x48 256x256">`,
      `<link rel="apple-touch-icon" href="${asset('apple-touch-icon-light.png')}" sizes="180x180">`,
      `<link rel="mask-icon" href="${asset('safari-pinned-tab.svg')}" color="#3178C6">`,
    ],
    manifest: asset('site.webmanifest'), hreflang: [], refresh: false,
  }
}

function render(spec: Spec): string {
  const meta = (key: string, kind: 'property' | 'name', value: string | null) => (value === null ? '' : `<meta ${kind}="${key}" content="${value}">`)
  return `<!doctype html><html lang="${spec.lang}"><head><meta charset="utf-8">
${spec.title === null ? '' : `<title>${spec.title}</title>`}
${spec.description === null ? '' : `<meta name="description" content="${spec.description}">`}
${spec.canonical === null ? '' : `<link rel="canonical" href="${spec.canonical}">`}
${meta('robots', 'name', spec.robots)}
${spec.refresh ? '<noscript><meta http-equiv="refresh" content="0;url=/en/"></noscript>' : ''}
${spec.hreflang.map(([tag, href]) => `<link rel="alternate" hreflang="${tag}" href="${href}">`).join('\n')}
${meta('og:title', 'property', spec.ogTitle)}${meta('og:site_name', 'property', spec.ogSiteName)}${meta('og:url', 'property', spec.ogUrl)}
${meta('og:image', 'property', spec.ogImage)}${meta('og:image:type', 'property', spec.ogImageType)}${meta('og:description', 'property', spec.ogDescription)}
${meta('twitter:title', 'name', spec.twitterTitle)}${meta('twitter:image', 'name', spec.twitterImage)}
${spec.icons.join('\n')}
${spec.manifest === null ? '' : `<link rel="manifest" href="${spec.manifest}">`}
</head><body><svg><title>an inline icon title</title></svg></body></html>`
}

const rulesFor = (url: string, spec: Spec, extra: Record<string, unknown> = {}, context = {}) =>
  pageFindings({ url, status: 200, head: parseHead(render(spec)), ...extra }, context).map((item) => item.rule)

type Case = { url?: string; change?: (spec: Spec) => void; page?: (spec: Spec) => Record<string, unknown>; context?: Record<string, unknown> }

/** One planted snag per rule that reads a single page. */
const PLANTED: Record<string, Case> = {
  'http-status': { page: () => ({ status: 404, head: null }) },
  redirect: { page: () => ({ status: 302, head: null, location: '/en/' }) },
  'redirect-stub': { change: (s) => { s.refresh = true } },
  'title-missing': { change: (s) => { s.title = null } },
  'title-generic': { change: (s) => { s.title = 'the documentation' } },
  'title-slug-case': { change: (s) => { s.title = 'capabilities | libtmux-ts' } },
  'title-lacks-context': { change: (s) => { s.title = 'Capabilities | libtmux.org' } },
  'title-over-budget': { change: (s) => { s.title = `capabilities | TypeScript MCP resource | ${'x'.repeat(TITLE_BUDGET)}` } },
  'description-missing': { change: (s) => { s.description = null } },
  'description-generic': { change: (s) => { s.description = 'libtmux-ts: typed tmux control for TypeScript.' } },
  'description-short': { change: (s) => { s.description = 'Too short.' } },
  'description-long': { change: (s) => { s.description = 'word '.repeat(60) } },
  'canonical-missing': { change: (s) => { s.canonical = null } },
  'canonical-mismatch': { change: (s) => { s.canonical = `${ORIGIN}/en/ts/v0.1.0/mcp/resources/capabilities/` } },
  'robots-missing': { change: (s) => { s.robots = null } },
  'og-title-missing': { change: (s) => { s.ogTitle = null } },
  'og-title-mismatch': { change: (s) => { s.ogTitle = 'Something else' } },
  'twitter-title-missing': { change: (s) => { s.twitterTitle = null } },
  'twitter-title-mismatch': { change: (s) => { s.twitterTitle = 'Something else' } },
  'og-site-name': { change: (s) => { s.ogSiteName = 'libtmux-ts' } },
  'og-url-mismatch': { change: (s) => { s.ogUrl = `${ORIGIN}/en/` } },
  'og-image-missing': { change: (s) => { s.ogImage = null } },
  'twitter-image-missing': { change: (s) => { s.twitterImage = null } },
  'social-image-format': { change: (s) => { s.ogImage = `${ORIGIN}/en/brand/typescript/mcp/logo.svg`; s.ogImageType = 'image/svg+xml' } },
  'social-description-mismatch': { change: (s) => { s.ogDescription = 'Another description entirely.' } },
  'icon-missing': { change: (s) => { s.icons = [] } },
  'manifest-missing': { change: (s) => { s.manifest = null } },
  'asset-unreachable': { page: (s) => ({ assets: { [s.manifest!]: 404 } }) },
  'brand-mismatch': { change: (s) => { s.icons = s.icons.map((icon) => icon.replace('typescript/mcp', 'python/library')) } },
  'lang-mismatch': { change: (s) => { s.lang = 'ja' } },
  'hreflang-incomplete': { change: (s) => { s.hreflang = [['en', PORT_PAGE], ['ja', PORT_PAGE.replace('/en/', '/ja/')]] } },
  'hreflang-unreachable': {
    change: (s) => { s.hreflang = [['en', PORT_PAGE], ['x-default', PORT_PAGE]] },
    page: () => ({ alternateStatus: { [PORT_PAGE]: 404 } }),
  },
  'not-in-sitemap': { context: { sitemap: new Set() } },
  'noindex-in-sitemap': { change: (s) => { s.robots = 'noindex, nofollow' }, context: { sitemap: new Set([PORT_PAGE]) } },
  'redirect-listed': { page: () => ({ status: 301, head: null, location: '/en/' }), context: { sitemap: new Set([PORT_PAGE]) } },
  'sitemap-url-error': { page: () => ({ status: 404, head: null }), context: { sitemap: new Set([PORT_PAGE]) } },
}

/** The rules that compare pages or sitemaps, tested below with their own pages. */
const SET_RULES = ['title-duplicate', 'description-duplicate', 'hreflang-missing', 'sitemap-unreachable']

describe('head audit rules', () => {
  it('accepts a head the title scheme and brand assets produce', () => {
    const context = { sitemap: new Set([PORT_PAGE]) }
    expect(rulesFor(PORT_PAGE, cleanSpec(PORT_PAGE), {}, context)).toEqual([])
    const site = `${ORIGIN}/en/meta/support/`
    expect(rulesFor(site, cleanSpec(site), {}, { sitemap: new Set([site]) })).toEqual([])
  })

  it('has a planted head for every rule', () => {
    expect(Object.keys(PLANTED).sort()).toEqual(Object.keys(RULES).filter((rule) => !SET_RULES.includes(rule)).sort())
  })

  it.each(Object.entries(PLANTED))('flags %s', (rule, planted) => {
    const url = planted.url ?? PORT_PAGE
    const spec = cleanSpec(url)
    planted.change?.(spec)
    const page = planted.page?.(spec) ?? {}
    const context = { sitemap: new Set([url]), ...planted.context }
    const found = rulesFor(url, spec, page, context)
    expect(found, rule).toContain(rule)
    // The same head without the snag stays clean for this rule.
    expect(rulesFor(url, cleanSpec(url), {}, { sitemap: new Set([url]) })).not.toContain(rule)
  })

  it('reads the document head, not an inline SVG title in the body', () => {
    const spec = cleanSpec(PORT_PAGE)
    spec.title = null
    expect(parseHead(render(spec)).title).toBeNull()
    expect(rulesFor(PORT_PAGE, spec)).toContain('title-missing')
  })

  it('flags slug-cased titles and not named ones', () => {
    expect(slugTitle('capabilities | libtmux-ts')).toBe(true)
    expect(slugTitle('kill_pane | libtmux.org')).toBe(true)
    expect(slugTitle('kill_pane | C++ MCP tool | libtmux.org')).toBe(false)
    expect(slugTitle('Capabilities | libtmux.org')).toBe(false)
  })

  it('accepts a social title with or without the site name', () => {
    const spec = cleanSpec(PORT_PAGE)
    spec.ogTitle = spec.title
    spec.twitterTitle = spec.title
    expect(rulesFor(PORT_PAGE, spec)).not.toContain('og-title-mismatch')
    expect(rulesFor(PORT_PAGE, spec)).not.toContain('twitter-title-mismatch')
  })

  it('judges a noindex canonical mismatch as information, not a snag', () => {
    const spec = cleanSpec(PORT_PAGE)
    spec.canonical = `${ORIGIN}/en/ts/v0.1.0/mcp/resources/capabilities/`
    spec.robots = 'noindex, follow'
    const found = pageFindings({ url: PORT_PAGE, status: 200, head: parseHead(render(spec)) }).find((item) => item.rule === 'canonical-mismatch')
    expect(found?.severity).toBe('info')
  })

  it('finds the brand a URL expects, per language and product', () => {
    expect(locate(PORT_PAGE)).toMatchObject({ locale: 'en', port: 'ts', brand: 'typescript/mcp', section: 'port/mcp/resources' })
    expect(locate(`${ORIGIN}/en/java/latest/reference/libtmux-kotlin`).brand).toBe('kotlin/library')
    expect(locate(`${ORIGIN}/en/tmux/latest/manual/capture-pane/`)).toMatchObject({ kind: 'tmux', brand: 'tmux', section: 'tmux/manual' })
    expect(locate(`${ORIGIN}/ja/`)).toMatchObject({ locale: 'ja', kind: 'site', brand: 'python/library' })
    expect(brandOfAsset(`${ORIGIN}/en/brand/rust/workspace/logo.svg`)).toBe('rust/workspace')
    expect(brandOfAsset(`${ORIGIN}/en/brand/tmux/tmux-logomark.svg`)).toBe('tmux')
  })
})

describe('head audit across pages', () => {
  const page = (url: string, mutate: (spec: Spec) => void = () => {}) => {
    const spec = cleanSpec(url)
    // Distinct by default, so only the pages a test makes alike are alike.
    const name = new URL(url).pathname.split('/').filter(Boolean).at(-1)!.slice(0, 2)
    spec.title = `${spec.title} ${name}`
    spec.ogTitle = spec.title
    spec.twitterTitle = spec.title
    spec.description = `${spec.description} ${name}`
    mutate(spec)
    return { url, status: 200, head: parseHead(render(spec)) }
  }
  const a = `${ORIGIN}/en/ts/latest/guides/sending-keys/`
  const b = `${ORIGIN}/en/ts/latest/guides/capturing-output/`

  it('flags two indexable pages that share a title or a description', () => {
    const same = (s: Spec) => { s.title = 'Same'; s.description = 'The same description of two pages in the site.' }
    const pages = [page(a, same), page(b, same)]
    const found = setFindings(pages)
    expect(found.get(a)?.map((item) => item.rule).sort()).toEqual(['description-duplicate', 'title-duplicate'])
    expect(found.get(b)?.map((item) => item.rule).sort()).toEqual(['description-duplicate', 'title-duplicate'])
  })

  it('does not compare a noindex page with an indexable one', () => {
    const pages = [page(a, (s) => { s.title = 'Same' }), page(b, (s) => { s.title = 'Same'; s.robots = 'noindex, follow' })]
    expect(setFindings(pages).size).toBe(0)
  })

  it('flags a translation the head does not point at', () => {
    const en = `${ORIGIN}/en/meta/support/`
    const ja = `${ORIGIN}/ja/meta/support/`
    const translated = (s: Spec) => { s.title = 'Support (ja)'; s.description = 'The translated description of the support page.' }
    const pages = [page(en), page(ja, translated)]
    const found = setFindings(pages)
    expect(found.get(en)?.map((item) => item.rule)).toEqual(['hreflang-missing'])
    const linked = [page(en, (s) => { s.hreflang = [['en', en], ['ja', ja], ['x-default', en]] }), page(ja, translated)]
    expect(setFindings(linked).get(en)).toBeUndefined()
  })

  it('counts findings by rule with example URLs', () => {
    const { results, byRule } = audit([page(a, (s) => { s.description = null }), page(b)], { sitemap: new Set([a, b]) })
    expect(results.map((result) => result.findings.map((item) => item.rule))).toEqual([['description-missing'], []])
    expect(byRule['description-missing']).toEqual({ severity: 'warn', count: 1, examples: [a] })
    expect(results[0]).toMatchObject({ section: 'port/core/guides', expectedBrand: 'typescript/library', inSitemap: true, brands: ['typescript/library'] })
  })
})

describe('the head Seo writes', () => {
  async function head(props: Record<string, unknown>) {
    const template = await loadAstroTemplate('components/Seo.astro')
    const html = await renderAstroTemplate(template, { props })
    return parseHead(`<html lang="en"><head>${html}</head></html>`)
  }
  const base = { version: 'latest', defaultVersion: 'latest', versionEntry: { slug: 'latest', label: 'latest', kind: 'trunk', supported: true } }
  const pages = SCHEME.filter(([, subject]) => subject.pagePath && !PORTS.some((port) => portHomeTitle(port) === subject.title))

  it.each(pages)('writes the scheme for a %s, and the audit finds nothing to say about it', async (_name, subject, expected) => {
    const parsed = await head({ ...base, title: subject.title, pagePath: subject.pagePath, portSlug: subject.portSlug })
    expect(parsed.title).toBe(expected)
    expect(expected).toContain(parsed.og.title)
    expect(parsed.twitter.title).toBe(parsed.og.title)
    expect(parsed.og.site_name).toBe(SITE_NAME)
    const path = subject.portSlug ? `${subject.portSlug}/latest/${subject.pagePath}` : subject.pagePath
    const found = pageFindings({ url: `${ORIGIN}/en/${path}/`, status: 200, head: parsed }).map((item) => item.rule)
    expect(found.filter((rule) => rule.startsWith('title') || rule.startsWith('og-title') || rule.startsWith('twitter-title') || rule === 'og-site-name' || rule === 'brand-mismatch')).toEqual([])
  })
})
