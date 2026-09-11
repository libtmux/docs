import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AstroIntegration } from 'astro'
import { fromHtml } from 'hast-util-from-html'
import { toMdast } from 'hast-util-to-mdast'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'
import { markdownDocument } from '../lib/markdown-twins.ts'

/**
 * Write the Markdown twin of every page that no route writes one for.
 *
 * Prose and API pages get theirs from routes that resolve their source:
 * `[...slug].md.ts` and `reference/[...slug].md.ts`. The rest (the landing
 * page, port homes, parity, the MCP pages, search, translations, 404) are
 * assembled from components and data with no Markdown to resolve, so for them
 * the rendered page is the resolved content, and this converts its main
 * element.
 *
 * Each page names its twin in `<link rel="alternate" type="text/markdown">`
 * and says in `data-twin` who writes it. After converting, every twin a page
 * of this build names must exist, or the build fails. gp-sphinx lacked that
 * check, and its generated pages linked twins it never wrote.
 */
export function markdownTwins(): AstroIntegration {
  let base = '/'
  return {
    name: 'libtmux:markdown-twins',
    hooks: {
      'astro:config:done': ({ config }) => {
        base = config.base.endsWith('/') ? config.base : `${config.base}/`
      },
      'astro:build:done': ({ dir, logger }) => {
        const out = fileURLToPath(dir)
        const missing: string[] = []
        let converted = 0
        for (const page of (readdirSync(out, { recursive: true }) as string[]).filter((file) => file.endsWith('.html'))) {
          const html = readFileSync(join(out, page), 'utf8')
          const link = [...html.matchAll(/<link\b[^>]*>/g)].map((tag) => tag[0])
            .find((tag) => attribute(tag, 'rel') === 'alternate' && attribute(tag, 'type') === 'text/markdown')
          const href = link && attribute(link, 'href')
          const twin = link && attribute(link, 'data-twin')
          // Another build's tree: the assembled link check covers it.
          if (!href || twin === 'elsewhere' || !href.startsWith(base)) continue
          const target = join(out, decodeURIComponent(href.slice(base.length)))
          if (existsSync(target)) continue
          if (twin !== 'rendered') {
            missing.push(`${page} -> ${href}`)
            continue
          }
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, renderedMarkdown(html))
          converted++
        }
        if (missing.length > 0) {
          throw new Error(`${missing.length} pages link a Markdown twin no route wrote:\n${missing.slice(0, 20).join('\n')}`)
        }
        logger.info(`${converted} twins converted from rendered pages`)
      },
    },
  }
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`).exec(tag)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

interface Node {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: Node[]
}

/** Chrome that is not the page's content, and markup Markdown cannot carry. */
const DROP = new Set(['script', 'style', 'template', 'noscript', 'svg', 'button', 'nav', 'form', 'input', 'select', 'dialog'])

function find(node: Node, test: (element: Node) => boolean): Node | undefined {
  if (node.type === 'element' && test(node)) return node
  for (const child of node.children ?? []) {
    const found = find(child, test)
    if (found) return found
  }
  return undefined
}

function textOf(node: Node | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

/**
 * Trim a rendered page to what a reader of its Markdown needs: no chrome,
 * absolute links, and code fences that keep their language.
 */
function prune(node: Node, origin: string, drop?: Node): void {
  // A tab set shows one panel until someone clicks; keep the one it opens on.
  const opening = (node.children ?? []).find((child) => child.properties?.role === 'tabpanel' && child.properties?.dataDefault !== undefined)
  node.children = (node.children ?? []).filter((child) => {
    if (child === drop || child.type === 'comment') return false
    if (child.type !== 'element') return true
    const props = child.properties ?? {}
    if (DROP.has(child.tagName!) || props.hidden || props.ariaHidden === 'true' || props.dataPagefindIgnore !== undefined) return false
    if (props.role === 'dialog' || (opening && props.role === 'tabpanel' && child !== opening)) return false
    // A collapsible table of contents: without its `nav`, the summary says nothing.
    return !(child.tagName === 'details' && find(child, (element) => element.tagName === 'nav'))
  })
  for (const child of node.children) {
    if (child.type !== 'element') continue
    const props = child.properties ??= {}
    for (const key of ['href', 'src']) {
      if (typeof props[key] === 'string' && (props[key] as string).startsWith('/') && !(props[key] as string).startsWith('//')) props[key] = `${origin}${props[key]}`
    }
    // Shiki and the install widget put the language on the block, not on `code`.
    if (typeof props.dataLanguage === 'string') {
      const code = find(child, (element) => element.tagName === 'code')
      if (code && !code.properties?.className) (code.properties ??= {}).className = [`language-${props.dataLanguage}`]
    }
    prune(child, origin, drop)
  }
}

function renderedMarkdown(html: string): string {
  const tree = fromHtml(html) as unknown as Node
  const head = find(tree, (element) => element.tagName === 'head')
  const canonical = find(head ?? tree, (element) => element.tagName === 'link' && String(element.properties?.rel) === 'canonical')?.properties?.href as string | undefined
  const description = find(head ?? tree, (element) => element.tagName === 'meta' && element.properties?.name === 'description')?.properties?.content as string | undefined
  const url = canonical ?? ''
  const origin = url ? new URL(url).origin : ''
  // `main` first: the landing page's port cards are `article`s, and on a
  // DocsLayout page `main` holds nothing but the article.
  const main = find(tree, (element) => element.tagName === 'main')
    ?? find(tree, (element) => element.tagName === 'article')
    ?? find(tree, (element) => element.properties?.dataPagefindBody !== undefined)
    ?? find(tree, (element) => element.tagName === 'body')!
  const heading = find(main, (element) => element.tagName === 'h1')
  const title = textOf(heading).trim() || textOf(find(head ?? tree, (element) => element.tagName === 'title')).replace(/ \| libtmux$/, '').trim()
  // The title leads the document, so the page's own h1 would repeat it.
  prune(main, origin, heading)
  const body = toMarkdown(toMdast(main as never), { extensions: [gfmToMarkdown()] })
  return markdownDocument({ title, url, description, body })
}
