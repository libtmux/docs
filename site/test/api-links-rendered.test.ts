import { afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import type { CollectionEntry } from 'astro:content'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { BUILTINS, PORT_NAME, proseTexts } from '@libtmux/api-model'
import { apiHostOf, collectApiDestinations, proseRuns, proseSources, typeInputs } from '../../scripts/lib/api-destinations.mjs'
import { languageOfUrl, languageProblem } from '../../scripts/lib/api-links.mjs'
import { normalizeAddress } from '../../scripts/lib/api-markdown-links.mjs'
import { API_MODELS } from '../src/lib/api-models'
import { apiEntryFields } from '../src/lib/api-sections'
import { llmsPage } from '../src/lib/llms'
import { createProseLinker } from '../src/lib/prose-resolver'
import { DOC_PRODUCTS, PORTS as SITE_PORTS, productConceptNotice, productDescription, workspaceOverviewNotice } from '../src/lib/ports'
import { renderToolDescription } from '../src/lib/mcp-reference'
import { productApiHref, productApiIndex } from '../src/lib/product-api'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { defaultVersionFor } from '../src/lib/versions'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'
import { rehypeTmuxKeys } from '../src/plugins/rehype-tmux-keys'
import { apiComponents } from './api-components'
import { MCP_PORTS, descriptionSources } from './mcp-description-audit'

/**
 * The link verifier reads the addresses the site links. These tests render the site, through the code that renders it, and hold the
 * verifier to what they find: every address on an API host that a page, a Markdown twin or a build for one port links is a
 * destination the collector reads. They are the proof that no render path is missing from the collector, whichever renderer it is.
 */
const root = new URL('../../', import.meta.url).pathname
const destinations = collectApiDestinations({ root })
const collected = (href: string) => destinations.has(normalizeAddress(href))
const PORTS = Object.keys(API_MODELS)

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

/** The text of the block an anchor stands in, up to the anchor: the words the page linker reads as the sentence before it. */
function textBefore(html: string, at: number): string {
  const block = html.slice(0, at).split(/<\/?(?:p|li|td|th|h[1-6]|tr|ul|ol|blockquote|pre|div|table|section)\b[^>]*>/i).pop() ?? ''
  return block.replace(/<[^>]+>/g, '').replace(/&#x3C;|&lt;/g, '<').replace(/&#x26;|&amp;/g, '&').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
}

/** The words an anchor wraps. */
function anchorText(html: string, at: number): string {
  const end = html.indexOf('</a>', at)
  return html.slice(html.indexOf('>', at) + 1, end).replace(/<[^>]+>/g, '').replace(/&#x3C;|&lt;/g, '<').replace(/&#x26;|&amp;/g, '&').trim()
}

/** The same, in Markdown: the paragraph, or the row of a table, the link is in. */
function markdownBefore(markdown: string, at: number): string {
  const block = markdown.slice(0, at).split(/\n\s*\n/).pop() ?? ''
  const row = block.split('\n').pop() ?? ''
  return row.startsWith('|') ? row : block
}

/**
 * The languages a sentence names, read here and not by the code under test: a word that is one language's name and nothing
 * more. `JavaScript` is not `Java`, `algorithm` is not `Go`, and a path, a dotted name or a file with an anchor names no language.
 */
function languagesNamed(text: string): string[] {
  const sentence = text.split(/(?<=[.!?])\s+(?=[A-Z])/).pop() ?? text
  const found: string[] = []
  for (const token of sentence.split(/\s+/)) {
    const word = token.replace(/^[^\w#+]+|[^\w#+]+$/g, '').replace(/['\u2019]s$/, '')
    for (const [slug, name] of Object.entries(PORT_NAME)) {
      if (name === 'Go' ? word === 'Go' : word.toLowerCase() === name.toLowerCase()) found.push(slug)
    }
  }
  return found
}

/**
 * Why a name linked on a page is not the link the page should have, or undefined when it is. A page reads as its own language, and
 * a sentence may name another: a link into a language neither of them names is wrong. And a port's own curated entry for a name
 * is the one it links: on a Kotlin or Scala page `Vector` is its own collection and `Flow` is not the JDK's, so a Java link for a
 * name the port curates is wrong unless the sentence is about Java.
 */
function linkProblem(href: string, text: string, pagePort: string | undefined, before: string): string | undefined {
  const named = languagesNamed(before)
  const allowed = [pagePort, ...named].filter((port): port is string => Boolean(port))
  if (allowed.length && !allowed.some((port) => !languageProblem(port, href))) return `reaches ${languageOfUrl(href)} documentation from a page and sentence that name ${allowed.join(', ')}`
  const curated = pagePort ? BUILTINS[pagePort]?.[text] : undefined
  if (curated && curated !== href && !named.length) return `is ${href}, where ${pagePort} curates ${curated} for ${text}`
  return undefined
}

describe('the pages, rendered for each port', () => {
  // Every page the site builds: the content tree, the guides staged from each port's artifact, and the shared workspace pages
  // resolved for each port. The collector reads the same list, so what is rendered here and what it reads cannot differ.
  const pages = proseSources({ root }).map((page) => ({
    ...page, shared: !page.data.port && !/^(?:ja\/)?ports\//.test(page.file),
    entry: { id: page.id, body: page.body, data: page.data } as unknown as CollectionEntry<'docs'>,
  }))
  const previousPort = process.env.LIBTMUX_DOCS_PORT
  afterAll(() => { if (previousPort === undefined) delete process.env.LIBTMUX_DOCS_PORT; else process.env.LIBTMUX_DOCS_PORT = previousPort })

  /** A page that belongs to no port is read in the build of each port, and in the one build that is for none. */
  const builds = (page: { shared: boolean }) => (page.shared ? ['', ...PORTS] : [''])
  const inBuild = (build: string) => { if (build) process.env.LIBTMUX_DOCS_PORT = build; else delete process.env.LIBTMUX_DOCS_PORT }
  const where = (page: { file: string }, build: string) => `${page.file} in the ${build || 'unported'} build`

  let processor: Awaited<ReturnType<typeof createMarkdownProcessor>> | undefined
  const html = new Map<string, string>()
  /** A page, rendered through the plugins the site renders it with, once for each build that reads it. */
  async function render(page: (typeof pages)[number], build: string): Promise<string> {
    const key = `${build}\0${page.file}`
    let code = html.get(key)
    if (code === undefined) {
      processor ??= await createMarkdownProcessor({ gfm: true, rehypePlugins: [rehypeTmuxKeys as never, rehypeApiLinks as never] } as never)
      inBuild(build)
      code = (await processor.render(page.body, { fileURL: pathToFileURL(root + page.path), frontmatter: page.data } as never)).code
      html.set(key, code)
    }
    return code
  }
  /** The Markdown copy of a page, as `llms-full.txt` and the page's `.md` twin carry it. */
  function twin(page: (typeof pages)[number], build: string): string {
    inBuild(build)
    return llmsPage(page.entry, 'https://libtmux.org', '/en/').body
  }

  it('include the staged guides and the shared workspace pages: a page the oracle does not render is one it cannot hold', () => {
    const staged = pages.filter((page) => page.file.startsWith('_staged/'))
    const workspace = pages.filter((page) => page.file.startsWith('_workspace-shared/'))
    expect(staged.length).toBeGreaterThan(50)
    expect(workspace.length).toBeGreaterThan(100)
    expect(new Set(staged.map((page) => page.data.port)).size).toBeGreaterThan(5)
    // Every staged guide names its route, and every shared page the port it was resolved for.
    expect(staged.filter((page) => !page.data.route)).toEqual([])
    expect(workspace.filter((page) => page.data.product !== 'workspace' || !PORTS.includes(page.data.port))).toEqual([])
    // Each page is once: two pages with one id would be one the site builds once.
    expect(new Set(pages.map((page) => page.id)).size).toBe(pages.length)
  })

  it('link no address the collector does not read, in any build', async () => {
    const missing = new Map<string, string>()
    let linked = 0
    let renders = 0
    for (const page of pages) {
      for (const build of builds(page)) {
        const code = await render(page, build)
        renders += 1
        for (const match of code.matchAll(/<a\b[^>]*?href="([^"]+)"/g)) {
          const href = match[1].replace(/&amp;/g, '&')
          if (!apiHostOf(href)) continue
          linked += 1
          if (!collected(href) && !missing.has(href)) missing.set(href, where(page, build))
        }
      }
    }
    expect([...missing].map(([href, place]) => `${href} (${place})`)).toEqual([])
    // Every page once, and a shared page again in the build of each port: the builds are the ports' slugs, not objects.
    expect(PORTS.every((port) => /^[a-z]+$/.test(port)) && PORTS.length).toBeGreaterThan(10)
    expect(renders).toBe(pages.length + pages.filter((page) => page.shared).length * PORTS.length)
    expect(linked).toBeGreaterThan(0)
  }, 900_000)

  it('link a bare word to the standard library only where the page says its language: a shell\'s exit is not Python\'s, nor coreutils\' timeout Elixir\'s', async () => {
    const shared = pages.filter((page) => page.shared)
    const wrong: string[] = []
    for (const page of shared) {
      for (const build of PORTS) {
        const code = await render(page, build)
        for (const match of code.matchAll(/<a\b[^>]*?href="([^"]+)"[^>]*class="api-mention[^"]*"/g)) if (apiHostOf(match[1])) wrong.push(`${page.file} (${build}): ${match[1]}`)
        for (const match of code.matchAll(/<a\b[^>]*?class="api-mention[^"]*"[^>]*href="([^"]+)"/g)) if (apiHostOf(match[1])) wrong.push(`${page.file} (${build}): ${match[1]}`)
      }
    }
    expect(wrong).toEqual([])
    expect(shared.length).toBeGreaterThan(0)
  }, 900_000)

  it('link a name only to the language its page or its sentence names: a Scala page\'s Vector is Scala\'s, a JavaScript page\'s Set is not Java\'s', async () => {
    const wrong: string[] = []
    let held = 0
    for (const page of pages) {
      for (const build of builds(page)) {
        const code = await render(page, build)
        // The language the page reads as: its own, else the build's. A shared page says none in the build for no port.
        const pagePort = (page.data.port as string | undefined) || build || undefined
        for (const anchor of code.matchAll(/<a\b([^>]*)>/g)) {
          const href = /\bhref="([^"]+)"/.exec(anchor[1])?.[1]?.replace(/&amp;/g, '&')
          if (!href || !/\bclass="[^"]*\bapi-mention\b/.test(anchor[1]) || !apiHostOf(href)) continue
          const text = anchorText(code, anchor.index)
          held += 1
          const problem = linkProblem(href, text, pagePort, textBefore(code, anchor.index))
          if (problem) wrong.push(`${text} ${problem} (${where(page, build)})`)
        }
      }
    }
    expect(wrong).toEqual([])
    expect(held).toBeGreaterThan(0)
  }, 900_000)

  it('link no address in the Markdown copy of a page that the collector does not read, and none to a language its page or sentence does not name', () => {
    const missing = new Map<string, string>()
    const wrong: string[] = []
    let linked = 0
    for (const page of pages) {
      const pagePort = (page.data.port as string | undefined) || undefined
      for (const build of builds(page)) {
        const markdown = twin(page, build)
        for (const href of markdownAddresses(markdown)) {
          linked += 1
          if (!collected(href) && !missing.has(href)) missing.set(href, where(page, build))
        }
        const walk = (node: any) => {
          if (node.type === 'link' && apiHostOf(node.url)) {
            // A link the author wrote is theirs to point where they mean; the one the linker made is held to the page.
            const text = node.children?.[0]?.type === 'inlineCode' && !page.body.includes(`](${node.url})`) ? node.children[0].value : undefined
            const problem = text === undefined ? undefined : linkProblem(node.url, text, pagePort ?? (build || undefined), markdownBefore(markdown, node.position.start.offset))
            if (problem) wrong.push(`${text} ${problem} (${where(page, build)})`)
          }
          for (const child of node.children ?? []) walk(child)
        }
        walk(fromMarkdown(markdown))
      }
    }
    expect([...missing].map(([href, place]) => `${href} (${place})`)).toEqual([])
    expect(wrong).toEqual([])
    expect(linked).toBeGreaterThan(0)
  }, 900_000)
})

/** The addresses on an API host that a rendered fragment links. */
function hostAddresses(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*?href="([^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, '&')).filter((href) => apiHostOf(href))
}

describe('the symbol pages, drawn by the components', () => {
  /** The addresses the index gives a text: what a component may link and nothing else. */
  const given = (spans: unknown) => new Set([...JSON.stringify(spans).matchAll(/https?:\/\/[^"\\]+/g)].map((match) => normalizeAddress(match[0])))
  let components: Awaited<ReturnType<typeof apiComponents>>

  it('draw the documentation of every symbol with the addresses the index gives it, each one a destination the collector reads', async () => {
    components = await apiComponents()
    const container = await experimental_AstroContainer.create()
    const stray = new Map<string, string>()
    let drawn = 0
    let linked = 0
    for (const [port, model] of Object.entries(API_MODELS)) {
      const index = productApiIndex(model, defaultVersionFor(port))
      for (const symbol of model.symbols) {
        for (const { text, form } of proseTexts(symbol)) {
          for (const run of proseRuns(text, form)) {
            const expected = given(index.docSpans(run, symbol))
            if (!expected.size) continue
            const html = await container.renderToString(components.doc, { props: { text: run, index, context: symbol } })
            drawn += 1
            for (const href of hostAddresses(html)) {
              linked += 1
              if ((!expected.has(normalizeAddress(href)) || !collected(href)) && !stray.has(href)) stray.set(href, `${port}:${symbol.id}`)
            }
          }
        }
      }
    }
    expect([...stray].map(([href, where]) => `${href} (${where})`)).toEqual([])
    expect(drawn).toBeGreaterThan(100)
    expect(linked).toBeGreaterThan(100)
  }, 900_000)

  it('draw the types of every symbol with the addresses the index gives them, each one a destination the collector reads', async () => {
    components ??= await apiComponents()
    const container = await experimental_AstroContainer.create()
    const stray = new Map<string, string>()
    let drawn = 0
    let linked = 0
    for (const [port, model] of Object.entries(API_MODELS)) {
      const index = productApiIndex(model, defaultVersionFor(port))
      for (const symbol of model.symbols) {
        for (const { signature, text } of typeInputs(symbol)) {
          const expected = given(index.linkType(text, symbol, signature))
          if (!expected.size) continue
          const html = await container.renderToString(components.type, { props: { type: text, index, context: symbol, signature } })
          drawn += 1
          for (const href of hostAddresses(html)) {
            linked += 1
            if ((!expected.has(normalizeAddress(href)) || !collected(href)) && !stray.has(href)) stray.set(href, `${port}:${symbol.id}`)
          }
        }
      }
    }
    expect([...stray].map(([href, where]) => `${href} (${where})`)).toEqual([])
    expect(drawn).toBeGreaterThan(100)
    expect(linked).toBeGreaterThan(100)
  }, 900_000)

  it('draw each PowerShell common parameter linked to its own heading of the page that documents them, every one a destination the collector reads', async () => {
    components ??= await apiComponents()
    const container = await experimental_AstroContainer.create()
    const model = API_MODELS.powershell
    const index = productApiIndex(model, defaultVersionFor('powershell'))
    const stray = new Map<string, string>()
    const anchors = new Set<string>()
    let commands = 0
    for (const symbol of model.symbols.filter((entry) => entry.command)) {
      const params = apiEntryFields(symbol, 'powershell').params
      const html = await container.renderToString(components.commands, { props: { params, symbol, index } })
      commands += 1
      for (const href of hostAddresses(html)) {
        if (/about_commonparameters\?view=powershell-7\.4#-/.test(href)) anchors.add(href)
        if (!collected(href) && !stray.has(href)) stray.set(href, symbol.id)
      }
    }
    expect([...stray].map(([href, where]) => `${href} (${where})`)).toEqual([])
    expect(commands).toBeGreaterThan(50)
    // One heading for each common parameter the commands list, and the one the page names without a heading is not among them.
    const names = new Set(model.symbols.flatMap((symbol) => symbol.signatures.flatMap((signature) => signature.params.filter((param) => param.binding?.common).map((param) => param.name))))
    expect([...anchors].map((href) => href.split('#-')[1]).sort()).toEqual([...names].map((name) => name.toLowerCase()).sort())
  }, 900_000)
})

describe('the MCP reference, rendered for each port', () => {
  interface Text { port: string; objectId?: string; where: string; text: string }
  /** The addresses on an API host that `renderToolDescription`, the function the MCP route renders with, links in these texts and the collector does not read. */
  async function strays(texts: Text[]) {
    const stray = new Map<string, string>()
    let linked = 0
    for (const { port, objectId, where, text } of texts) {
      for (const href of hostAddresses(await renderToolDescription(text, { port, version: 'latest', objectId }))) {
        linked += 1
        if (!collected(href) && !stray.has(href)) stray.set(href, `${port} ${where}`)
      }
    }
    return { stray, linked }
  }

  it('link no address the collector does not read: every description, summary, argument and schema text the route hands the renderer', async () => {
    const texts = MCP_PORTS.flatMap((port) => descriptionSources(port).map((source): Text => ({ port, objectId: source.object.id, where: `${source.object.name} ${source.where}`, text: source.text })))
    const { stray } = await strays(texts)
    expect([...stray].map(([href, where]) => `${href} (${where})`)).toEqual([])
    expect(MCP_PORTS.length).toBeGreaterThan(5)
    expect(new Set(texts.map((entry) => entry.port)).size).toBe(MCP_PORTS.length)
    expect(texts.length).toBeGreaterThan(100)
  }, 900_000)

  it('would fail on a link the collector does not read: a planted link is found and named, and the links a role makes and plain code are not', async () => {
    const address = 'https://docs.python.org/3/library/os.html#os.nosuch'
    const planted = await strays([{ port: 'py', where: 'planted', text: `See [os.nosuch](${address}) and \`shutil.which("tmux")\`.` }])
    expect([...planted.stray]).toEqual([[address, 'py planted']])
    expect(planted.linked).toBe(1)
    // A role renders as a link to a destination the collector reads, and code with no link leaves nothing to read.
    const role = await strays([{ port: 'py', where: 'role', text: 'See :class:`pathlib.Path` and `Path` and `os.path.join`.' }])
    expect(role.linked).toBeGreaterThan(0)
    expect([...role.stray]).toEqual([])
  }, 900_000)
})

describe('the notices a template writes', () => {
  it('link no address the collector does not read: the prose a product notice carries is linked as the page linker links it', () => {
    const link = createProseLinker()
    const missing: string[] = []
    let spans = 0
    for (const port of SITE_PORTS) {
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
