/** Collection identity stays distinct from a product page's public path. */
export interface DocsPage {
  id: string
  data: { port?: string; product?: string; route?: string; aliases?: readonly string[] }
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
  if (!entry.data.port || buildPort) return path
  const port = entry.data.port!
  return `${port}/${defaults[port] ?? 'latest'}/${path}`
}

export interface DocsRedirect {
  /** Legacy public path below the current build base. */
  path: string
  /** Canonical public path below the current build base. */
  target: string
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
