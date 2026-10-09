/** Collection identity stays distinct from a product page's public path. */
import { PORT_BY_SLUG, productAvailable } from './ports.ts'
import { SOURCE_GUIDE_PORTS, sourceGuideRedirectsFor } from './port-documentation.ts'

/** Shared tmux prose has one public home, outside the language libraries. */
export function tmuxProsePath(path: string): string {
  return /^(guides|topics|concepts|examples)(?:\/|$)/.test(path) ? `tmux/${path}` : path
}

/** Task links stay in the reader's port and version; explicit port links stay explicit. */
export function proseHref(href: string, root: string, port?: string, version = 'latest', portRoot = root): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href
  const product = /^\/(mcp|workspace)(?:\/|[?#]|$)/.exec(href)?.[1] as 'mcp' | 'workspace' | undefined
  if (product && port && PORT_BY_SLUG[port] && productAvailable(PORT_BY_SLUG[port], product)) {
    return `${portRoot.replace(/\/+$/, '')}/${port}/${version}${href}`
  }
  const section = /^\/(concepts|guides|topics|examples)(?:\/|[?#]|$)/.exec(href)?.[1]
  const local = port && section && (!PORT_BY_SLUG[port]?.parentLibrary || section === 'concepts')
  return `${root.replace(/\/+$/, '')}${local ? `/${port}/${version}` : section ? '/tmux' : ''}${href}`
}

export interface DocsPage {
  id: string
  data: { port?: string; supportedPorts?: readonly string[]; product?: string; route?: string; aliases?: readonly string[] }
}

/** Path below a port/version root, or the unchanged shared document id. */
export function docsPath(entry: DocsPage): string {
  if (entry.data.route) {
    if (entry.data.route.startsWith('/') || entry.data.route.includes('..')) {
      throw new Error(`Invalid staged document route: ${entry.data.route}`)
    }
    return entry.data.route.replace(/^\/+|\/+$/g, '')
  }
  if (!entry.data.product) return entry.id
  const prefix = `ports/${entry.data.port}/`
  if (!entry.id.startsWith(prefix)) throw new Error(`Invalid product document id: ${entry.id}`)
  return entry.id.slice(prefix.length)
}

/** Root builds expose product pages at the same URLs as assembled port builds. */
export function docsRoutePath(
  entry: DocsPage,
  buildPort?: string,
  defaults: Record<string, string> = {},
): string {
  const path = docsPath(entry)
  if (buildPort) return path
  if (!entry.data.port) return tmuxProsePath(path)
  const port = entry.data.port!
  return `${port}/${defaults[port] ?? 'latest'}/${path}`
}

export interface DocsRedirect {
  /** Legacy public path below the current build base. */
  path: string
  /** Canonical public path below the current build base. */
  target: string
}

/** Preserve incoming links to retired reference summaries without a second API page. */
export function sourceGuideRedirects(buildPort?: string, defaults: Record<string, string> = {}): DocsRedirect[] {
  return (buildPort ? [buildPort] : SOURCE_GUIDE_PORTS).flatMap((port) =>
    sourceGuideRedirectsFor(port).map(({ path, target }) => {
      const project = (route: string) => docsRoutePath({ id: route, data: { port, route } }, buildPort, defaults)
      return { path: project(path), target: project(target) }
    }))
}

/**
 * Project source-guide aliases through the same port/version URL calculation
 * as their canonical entries. Callers render the returned paths as redirect
 * routes; canonical collections never contain aliases themselves.
 */
export function docsRedirects(
  entries: readonly DocsPage[],
  buildPort?: string,
  defaults: Record<string, string> = {},
  reserved: readonly string[] = [],
): DocsRedirect[] {
  const canonical = new Set(entries.map((entry) => docsRoutePath(entry, buildPort, defaults)))
  const claimed = new Set([...canonical, ...reserved])
  const redirects: DocsRedirect[] = []
  for (const entry of entries) {
    const target = docsRoutePath(entry, buildPort, defaults)
    for (const alias of entry.data.aliases ?? []) {
      const path = docsRoutePath({ ...entry, data: { ...entry.data, route: alias } }, buildPort, defaults)
      if (path === target) throw new Error(`Invalid document alias repeats canonical route: ${path}`)
      if (canonical.has(path)) throw new Error(`Document alias collides with canonical route: ${path}`)
      if (claimed.has(path)) throw new Error(`Document alias collides with reserved route or another alias: ${path}`)
      claimed.add(path)
      redirects.push({ path, target })
    }
  }
  return redirects
}

/** Preserve published workspace URLs without aliasing Python's CLI pages. */
export function workspaceRedirects(paths: string[]): { path: string; target: string }[] {
  const published = new Set(paths)
  return paths.flatMap((target) => {
    const path = target.replace(/(^|\/)workspace\/internals\/(topics|guides|examples)(\/|$)/, '$1workspace/$2$3')
    return path !== target && !published.has(path) ? [{ path, target }] : []
  })
}

/** Old section roots redirect; nested user references have their own content. */
export function workspaceRedirectPath(path: string, publishedPaths: ReadonlySet<string>): boolean {
  const normalized = path.replace(/\/$/, '')
  return !publishedPaths.has(normalized)
    && (/^workspace\/api(?:\/|$)/.test(normalized) || /^workspace\/(?:topics|guides|examples)$/.test(normalized))
}
