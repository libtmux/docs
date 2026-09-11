/**
 * Where a page's Markdown twin lives, what it says, and which file the page
 * footer names as its source.
 *
 * Free of `astro:content` so the post-build conversion, which astro.config.ts
 * loads, applies the same rules as the routes that write twins from source.
 */
import type { ApiModel, ApiSymbol } from '@libtmux/api-model'
import { CONTRIBUTE_BRANCH, CONTRIBUTE_REPO } from '../i18n/contribute.ts'

/** The file a page is rendered from: a path in a repository, at a ref. */
export interface PageSource {
  repo: string
  path: string
  ref: string
}

/** The footer's raw source link. */
export function rawSourceUrl(source: PageSource): string {
  return `https://github.com/${source.repo}/raw/${source.ref}/${source.path}`
}

/** A generated API page's source: its declaration, else the extracted model. */
export function symbolSource(model: ApiModel, symbol: ApiSymbol): PageSource {
  const repo = symbol.source.repo ?? model.repo
  const ref = symbol.source.revision ?? model.revision
  return symbol.source.file && repo && ref
    ? { repo, path: symbol.source.file, ref }
    : { repo: CONTRIBUTE_REPO, path: `site/src/data/api/${model.port}.json`, ref: CONTRIBUTE_BRANCH }
}

/**
 * A page's Markdown twin: `<dir>/index.md` for an index page and `<page>.md`
 * otherwise. This is gp-sphinx's `docname + ".md"`, so `/topics/` pairs with
 * `/topics/index.md` and `/topics/panes/` with `/topics/panes.md`.
 *
 * The footer, the `<head>` alternate link, docs.json and every writer take
 * the path from here. gp-sphinx computed the link in one place and wrote the
 * file in another, and its generated pages linked twins that were never
 * written (notes/upstream/sphinx-gp-llms-md-twins.md).
 */
export function markdownPath(pathname: string, index: boolean): string {
  const page = pathname.replace(/\.html$/, '').replace(/\/index$/, '/')
  if (!page.endsWith('/')) return `${page}.md`
  return index ? `${page}index.md` : `${page.replace(/\/$/, '')}.md`
}

/** The `[...slug].md.ts` slug that writes the twin of the page at `slug`. */
export function markdownSlug(slug: string, index: boolean): string {
  return index ? (slug ? `${slug}/index` : 'index') : slug
}

/** Whether a content file is its directory's index, which moves its twin inside. */
export function isIndexSource(filePath: string | undefined): boolean {
  return /(^|\/)index\.mdx?$/.test(filePath ?? '')
}

/** One page as Markdown: an llms-full.txt section, and the page's own twin. */
export function markdownDocument(page: { title: string; url: string; description?: string; body: string }): string {
  const out = [`# ${page.title}`, '', `Source: ${page.url}`, '']
  if (page.description) out.push(`> ${page.description}`, '')
  out.push(page.body.trim(), '')
  return out.join('\n')
}
