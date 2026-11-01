import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFrontmatter } from '@astrojs/markdown-remark'
import { docsPath, type DocsPage } from '../src/lib/docs-paths'
import { docsEntryAvailable } from '../src/lib/page-port-links'
import { SOURCE_GUIDE_PORTS, sourceGuidesFor } from '../src/lib/port-documentation'

/** Every public route of a port's docs: its content pages, the shared pages it shows, staged guides and the reference. */
export function routesOf(port: string): Set<string> {
  const root = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? (name === 'ja' && dir === root.replace(/\/$/, '') ? [] : files(full)) : full.endsWith('.md') ? [full] : []
  })
  const routes = new Set<string>(['reference'])
  for (const file of files(root)) {
    const id = file.slice(root.length).replace(/\.md$/, '').replace(/\/index$/, '')
    const { frontmatter } = parseFrontmatter(readFileSync(file, 'utf8'), { frontmatter: 'remove' })
    const entry: DocsPage = { id, data: frontmatter as DocsPage['data'] }
    if (id === 'ja' || id.startsWith('ja/') || !docsEntryAvailable(entry, port) || entry.data.product) continue
    routes.add(docsPath(entry))
    for (const alias of entry.data.aliases ?? []) routes.add(alias)
  }
  if (SOURCE_GUIDE_PORTS.includes(port)) for (const guide of sourceGuidesFor(port)) for (const route of [guide.route, ...guide.aliases]) routes.add(route)
  return routes
}

/** The route a card of the Core page opens: its href is relative to `core/`. */
export const cardRoute = (href: string) => href.replace(/^\.\.\//, '').replace(/\/$/, '')

