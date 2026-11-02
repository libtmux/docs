/**
 * The checks behind `audit-head.mjs`: read a document's head, say what it
 * advertises, and name the snags.
 *
 * Pure functions, no network. The CLI fetches, this decides, and
 * `site/test/head-audit.test.ts` plants one bad head per rule.
 *
 * Only the document head is read. A body holds inline SVG `<title>` elements
 * (the workspace previews) that a text search for `<title>` mistakes for the
 * page's title, so the head is cut at `</head>` and only its direct children
 * are looked at.
 */
import { parse } from 'parse5'
import { DEFAULT_LOCALE, LOCALES } from '../src/i18n/locales.ts'
import {
  DESCRIPTION_BUDGET, PYTHON_DESCRIPTION, SITE_NAME, TITLE_BUDGET,
} from '../src/lib/branding.ts'
import { DOC_PRODUCTS, PORT_BY_SLUG, PORTS, pageBrand } from '../src/lib/ports.ts'

export { DESCRIPTION_BUDGET, SITE_NAME, TITLE_BUDGET }

/** A description shorter than this tells a result nothing the title has not. */
export const DESCRIPTION_FLOOR = 30

/** Every rule, its severity and the sentence the report prints for it. */
export const RULES = {
  'http-status': ['error', 'The page does not answer 200.'],
  redirect: ['warn', 'The page URL answers with a redirect instead of the page.'],
  'redirect-stub': ['warn', 'The page is a client-side redirect stub, not a document.'],
  'title-missing': ['error', 'No <title> in the head.'],
  'title-generic': ['warn', 'The title names nothing: "the documentation", "index", "untitled".'],
  'title-slug-case': ['warn', 'The title is a bare lower-case slug with no context after it.'],
  'title-lacks-context': ['warn', 'The title never says which language, product or section the page is in.'],
  'title-over-budget': ['warn', `The title is longer than ${TITLE_BUDGET} characters.`],
  'title-duplicate': ['warn', 'Another indexable page has the same title.'],
  'description-missing': ['warn', 'No meta description.'],
  'description-generic': ['warn', 'The description is a template fallback shared by many pages.'],
  'description-short': ['info', `The description is shorter than ${DESCRIPTION_FLOOR} characters.`],
  'description-long': ['info', `The description is longer than ${DESCRIPTION_BUDGET} characters.`],
  'description-duplicate': ['warn', 'Another indexable page in the same tree, or at another path, has the same description.'],
  'canonical-missing': ['warn', 'No canonical link.'],
  'canonical-mismatch': ['warn', 'The canonical link is not the page URL.'],
  'robots-missing': ['info', 'No robots meta tag.'],
  'og-title-missing': ['warn', 'No og:title.'],
  'og-title-mismatch': ['warn', 'og:title disagrees with the title.'],
  'twitter-title-missing': ['warn', 'No twitter:title.'],
  'twitter-title-mismatch': ['warn', 'twitter:title disagrees with the title.'],
  'og-site-name': ['warn', `og:site_name is not "${SITE_NAME}".`],
  'og-url-mismatch': ['warn', 'og:url is not the canonical URL.'],
  'og-image-missing': ['warn', 'No og:image.'],
  'twitter-image-missing': ['warn', 'No twitter:image.'],
  'social-image-format': ['warn', 'The social image is an SVG, which Facebook, X and LinkedIn do not render.'],
  'social-description-mismatch': ['warn', 'og:description or twitter:description disagrees with the description.'],
  'icon-missing': ['warn', 'No icon link in the head.'],
  'manifest-missing': ['warn', 'No web app manifest link.'],
  'sitemap-link-missing': ['info', 'No <link rel="sitemap"> pointing at the sitemap that lists the page.'],
  'asset-unreachable': ['error', 'An icon, manifest or social image does not answer 200.'],
  'brand-mismatch': ['warn', "The page advertises another port's or product's brand assets."],
  'lang-mismatch': ['warn', "<html lang> is not the page's locale."],
  'hreflang-incomplete': ['warn', 'The hreflang cluster lacks x-default or the page itself.'],
  'hreflang-unreachable': ['warn', 'An hreflang alternate does not answer 200.'],
  'hreflang-missing': ['warn', 'A translation of this page is published but the head does not point at it.'],
  'not-in-sitemap': ['warn', 'An indexable page that no advertised sitemap lists.'],
  'noindex-in-sitemap': ['warn', 'A sitemap lists a page that says noindex.'],
  'redirect-listed': ['warn', 'A sitemap lists a URL that redirects.'],
  'sitemap-url-error': ['error', 'A sitemap lists a URL that does not answer 200.'],
  'sitemap-unreachable': ['error', 'An advertised sitemap does not answer 200.'],
}

const severityOf = (rule) => RULES[rule][0]
const finding = (rule, detail) => ({ rule, severity: severityOf(rule), detail })

const attributes = (node) => Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]))
const textOf = (node) => (node.childNodes ?? []).map((child) => child.value ?? textOf(child)).join('')

/**
 * What a head advertises, from the document's own head children.
 *
 * Returns `null` fields for what is absent, so a rule reads "missing" without
 * guessing between an empty string and nothing.
 */
export function parseHead(html) {
  const end = html.search(/<\/head\s*>/i)
  const head = end < 0 ? html : html.slice(0, end)
  // Scripting off: a <noscript> in the head keeps its markup, which is where a meta refresh lives.
  const document = parse(`${head}</head><body></body>`, { scriptingEnabled: false })
  const root = document.childNodes.find((node) => node.nodeName === 'html')
  const lang = root ? attributes(root).lang ?? null : null
  const headNode = root?.childNodes.find((node) => node.nodeName === 'head')
  const children = headNode?.childNodes.filter((node) => node.tagName) ?? []
  const meta = new Map()
  const icons = []
  const alternates = []
  let title = null
  let canonical = null
  let manifest = null
  let sitemap = null
  let refresh = false
  for (const node of children) {
    const a = attributes(node)
    if (node.tagName === 'title' && title === null) title = textOf(node).trim()
    else if (node.tagName === 'meta') {
      const key = a.property ?? a.name ?? (a['http-equiv'] ? `http-equiv:${a['http-equiv']}` : undefined)
      if (key && !meta.has(key)) meta.set(key, a.content ?? '')
      if (a['http-equiv']?.toLowerCase() === 'refresh') refresh = true
    } else if (node.tagName === 'link') {
      const rels = (a.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      if (rels.includes('canonical') && canonical === null) canonical = a.href ?? ''
      else if (rels.includes('manifest') && manifest === null) manifest = a.href ?? ''
      else if (rels.includes('sitemap') && sitemap === null) sitemap = a.href ?? ''
      else if (rels.some((rel) => ['icon', 'shortcut', 'apple-touch-icon', 'mask-icon'].includes(rel))) {
        icons.push({ rel: rels.filter((rel) => rel !== 'shortcut').join(' '), href: a.href ?? '', sizes: a.sizes ?? null, type: a.type ?? null })
      } else if (rels.includes('alternate')) {
        alternates.push({ hreflang: a.hreflang ?? null, type: a.type ?? null, href: a.href ?? '' })
      }
    } else if (node.tagName === 'noscript') {
      // With scripting off the parser keeps a noscript's markup, where a meta refresh lives.
      if ((node.childNodes ?? []).some((child) => child.tagName === 'meta' && attributes(child)['http-equiv']?.toLowerCase() === 'refresh')) refresh = true
    }
  }
  const prefixed = (prefix) => Object.fromEntries([...meta].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]))
  return {
    title,
    description: meta.get('description') ?? null,
    canonical,
    robots: meta.get('robots') ?? null,
    lang,
    og: prefixed('og:'),
    twitter: prefixed('twitter:'),
    themeColors: children.filter((node) => node.tagName === 'meta' && attributes(node).name === 'theme-color').map((node) => attributes(node).content),
    msapplicationConfig: meta.get('msapplication-config') ?? null,
    icons,
    manifest,
    sitemap,
    alternates,
    refresh,
  }
}

/**
 * Where a URL sits in the site: its locale, port, version and page path, and
 * the artwork that page should advertise.
 */
export function locate(url) {
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  const locale = LOCALES.includes(segments[0]) ? segments.shift() : null
  const first = segments[0]
  let kind = 'site'
  let port
  let version
  let rest = segments
  if (first === 'tmux') kind = 'tmux'
  else if (PORT_BY_SLUG[first]) {
    kind = 'port'
    port = first
    ;[, version, ...rest] = segments
  }
  const pagePath = rest.join('/')
  let brand
  if (kind === 'tmux') brand = 'tmux'
  else {
    const { language, variant } = pageBrand(port, pagePath)
    brand = `${language}/${variant}`
  }
  const product = kind === 'port' ? pageBrand(port, pagePath).variant : undefined
  return { locale, kind, port, version, pagePath, brand, product, section: sectionOf({ kind, port, product, pagePath, segments }) }
}

/** A page's place in the title pattern table: `port/mcp/tool`, `tmux/manual`, `site/meta`. */
export function sectionOf({ kind, product, pagePath, segments }) {
  const parts = pagePath.split('/').filter(Boolean)
  if (kind === 'tmux') {
    const [first, second, third] = segments.slice(1)
    const section = /^(?:latest|\d+\.\d+[a-z]*)$/.test(first ?? '') ? second : first
    return `tmux/${section ?? 'home'}${section === 'catalog' ? `/${/^(?:latest|\d)/.test(first ?? '') ? third ?? '' : second ?? ''}`.replace(/\/$/, '') : ''}`
  }
  if (kind === 'port') {
    const inner = product && product !== 'library' && parts[0] === product ? parts.slice(1) : parts
    const label = product && product !== 'library' ? product : 'core'
    return `port/${label}/${inner[0] ?? 'home'}`
  }
  return `site/${segments[0] ?? 'home'}`
}

/** The brand directory an asset URL belongs to: `typescript/mcp`, `tmux`, or null for anything else. */
export function brandOfAsset(href) {
  const path = (() => {
    try { return new URL(href, 'https://libtmux.org').pathname } catch { return href }
  })()
  const match = /\/brand\/([^/]+)\/([^/]+)\/[^/]+$/.exec(path)
  if (match && match[1] === 'tmux') return 'tmux'
  if (match) return `${match[1]}/${match[2]}`
  return /\/brand\/tmux\/[^/]+$/.test(path) ? 'tmux' : null
}

/** Every URL a head asks a browser or crawler to fetch for artwork or app metadata. */
export function assetsOf(head, base) {
  const out = []
  const add = (role, href) => {
    if (!href) return
    try { out.push({ role, url: new URL(href, base).href }) } catch { /* A malformed URL is reported by the brand rule. */ }
  }
  for (const icon of head.icons) add(icon.rel, icon.href)
  add('manifest', head.manifest)
  add('sitemap', head.sitemap)
  add('msapplication-config', head.msapplicationConfig)
  for (const key of ['image', 'image:secure_url']) add(`og:${key}`, head.og[key])
  add('twitter:image', head.twitter.image)
  return out
}

/** The brand directories a head advertises, in a stable order. */
export function brandsOf(head, base) {
  return [...new Set(assetsOf(head, base).map(({ url }) => brandOfAsset(url)).filter(Boolean))].sort()
}

const GENERIC_TITLE = /^(?:the documentation|documentation|index|home|untitled|redirecting\b.*)$/i
const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/

/**
 * Whether a title is the page name and nothing else. `capabilities | libtmux-ts`
 * says nothing about MCP, a resource or TypeScript; the scheme in
 * `documentationTitle` puts that after the name.
 */
export function slugTitle(title) {
  const parts = title.split(' | ').map((part) => part.trim())
  const brandless = parts.filter((part) => part !== SITE_NAME && part !== 'libtmux' && !PORTS.some((port) => port.projectName === part))
  // `tmux` is the overview page's own name, not a slug standing in for one.
  return brandless.length === 1 && brandless[0] !== 'tmux' && SLUG.test(brandless[0]) && /[a-z]/.test(brandless[0])
}

const GENERIC_DESCRIPTION = [
  /^libtmux for .+, version .+\.$/,
  /: typed tmux control for .+\.$/,
]

const canonicalForm = (url) => {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch { return url }
}

/** The words a title must carry for the page's place in the site. */
function contextWords(where) {
  if (where.kind === 'tmux') return ['tmux']
  if (where.kind !== 'port') return []
  const port = PORT_BY_SLUG[where.port]
  const brandPort = PORTS.find((candidate) => candidate.logoLanguage === where.brand.split('/')[0]) ?? port
  const words = [brandPort.language]
  if (where.product && where.product !== 'library') words.push(DOC_PRODUCTS[where.product].tabLabel)
  return words
}

/**
 * Findings for one page that depend on nothing else.
 *
 * `page` is `{ url, status, location, head, assets }` with `assets` mapping an
 * asset URL to its status (`0` when the request failed). `context.sitemap` is a
 * Set of listed URLs, or null when no sitemap was read.
 */
export function pageFindings(page, context = {}) {
  const out = []
  const { url, status, location, head } = page
  const where = locate(url)
  if (status !== 200) {
    const redirect = status >= 300 && status < 400
    if (redirect) out.push(finding('redirect', `${status} to ${location ?? '(no Location)'}`))
    else out.push(finding('http-status', String(status || 'no response')))
    if (context.sitemap?.has(url)) out.push(redirect ? finding('redirect-listed', `${status}`) : finding('sitemap-url-error', String(status || 'no response')))
    return out
  }
  if (!head) return out
  const noindex = /\bnoindex\b/i.test(head.robots ?? '')
  const title = head.title

  if (head.refresh) out.push(finding('redirect-stub', 'meta refresh in the head'))
  if (title === null || title === '') out.push(finding('title-missing', ''))
  else {
    if (GENERIC_TITLE.test(title)) out.push(finding('title-generic', title))
    if (!head.refresh && slugTitle(title)) out.push(finding('title-slug-case', title))
    if (title.length > TITLE_BUDGET) out.push(finding('title-over-budget', `${title.length} characters`))
    const words = contextWords(where)
    const missing = words.filter((word) => !title.toLowerCase().includes(word.toLowerCase()))
    const home = where.kind === 'port' && !where.pagePath
    if (missing.length && !head.refresh && !home) out.push(finding('title-lacks-context', `missing ${missing.join(', ')}`))
  }

  const description = head.description
  if (!description) {
    if (!head.refresh) out.push(finding('description-missing', ''))
  } else {
    if (GENERIC_DESCRIPTION.some((pattern) => pattern.test(description)) || (description === PYTHON_DESCRIPTION && where.kind !== 'site')) {
      out.push(finding('description-generic', description))
    }
    if (description.length < DESCRIPTION_FLOOR) out.push(finding('description-short', `${description.length} characters`))
    if (description.length > DESCRIPTION_BUDGET) out.push(finding('description-long', `${description.length} characters`))
  }

  if (head.canonical === null) {
    if (!head.refresh) out.push(finding('canonical-missing', ''))
  } else if (canonicalForm(head.canonical) !== canonicalForm(url)) {
    out.push({ ...finding('canonical-mismatch', head.canonical), severity: noindex ? 'info' : 'warn' })
  }
  if (head.robots === null) out.push(finding('robots-missing', ''))

  if (!head.refresh) {
    // A title may carry the site name that og:site_name already prints; the card may drop it.
    const agrees = (social) => social === title || (title !== null && title === `${social} | ${SITE_NAME}`)
    for (const [network, tags] of [['og', head.og], ['twitter', head.twitter]]) {
      if (tags.title === undefined) out.push(finding(`${network}-title-missing`, ''))
      else if (title !== null && !agrees(tags.title)) out.push(finding(`${network}-title-mismatch`, tags.title))
    }
    if (head.og.site_name !== SITE_NAME) out.push(finding('og-site-name', head.og.site_name ?? '(absent)'))
    if (head.og.url !== undefined && head.canonical !== null && canonicalForm(head.og.url) !== canonicalForm(head.canonical)) {
      out.push(finding('og-url-mismatch', head.og.url))
    }
    if (!head.og.image) out.push(finding('og-image-missing', ''))
    if (!head.twitter.image) out.push(finding('twitter-image-missing', ''))
    const vector = [head.og.image, head.twitter.image].filter((image) => image && /\.svg(?:$|\?)/i.test(image))
    if (vector.length || /svg/i.test(head.og['image:type'] ?? '')) out.push(finding('social-image-format', vector.join(', ') || head.og['image:type']))
    for (const [network, tags] of [['og', head.og], ['twitter', head.twitter]]) {
      if (description && tags.description !== undefined && tags.description !== description) {
        out.push(finding('social-description-mismatch', `${network}:description`))
      }
    }
    if (!head.icons.some((icon) => icon.rel.split(' ').includes('icon'))) out.push(finding('icon-missing', ''))
    // The tmux section has one SVG mark and no manifest; its icon set is reported, not demanded.
    if (!head.manifest && where.kind !== 'tmux') out.push(finding('manifest-missing', ''))
    if (!head.sitemap) out.push(finding('sitemap-link-missing', ''))
  }

  const assets = assetsOf(head, url)
  const bad = assets.filter(({ url: asset }) => page.assets && page.assets[asset] !== undefined && page.assets[asset] !== 200)
  if (bad.length) out.push(finding('asset-unreachable', bad.map(({ role, url: asset }) => `${role} ${asset} -> ${page.assets[asset] || 'no response'}`).join('; ')))

  if (!head.refresh) {
    const brands = brandsOf(head, url)
    const wrong = brands.filter((brand) => brand !== where.brand)
    if (wrong.length || (assets.length && !brands.length)) {
      out.push(finding('brand-mismatch', `advertises ${brands.join(', ') || 'none'}; expected ${where.brand}`))
    }
  }

  if (where.locale && head.lang && head.lang.toLowerCase() !== where.locale) {
    out.push(finding('lang-mismatch', `lang="${head.lang}" in the ${where.locale} tree`))
  }

  const hreflang = head.alternates.filter((alternate) => alternate.hreflang)
  if (hreflang.length) {
    const tags = new Set(hreflang.map((alternate) => alternate.hreflang.toLowerCase()))
    if (!tags.has('x-default') || (where.locale && !tags.has(where.locale))) {
      out.push(finding('hreflang-incomplete', [...tags].join(', ')))
    }
    const down = hreflang.filter((alternate) => page.alternateStatus && page.alternateStatus[alternate.href] !== undefined && page.alternateStatus[alternate.href] !== 200)
    if (down.length) out.push(finding('hreflang-unreachable', down.map((alternate) => `${alternate.hreflang} ${alternate.href}`).join('; ')))
  }

  if (context.sitemap) {
    const listed = context.sitemap.has(url)
    const indexable = !noindex && !head.refresh && head.canonical !== null && canonicalForm(head.canonical) === canonicalForm(url)
    if (!listed && indexable) out.push(finding('not-in-sitemap', ''))
    if (listed && noindex) out.push(finding('noindex-in-sitemap', head.robots))
    if (listed && head.refresh) out.push(finding('redirect-listed', 'meta refresh stub'))
  }
  return out
}

/**
 * Findings that compare pages: duplicate titles and descriptions among
 * indexable pages, and translations a head does not point at.
 */
export function setFindings(pages) {
  const out = new Map()
  const add = (url, item) => out.set(url, [...(out.get(url) ?? []), item])
  const live = pages.filter((page) => page.status === 200 && page.head && !page.head.refresh)
  const indexable = live.filter((page) => !/\bnoindex\b/i.test(page.head.robots ?? ''))
  for (const [field, rule] of [['title', 'title-duplicate'], ['description', 'description-duplicate']]) {
    const groups = new Map()
    for (const page of indexable) {
      const value = page.head[field]
      if (value) groups.set(value, [...(groups.get(value) ?? []), page.url])
    }
    // One page in several languages shares its description by design: the port is
    // what differs. A description is shared wrongly within a port, or by two
    // different pages.
    const sameDocument = (a, b) => {
      const [x, y] = [locate(a), locate(b)]
      return field === 'description' && x.port !== y.port && x.pagePath === y.pagePath
    }
    for (const [value, urls] of groups) {
      for (const url of urls) {
        const others = urls.filter((other) => other !== url && !sameDocument(url, other))
        if (others.length) add(url, finding(rule, `${others.length + 1} pages share "${value.length > 70 ? `${value.slice(0, 67)}...` : value}", e.g. ${others[0]}`))
      }
    }
  }
  const byPath = new Map()
  for (const page of live) {
    const where = locate(page.url)
    if (!where.locale) continue
    const key = new URL(page.url).pathname.split('/').filter(Boolean).slice(1).join('/')
    byPath.set(key, [...(byPath.get(key) ?? []), { page, locale: where.locale }])
  }
  for (const siblings of byPath.values()) {
    if (siblings.length < 2) continue
    for (const { page, locale } of siblings) {
      const tags = new Set(page.head.alternates.filter((alternate) => alternate.hreflang).map((alternate) => alternate.hreflang.toLowerCase()))
      const absent = siblings.filter((sibling) => sibling.locale !== locale && !tags.has(sibling.locale))
      if (absent.length && !/\bnoindex\b/i.test(page.head.robots ?? '')) {
        add(page.url, finding('hreflang-missing', `no alternate for ${absent.map((sibling) => sibling.locale).join(', ')}`))
      }
    }
  }
  return out
}

/** Findings about the sitemap files themselves: one per advertised sitemap that does not answer 200. */
export function sitemapFindings(sitemaps) {
  return sitemaps.filter((sitemap) => sitemap.status !== 200).map((sitemap) => ({ url: sitemap.url, ...finding('sitemap-unreachable', String(sitemap.status || 'no response')) }))
}

/** Attach findings to pages and count them by rule. */
export function audit(pages, context = {}) {
  const extra = setFindings(pages)
  const results = pages.map((page) => {
    const findings = [...pageFindings(page, context), ...(extra.get(page.url) ?? [])]
    const where = locate(page.url)
    return {
      url: page.url,
      status: page.status,
      location: page.location ?? null,
      locale: where.locale,
      kind: where.kind,
      port: where.port ?? null,
      version: where.version ?? null,
      section: where.section,
      expectedBrand: where.brand,
      title: page.head?.title ?? null,
      titleLength: page.head?.title?.length ?? null,
      description: page.head?.description ?? null,
      descriptionLength: page.head?.description?.length ?? null,
      canonical: page.head?.canonical ?? null,
      robots: page.head?.robots ?? null,
      lang: page.head?.lang ?? null,
      og: page.head?.og ?? null,
      twitter: page.head?.twitter ?? null,
      icons: page.head?.icons ?? null,
      manifest: page.head?.manifest ?? null,
      sitemapLink: page.head?.sitemap ?? null,
      brands: page.head ? brandsOf(page.head, page.url) : null,
      assets: page.head ? assetsOf(page.head, page.url).map((asset) => ({ ...asset, status: page.assets?.[asset.url] ?? null })) : null,
      alternates: page.head?.alternates ?? null,
      inSitemap: context.sitemap ? context.sitemap.has(page.url) : null,
      findings,
    }
  })
  const byRule = {}
  for (const result of results) {
    for (const item of result.findings) {
      const entry = (byRule[item.rule] ??= { severity: item.severity, count: 0, examples: [] })
      entry.count += 1
      if (entry.examples.length < 3) entry.examples.push(result.url)
    }
  }
  return { results, byRule }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapeHtml = (text) => String(text ?? '').replace(/[&<>"]/g, (c) => ESCAPES[c])
const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** The human report: counts by rule, examples, the title patterns per section, the icon sets. */
export function renderMarkdown(report, { examples = 8 } = {}) {
  const { results, meta } = report
  const byRule = report.summary.byRule
  const lines = [`# Head audit of ${meta.base}`, '']
  lines.push(`Generated ${meta.generatedAt}. ${results.length} pages read; title budget ${TITLE_BUDGET}, description budget ${DESCRIPTION_BUDGET}.`, '')
  lines.push('## Snags by rule', '', '| Rule | Severity | Pages | What it means | Examples |', '| --- | --- | ---: | --- | --- |')
  const order = { error: 0, warn: 1, info: 2 }
  for (const [rule, entry] of Object.entries(byRule).sort((a, b) => order[a[1].severity] - order[b[1].severity] || b[1].count - a[1].count)) {
    lines.push(`| \`${rule}\` | ${entry.severity} | ${entry.count} | ${cell(RULES[rule][1])} | ${entry.examples.map((url) => new URL(url).pathname).map(cell).join('<br>')} |`)
  }
  if (!Object.keys(byRule).length) lines.push('| none | | 0 | | |')

  const sections = new Map()
  for (const result of results) {
    if (!result.title) continue
    const entry = sections.get(result.section) ?? { count: 0, example: result }
    entry.count += 1
    sections.set(result.section, entry)
  }
  lines.push('', '## Title pattern by section', '', '| Section | Pages | Example title | Example |', '| --- | ---: | --- | --- |')
  for (const [section, entry] of [...sections].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`| \`${section}\` | ${entry.count} | ${cell(entry.example.title)} | ${cell(new URL(entry.example.url).pathname)} |`)
  }

  const brands = new Map()
  for (const result of results) {
    if (!result.brands) continue
    const key = `${result.expectedBrand} <- ${result.brands.join(' + ') || 'none'}`
    brands.set(key, (brands.get(key) ?? 0) + 1)
  }
  lines.push('', '## Icon sets', '', 'Brand directory the page should advertise, and the one or ones it does.', '',
    '| Expected <- advertised | Pages |', '| --- | ---: |')
  for (const [key, count] of [...brands].sort((a, b) => b[1] - a[1])) lines.push(`| ${key} | ${count} |`)

  if (meta.sitemaps?.length) {
    lines.push('', '## Sitemaps', '', '| Sitemap | Status | URLs |', '| --- | ---: | ---: |')
    for (const sitemap of meta.sitemaps) lines.push(`| ${sitemap.url} | ${sitemap.status} | ${sitemap.urls ?? ''} |`)
  }

  lines.push('', '## Examples per rule', '')
  for (const rule of Object.keys(byRule).sort()) {
    lines.push(`### \`${rule}\``, '')
    let shown = 0
    for (const result of results) {
      const item = result.findings.find((candidate) => candidate.rule === rule)
      if (!item) continue
      lines.push(`- ${new URL(result.url).pathname}${item.detail ? `: ${item.detail}` : ''}`)
      if (++shown >= examples) break
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

/** One static table of every page: no script, no external asset. */
export function renderHtml(report) {
  const rows = report.results.map((result) => {
    const snags = result.findings.filter((item) => item.severity !== 'info')
    return `<tr class="${snags.length ? 'snag' : ''}"><td><a href="${escapeHtml(result.url)}">${escapeHtml(new URL(result.url).pathname)}</a></td>`
      + `<td>${result.status}</td><td>${escapeHtml(result.title)}</td><td>${result.titleLength ?? ''}</td>`
      + `<td>${escapeHtml(result.description)}</td><td>${result.descriptionLength ?? ''}</td>`
      + `<td>${escapeHtml(result.canonical)}</td><td>${escapeHtml(result.robots)}</td>`
      + `<td>${escapeHtml(result.og?.title)}<br>${escapeHtml(result.og?.site_name)}</td><td>${escapeHtml(result.twitter?.title)}</td>`
      + `<td>${escapeHtml((result.brands ?? []).join(' + '))}<br><small>expected ${escapeHtml(result.expectedBrand)}</small></td>`
      + `<td>${result.inSitemap === null ? '' : result.inSitemap ? 'yes' : 'no'}</td>`
      + `<td>${escapeHtml(snags.map((item) => item.rule).join(', '))}</td></tr>`
  }).join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Head audit of ${escapeHtml(report.meta.base)}</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:1rem}table{border-collapse:collapse}td,th{border:1px solid #8886;padding:.2rem .4rem;vertical-align:top;max-width:28rem;overflow-wrap:anywhere}tr.snag td:last-child{color:#a00}th{position:sticky;top:0;background:Canvas}</style></head>
<body><h1>Head audit of ${escapeHtml(report.meta.base)}</h1><p>${report.results.length} pages, generated ${escapeHtml(report.meta.generatedAt)}.</p>
<table><thead><tr><th>Page</th><th>Status</th><th>Title</th><th>Len</th><th>Description</th><th>Len</th><th>Canonical</th><th>Robots</th><th>og:title / og:site_name</th><th>twitter:title</th><th>Icon set</th><th>In sitemap</th><th>Snags</th></tr></thead>
<tbody>
${rows}
</tbody></table></body></html>
`
}

/** Locales the audit knows, for reports that group by them. */
export const AUDITED_LOCALES = LOCALES
export { DEFAULT_LOCALE }
