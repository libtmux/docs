import { globSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { afterAll, describe, expect, it } from 'vitest'
import { apiHostOf, collectApiDestinations } from '../../scripts/lib/api-destinations.mjs'
import { normalizeAddress } from '../../scripts/lib/api-markdown-links.mjs'
import { API_MODELS } from '../src/lib/api-models'
import { linkProseMarkdown } from '../src/lib/prose-markdown'
import { createProseLinker } from '../src/lib/prose-resolver'
import { DOC_PRODUCTS, PORTS, productConceptNotice, productDescription, workspaceOverviewNotice } from '../src/lib/ports'
import { productApiHref } from '../src/lib/product-api'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { defaultVersionFor } from '../src/lib/versions'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'
import { rehypeTmuxKeys } from '../src/plugins/rehype-tmux-keys'

/**
 * The link verifier reads the addresses the site links. These tests render the site, through the code that renders it, and hold the
 * verifier to what they find: every address on an API host that a page, a Markdown twin or a build for one port links is a
 * destination the collector reads. They are the proof that no render path is missing from the collector, whichever renderer it is.
 */
const root = new URL('../../', import.meta.url).pathname
const content = `${root}site/src/content/docs/`
const destinations = collectApiDestinations({ root })
const collected = (href: string) => destinations.has(normalizeAddress(href))
const PORTS = Object.keys(API_MODELS)

/** The front matter of a page, read as far as the linkers read it. */
function frontMatter(source: string) {
  const found = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source)
  const data: Record<string, any> = {}
  if (!found) return { data, body: source }
  let key: string | undefined
  for (const line of found[1].split(/\r?\n/)) {
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    const nested = /^\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    const unquote = (value: string) => value.replace(/^['"]|['"]$/g, '')
    if (top) { key = top[1]; data[key] = top[2] === '' ? {} : unquote(top[2]) }
    else if (nested && key && typeof data[key] === 'object') data[key][nested[1]] = unquote(nested[2])
  }
  return { data, body: source.slice(found[0].length) }
}

/** Every address on an API host that a tree of Markdown links, and where. */
function markdownAddresses(markdown: string): string[] {
  const found: string[] = []
  const walk = (node: any) => {
    if ((node.type === 'link' || node.type === 'definition') && apiHostOf(node.url)) found.push(node.url)
    if (node.type === 'html') for (const match of node.value.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) if (apiHostOf(match[1])) found.push(match[1])
    for (const child of node.children ?? []) walk(child)
  }
  walk(fromMarkdown(markdown))
  return found
}

describe('the Markdown copy of a symbol', () => {
  it('links nothing the collector does not read, and nothing the page leaves plain', () => {
    const missing = new Map<string, string>()
    let linked = 0
    for (const [port, model] of Object.entries(API_MODELS)) {
      const version = defaultVersionFor(port)
      for (const symbol of model.symbols) {
        const markdown = symbolMarkdown({ model, symbol, version, hrefFor: (entry) => productApiHref(model, entry, version) })
        for (const href of markdownAddresses(markdown)) {
          linked += 1
          if (!collected(href) && !missing.has(href)) missing.set(href, `${port}:${symbol.id}`)
        }
      }
    }
    expect([...missing].map(([href, where]) => `${href} (${where})`)).toEqual([])
    expect(linked).toBeGreaterThan(0)
  }, 900_000)

  it('does not send the TypeScript toString methods\' printed [object Object] to MDN', () => {
    const model = API_MODELS.ts
    const version = defaultVersionFor('ts')
    for (const id of ['client.Client.toString', 'pane.Pane.toString', 'server.Server.toString', 'session.Session.toString', 'window.Window.toString']) {
      const symbol = model.symbols.find((entry) => entry.id === id)!
      const markdown = symbolMarkdown({ model, symbol, version, hrefFor: (entry) => productApiHref(model, entry, version) })
      expect(markdown, id).toContain('[object Object]')
      expect(markdownAddresses(markdown).filter((href) => /Global_Objects\/Object$/.test(href)), id).toEqual([])
    }
  })
})

describe('the pages, rendered for each port', () => {
  const files = globSync('**/*.{md,mdx}', { cwd: content }).sort().filter((file) => !file.startsWith('meta/') && !file.startsWith('_'))
  const pages = files.map((file) => {
    const source = readFileSync(content + file, 'utf8')
    const { data, body } = frontMatter(source)
    const shared = !data.port && !/^(?:ja\/)?ports\//.test(file)
    return { file, source, data, body, shared }
  })
  const previousPort = process.env.LIBTMUX_DOCS_PORT
  afterAll(() => { if (previousPort === undefined) delete process.env.LIBTMUX_DOCS_PORT; else process.env.LIBTMUX_DOCS_PORT = previousPort })

  /** A page that belongs to no port is read in the build of each port, and in the one build that is for none. */
  const builds = (page: { shared: boolean }) => (page.shared ? ['', ...PORTS] : [''])

  it('link no address the collector does not read, in any build', async () => {
    const processor = await createMarkdownProcessor({ gfm: true, rehypePlugins: [rehypeTmuxKeys as never, rehypeApiLinks as never] } as never)
    const missing = new Map<string, string>()
    let linked = 0
    let renders = 0
    for (const page of pages) {
      for (const build of builds(page)) {
        if (build) process.env.LIBTMUX_DOCS_PORT = build; else delete process.env.LIBTMUX_DOCS_PORT
        const { code } = await processor.render(page.body, { fileURL: pathToFileURL(content + page.file), frontmatter: page.data } as never)
        renders += 1
        for (const match of code.matchAll(/<a\b[^>]*?href="([^"]+)"/g)) {
          const href = match[1].replace(/&amp;/g, '&')
          if (!apiHostOf(href)) continue
          linked += 1
          if (!collected(href) && !missing.has(href)) missing.set(href, `${page.file} in the ${build || 'unported'} build`)
        }
      }
    }
    expect([...missing].map(([href, where]) => `${href} (${where})`)).toEqual([])
    expect(renders).toBeGreaterThan(pages.length)
    expect(linked).toBeGreaterThan(0)
  }, 900_000)

  it('link a bare word to the standard library only where the page says its language: a shell\'s exit is not Python\'s, nor coreutils\' timeout Elixir\'s', async () => {
    const processor = await createMarkdownProcessor({ gfm: true, rehypePlugins: [rehypeTmuxKeys as never, rehypeApiLinks as never] } as never)
    const shared = pages.filter((page) => page.shared)
    const wrong: string[] = []
    for (const page of shared) {
      for (const build of PORTS) {
        process.env.LIBTMUX_DOCS_PORT = build
        const { code } = await processor.render(page.body, { fileURL: pathToFileURL(content + page.file), frontmatter: page.data } as never)
        for (const match of code.matchAll(/<a\b[^>]*?href="([^"]+)"[^>]*class="api-mention[^"]*"/g)) if (apiHostOf(match[1])) wrong.push(`${page.file} (${build}): ${match[1]}`)
        for (const match of code.matchAll(/<a\b[^>]*?class="api-mention[^"]*"[^>]*href="([^"]+)"/g)) if (apiHostOf(match[1])) wrong.push(`${page.file} (${build}): ${match[1]}`)
      }
    }
    expect(wrong).toEqual([])
    expect(shared.length).toBeGreaterThan(0)
  }, 900_000)

  it('link no address in the Markdown copy of a page that the collector does not read', () => {
    const missing = new Map<string, string>()
    let linked = 0
    for (const page of pages) {
      const entryPort = page.data.port || /^(?:ja\/)?ports\/([^/]+)\//.exec(page.file)?.[1]
      for (const build of builds(page)) {
        const markdown = linkProseMarkdown(page.body, entryPort ?? (build || undefined), page.data.product, {
          page: { id: page.file.replace(/\.mdx?$/, ''), data: { ...page.data, port: entryPort } }, portSaid: Boolean(entryPort),
        })
        for (const href of markdownAddresses(markdown)) {
          linked += 1
          if (!collected(href) && !missing.has(href)) missing.set(href, `${page.file} in the ${build || 'unported'} build`)
        }
      }
    }
    expect([...missing].map(([href, where]) => `${href} (${where})`)).toEqual([])
    expect(linked).toBeGreaterThan(0)
  }, 900_000)
})

describe('the notices a template writes', () => {
  it('link no address the collector does not read: the prose a product notice carries is linked as the page linker links it', () => {
    const link = createProseLinker()
    const missing: string[] = []
    let spans = 0
    for (const port of PORTS) {
      for (const product of Object.keys(DOC_PRODUCTS) as (keyof typeof DOC_PRODUCTS)[]) {
        const texts = [productConceptNotice(port, product)?.body, workspaceOverviewNotice(port)?.body, (() => { try { return productDescription(port, product) } catch { return undefined } })()]
        for (const text of texts) {
          for (const code of (text ?? '').matchAll(/`([^`]+)`/g)) {
            spans += 1
            const decision = link(code[1], { pagePort: port.slug })
            if (decision.kind === 'link' && apiHostOf(decision.href) && !collected(decision.href)) missing.push(`${decision.href} (${port.slug} ${product})`)
          }
        }
      }
    }
    expect(missing).toEqual([])
    expect(spans).toBeGreaterThan(0)
  })
})
