import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFrontmatter } from '@astrojs/markdown-remark'
import { docsPath, type DocsPage } from '../src/lib/docs-paths'
import { docsEntryAvailable } from '../src/lib/page-port-links'
import { SOURCE_GUIDE_PORTS, sourceGuidesFor, stagedSectionsFor } from '../src/lib/port-documentation'

const root = fileURLToPath(new URL('../src/content/docs/', import.meta.url))

/** Every English page of the content tree with its frontmatter, read once and shared by every port's call. */
let corpus: DocsPage[] | undefined
function pages(): DocsPage[] {
  if (corpus) return corpus
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? (name === 'ja' && dir === root.replace(/\/$/, '') ? [] : files(full)) : full.endsWith('.md') ? [full] : []
  })
  return corpus = files(root).map((file) => ({
    id: file.slice(root.length).replace(/\.md$/, '').replace(/\/index$/, ''),
    data: parseFrontmatter(readFileSync(file, 'utf8'), { frontmatter: 'remove' }).frontmatter as DocsPage['data'],
  }))
}

/** Every public route of a port's docs: its content pages, the shared pages it shows, staged guides and the reference. */
export function routesOf(port: string): Set<string> {
  const routes = new Set<string>(['reference'])
  for (const entry of pages()) {
    if (entry.id === 'ja' || entry.id.startsWith('ja/') || !docsEntryAvailable(entry, port) || entry.data.product) continue
    routes.add(docsPath(entry))
    for (const alias of entry.data.aliases ?? []) routes.add(alias)
  }
  // Staging writes these at build time from the port's repository: each guide, and an overview per section
  // the port does not author itself (scripts/stage-port-docs.mjs, stagedSectionsFor).
  if (SOURCE_GUIDE_PORTS.includes(port)) {
    for (const guide of sourceGuidesFor(port)) for (const route of [guide.route, ...guide.aliases]) routes.add(route)
    for (const section of stagedSectionsFor(port)) routes.add(section)
  }
  return routes
}

/** The route a card of the Core page opens: its href is relative to `core/`. */
export const cardRoute = (href: string) => href.replace(/^\.\.\//, '').replace(/\/$/, '')

