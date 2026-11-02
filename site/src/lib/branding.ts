/** Shared artwork and metadata for Astro and native documentation. */
import palettes from './brand-palettes.json' with { type: 'json' }
import { DOC_PRODUCTS, pageBrand, PORT_BY_SLUG, PORTS, portHomeTitle, type DocProduct } from './ports.ts'

export { palettes }
export const PYTHON_DESCRIPTION = 'Typed scripting library / ORM / API wrapper for tmux'
export const PYTHON_SAME_AS = [
  'https://libtmux.git-pull.com/',
  'https://github.com/tmux-python/libtmux',
  'https://pypi.org/project/libtmux/',
]

export const TMUX_DESCRIPTION = 'Terminal multiplexer: sessions, windows and panes controlled from the terminal.'
export const TMUX_WEBSITE = 'https://github.com/tmux/tmux/wiki'

export function branding(portSlug?: string, pagePath = '', root = '') {
  const { language, variant } = pageBrand(portSlug, pagePath)
  const palette = palettes[language as keyof typeof palettes]
  if (!palette) throw new Error(`Missing logo palette: ${language}`)
  const base = `${root.replace(/\/+$/, '')}/brand/${language}/${variant}`
  const port = PORTS.find((candidate) => candidate.logoLanguage === language)
  const projectName = port?.projectName ?? 'libtmux'
  const label = `${projectName} · ${palette.name}${variant === 'library' ? '' : variant === 'mcp' ? ' MCP' : ' workspace CLI'}`
  return { language, variant, palette, port, projectName, label, asset: (filename: string) => `${base}/${filename}` }
}

/** A page's heading as plain text: its title and, when it has one, its subtitle ("tmux workspace manager, forged in Rust."). */
export function headingTitle(data: { title: string; subtitle?: string }): string {
  return data.subtitle ? `${data.title} ${data.subtitle}` : data.title
}

/** The site every page belongs to: the tail of a title and `og:site_name` on every page. */
export const SITE_NAME = 'libtmux.org'

/**
 * Characters a `<title>` should stay within.
 *
 * Google states no limit: a title link is "truncated in Google Search results
 * as needed, typically to fit the device width"
 * (https://developers.google.com/search/docs/appearance/title-link, read
 * 2026-11-01). A tab strip shows far less than a result does. 60 characters is
 * the working budget that keeps the page's name, language and kind in view
 * where it truncates, and the page's name leads so truncation costs the least.
 */
export const TITLE_BUDGET = 60

/**
 * Characters a meta description should stay within.
 *
 * Google states no limit and truncates a snippet "as needed, typically to fit
 * the device width" (https://developers.google.com/search/docs/appearance/snippet,
 * read 2026-11-01). 160 characters is the working budget, enough for the task
 * and the section a page belongs to.
 */
export const DESCRIPTION_BUDGET = 160

/** The kind of page a documentation section holds, as it reads after a language: "Rust guide". */
const SECTION_KIND: Readonly<Record<string, string>> = {
  guides: 'guide', topics: 'topic', concepts: 'concept', examples: 'example',
  reference: 'API reference', api: 'API reference', internals: 'internals',
  project: 'project', history: 'changelog', 'source-guide': 'guide',
}

/** Kinds that only one product has, keyed by product then section. */
const PRODUCT_KIND: Readonly<Record<DocProduct, Readonly<Record<string, string>>>> = {
  mcp: { tools: 'tool', resources: 'resource', prompts: 'prompt' },
  workspace: { cli: 'CLI', configuration: 'configuration' },
}

const TMUX_KIND: Readonly<Record<string, string>> = { manual: 'manual', reference: 'C source', catalog: 'catalog' }
const TMUX_CATALOG_KIND: Readonly<Record<string, string>> = { formats: 'format', hooks: 'hook', options: 'option' }

/** Words that name a page's scope, lower-cased and de-pluralised so "Tools" restates "tool". */
function titleWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? []).map((word) => word.length > 3 ? word.replace(/s$/, '') : word))
}

export interface TitleSubject {
  /** The page's own name, as its heading or `shortTitle` gives it. */
  title: string
  /** The page's path inside its port and version, or `tmux/...` for the tmux section. */
  pagePath: string
  /** The port the page documents or is branded for. Absent on shared site pages. */
  portSlug?: string
  /** The version this build documents. A non-default version is named, so its tab differs from the canonical one. */
  version?: string
  defaultVersion?: string
}

export interface DocumentTitle {
  /** The `<title>`: page, context, then `libtmux.org`, within the budget. */
  title: string
  /** The `og:title` and `twitter:title`: the same without the site name, which `og:site_name` already shows. */
  social: string
  /** Language, product and kind, or empty when the page's own name already says them. */
  context: string
}

/** Strip every site or project suffix a generator may already have added. */
export function stripSiteSuffix(title: string): string {
  const names = [SITE_NAME, 'libtmux', ...PORTS.map((port) => port.projectName)]
  let page = title.trim()
  for (let again = true; again;) {
    again = false
    for (const name of names) {
      const suffix = ` | ${name}`
      if (page.endsWith(suffix) && page.length > suffix.length) { page = page.slice(0, -suffix.length); again = true }
    }
  }
  return page.replace(/ [-–—] libtmux(?:-[a-z]+)?(?: v?\d[\w.+-]*)? documentation$/, '')
}

/**
 * What a page is, after its name: the language, the product when it is not the
 * core library, and the kind of page ("TypeScript MCP resource", "Rust guide",
 * "tmux manual"). Empty when the name already says all of it.
 */
function titleContext({ title, pagePath, portSlug, version, defaultVersion }: TitleSubject, compact = false): string {
  const parts = pagePath.split('/').filter(Boolean)
  let scope: string
  let kind = ''
  let named = ''
  let section: string | undefined
  let rest: string[]
  if (!portSlug) {
    if (parts[0] !== 'tmux') return ''
    scope = 'tmux'
    const tmuxVersion = /^(?:latest|\d+\.\d+[a-z]*)$/.test(parts[1] ?? '') ? parts[1] : undefined
    ;[section, ...rest] = parts.slice(tmuxVersion ? 2 : 1)
    kind = section === 'catalog' && rest[0] ? TMUX_CATALOG_KIND[rest[0]] ?? 'catalog' : TMUX_KIND[section ?? ''] ?? SECTION_KIND[section ?? ''] ?? ''
    // A C declaration's page names its kind in its slug (`c-function-args_parse`), and a function
    // and a struct of one name are different pages.
    const declaration = section === 'reference' ? /^c-(function|struct|enum|define|variable|typedef|union)-/.exec(rest[0] ?? '')?.[1] : undefined
    if (declaration) kind = `C ${declaration}`
    if (tmuxVersion && tmuxVersion !== 'latest') named = tmuxVersion
  } else {
    const { variant, port } = branding(portSlug, pagePath)
    const product = variant === 'library' ? undefined : (variant as DocProduct)
    ;[section, ...rest] = parts.slice(product && parts[0] === product ? 1 : 0)
    scope = [port?.language ?? PORT_BY_SLUG[portSlug]?.language, product && DOC_PRODUCTS[product].tabLabel].filter(Boolean).join(' ')
    // A language's, a product's and the core library's home page state their scope in their name.
    if (section && section !== 'core') kind = (product && PRODUCT_KIND[product][section]) || SECTION_KIND[section] || 'docs'
    if (version && version !== 'latest' && version !== defaultVersion) named = version
  }
  // A section's index page is named for the section ("Guides"): say what it indexes.
  if (kind && !rest.length) {
    const own = titleWords(kind)
    if ([...titleWords(title)].every((word) => own.has(word))) kind = 'docs'
  }
  if (compact && kind === 'API reference') kind = 'API'
  const full = [scope, kind].filter(Boolean).join(' ')
  const have = titleWords(title)
  const said = [...titleWords(full)].every((word) => have.has(word))
  return [said ? (named ? scope : '') : full, named && `(${named})`].filter(Boolean).join(' ')
}

/**
 * The document title for a page: most specific first, then what it is, then the site.
 *
 * `capabilities | TypeScript MCP resource | libtmux.org`. The page's name leads
 * so a narrow tab still tells pages apart; the context follows so a wide tab,
 * a bookmark or a search result says which language, product and kind of page
 * it is. A title that would pass `TITLE_BUDGET` gives up, in order, the site
 * name and then the word "reference" in "API reference"; a name too long for
 * any of those keeps its full context. A language home (`libtmux-rs: Rust-based
 * tmux client`) is its own scope and carries no context or site name.
 */
export function documentationTitle(subject: TitleSubject): DocumentTitle {
  const page = stripSiteSuffix(subject.title) || SITE_NAME
  const home = (!subject.pagePath && !subject.portSlug) || PORTS.some((port) => portHomeTitle(port) === page)
  if (home) return { title: page, social: page, context: '' }
  const named = { ...subject, title: page }
  const context = titleContext(named)
  const join = (text: string) => [page, text].filter(Boolean).join(' | ')
  const fits = (candidate: string) => candidate.length <= TITLE_BUDGET
  const social = join(context)
  if (fits(`${social} | ${SITE_NAME}`)) return { title: `${social} | ${SITE_NAME}`, social, context }
  const compact = titleContext(named, true)
  const shortened = [social, join(compact)].find(fits) ?? social
  return { title: shortened, social: shortened, context: shortened === social ? context : compact }
}

/** JSON-LD is data inside an HTML script element; never allow a closing tag. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * A symbol page's description: its qualified name, then what its own
 * documentation says, within `DESCRIPTION_BUDGET`.
 *
 * Many members share one summary ("The pane that was read."), and a page
 * without one would otherwise read "<name> API documentation." The name is what
 * tells their results apart.
 */
export function symbolDescription(name: string, summary: string | undefined, fallback: string): string {
  const text = summary?.replace(/\s+/g, ' ').trim()
  const lead = text ? (text.toLowerCase().startsWith(name.toLowerCase()) ? text : `${name}: ${text}`) : `${name}: ${fallback}.`
  return lead.length <= DESCRIPTION_BUDGET ? lead : `${lead.slice(0, DESCRIPTION_BUDGET - 1).replace(/\s+\S*$/, '')}…`
}
