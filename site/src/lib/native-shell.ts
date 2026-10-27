import { readFileSync } from 'node:fs'
import type { Locale } from '../i18n/locales'
import type { PageSource } from './markdown-twins'
import type { ApiTreeJson } from './api-search'
import type { SidebarNode } from './api-sidebar'

export interface NativePageContext {
  file: string
  /** Path below this native artifact's /api/ mount. */
  path: string
  url: string
  /** Page path below the locale root, for the shared locale control. */
  sourcePath: string
  source?: PageSource & { sha256: string }
  markdownHref?: string
  markdownSha256?: string
  htmlSha256: string
  articleSha256: string
  hasTableOfContents: boolean
  signatures: string[]
  title?: string
  declarations?: { id: string; name: string; kind: string; parent?: string }[]
}

/** One row of the Sphinx global toctree, on the artifact's published URLs. */
export interface NativeNavigationItem {
  /** Plain text of the title. */
  title: string
  /** The title with inline literals as `<code>`, when it has any. Text is escaped. */
  html?: string
  /** Absent on a caption, which only names the group below it. */
  url?: string
  external?: boolean
  caption?: boolean
  children: NativeNavigationItem[]
}

const trees = new WeakMap<NativeShellContext, ApiTreeJson>()

/** Keep native pages and declaration ownership on the artifact's own URLs. */
export function nativeReferenceTree(context: NativeShellContext): ApiTreeJson {
  const cached = trees.get(context)
  if (cached) return cached
  const members: ApiTreeJson['members'] = {}
  const hrefs: Record<string, string> = {}
  const types = context.pages.map((page) => {
    const id = `page:${page.path}`
    hrefs[id] = page.url
    const declarations = page.declarations ?? []
    const ids = new Set(declarations.map((entry) => entry.id))
    for (const entry of declarations) {
      const declarationId = `${page.path}#${entry.id}`
      hrefs[declarationId] = `${page.url}#${encodeURIComponent(entry.id)}`
      const parent = entry.parent && ids.has(entry.parent) ? `${page.path}#${entry.parent}` : id
      ;(members[parent] ??= []).push([entry.name, '', declarationId, entry.kind,
        ['class', 'exception', 'module'].includes(entry.kind) || declarations.some((child) => child.parent === entry.id) ? 'types' : 'members', '', entry.id])
    }
    // `id` is a key, never a label: results show the title and the page path.
    return { id, name: page.title || page.path || 'Overview', qualifiedName: page.path.replace(/\/$/, '') || 'index', slug: page.path, kind: 'section', category: 'pages', m: declarations.length ? 1 as const : 0 as const }
  })
  const json = { port: context.port, ownerLabel: 'item', ownerPlural: 'items', buckets: [{ id: 'native', label: 'Reference', count: types.length, slug: null, types, children: [] }], members, hrefs }
  trees.set(context, json)
  return json
}

const samePage = (url: string, current: string) => url.split('#')[0].replace(/\/?$/, '/') === current.replace(/\/?$/, '/')

/**
 * The toctree as sidebar rows: a caption is a heading with its entries as
 * sibling rows, a branch holds its children, and the branch on the way to
 * `currentUrl` is open. A row is never labelled with an id.
 */
export function nativeToctreeNodes(toctree: NativeShellContext['toctree'], currentUrl: string): SidebarNode[] {
  let seq = 0
  const build = (items: NativeNavigationItem[], level: number): SidebarNode[] => items.flatMap((item): SidebarNode[] => {
    if (item.caption) return [{ id: `toc-caption-${++seq}`, label: item.title, heading: true, level }, ...build(item.children, level)]
    const id = `toc-${++seq}`
    const base = { id, label: item.title, ...(item.html ? { labelHtml: item.html } : {}), ...(item.url ? { href: item.url } : {}),
      ...(item.external ? { external: true } : {}), level, current: Boolean(item.url && !item.external && samePage(item.url, currentUrl) && !item.url.includes('#')) }
    if (!item.children.length) return [base]
    const children = build(item.children, level + 1)
    const open = base.current || children.some(function contains(node): boolean { return Boolean(node.current || node.children?.some(contains)) })
    return [{ ...base, expanded: open, lazy: `toc:${item.url ?? item.title}`, children }]
  })
  return build(toctree, 1)
}

export interface NativeShellContext {
  schema: 1
  port: string
  version: string
  locale: Locale
  root: string
  base: string
  source: { repository: string; sha: string }
  artifactSha256: string
  pages: NativePageContext[]
  /** The Sphinx global toctree, the same on every page of the artifact. */
  toctree: NativeNavigationItem[]
  redirects: string[]
}

/** A build exports native chrome only for the artifact collected before it. */
export function nativeShellContext(): NativeShellContext | undefined {
  const file = process.env.LIBTMUX_DOCS_NATIVE_CONTEXT
  if (!file) return undefined
  const context: NativeShellContext = JSON.parse(readFileSync(file, 'utf8'))
  if (context.schema !== 1 || context.port !== process.env.LIBTMUX_DOCS_PORT ||
      context.version !== process.env.LIBTMUX_DOCS_VERSION || context.base !== `${process.env.LIBTMUX_DOCS_BASE}api/`) {
    throw new Error('Native context does not match the Astro build identity')
  }
  return context
}
