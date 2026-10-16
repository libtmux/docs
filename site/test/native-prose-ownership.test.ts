import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import type { CollectionEntry } from 'astro:content'
import { readFileSync } from 'node:fs'
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { visit } from 'unist-util-visit'
import { SymbolIndex } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { getResolver } from '../src/lib/prose-resolver'
import { llmsPage } from '../src/lib/llms'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'

beforeEach(() => vi.stubEnv('LIBTMUX_DOCS_PORT', ''))
afterEach(() => vi.unstubAllEnvs())

const processor = createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
const sourceEntry = (id: string) => {
  const { content, frontmatter } = parseFrontmatter(readFileSync(new URL(`../src/content/docs/${id}.md`, import.meta.url), 'utf8'))
  return { id, body: content, data: frontmatter } as CollectionEntry<'docs'>
}
const fixture = (id: string, body: string, data: Record<string, unknown> = {}) =>
  ({ id, body, data: { title: 'Prose ownership fixture', ...data } }) as CollectionEntry<'docs'>
const htmlOf = async (entry: CollectionEntry<'docs'>) => (await (await processor).render(entry.body ?? '', {
  fileURL: new URL(`../src/content/docs/${entry.id}.md`, import.meta.url), frontmatter: entry.data,
})).code
const markdownOf = (entry: CollectionEntry<'docs'>) => llmsPage(entry, 'https://libtmux.org', '/en/').body

function links(text: string): string[] {
  const urls: string[] = []
  visit(fromMarkdown(text), 'link', (node) => { urls.push(node.url) })
  return urls
}

function fences(text: string): string[] {
  const bytes: string[] = []
  visit(fromMarkdown(text), 'code', (node) => {
    bytes.push(text.slice(node.position!.start.offset, node.position!.end.offset))
  })
  return bytes
}

const nativeCases = [
  ['guides/attaching-to-tmux', ['TMUX', 'TMUX_PANE']],
  ['topics/environment', ['TMUX', 'TMUX_PANE']],
  ['topics/errors-and-exceptions', ['else']],
  ['topics/format-tokens', ['session_name', 'window_name']],
  ['topics/socket-and-servers', ['TMUX']],
  ['topics/traversal', ['window_id']],
] as const

describe('native tmux prose ownership', () => {
  it.fails.each(nativeCases)('keeps native %s HTML free of inferred library links', async (id) => {
    const html = await htmlOf(sourceEntry(id))
    expect(html).not.toContain('api-mention')
    expect(html).toContain('/tmux/latest/manual/')
  })

  it.fails.each(nativeCases)('keeps native %s Markdown free of inferred library links', (id, names) => {
    const entry = sourceEntry(id)
    const markdown = markdownOf(entry)
    for (const name of names) {
      expect(markdown).not.toContain(`[\`${name}\`](`)
      expect(markdown).toContain(`\`${name}\``)
    }
    expect(fences(markdown)).toEqual(fences(entry.body!))
    expect(links(markdown).some((href) => href.includes('/tmux/latest/manual/'))).toBe(true)
  })

  it.fails.each(['html', 'markdown'])('rejects literal output with only Swift available in %s', async (format) => {
    // Keep the real resolver and inventories; narrow only the claimants, as a
    // missing Rust source field did before the payload extraction correction.
    getResolver()
    const originals = { ...API_MODELS }
    for (const port of Object.keys(API_MODELS)) if (port !== 'swift') delete API_MODELS[port]
    try {
      const entry = fixture('concepts/output', 'The output is `renamed:source`, `different:source`, and `arbitrary.source`.')
      const rendered = format === 'html' ? await htmlOf(entry) : markdownOf(entry)
      expect(rendered).not.toContain('regexpattern-source')
    } finally {
      Object.assign(API_MODELS, originals)
    }
  })

  it.fails.each([
    ['ja/topics/environment', {}],
    ['_staged/native/intro', { route: 'concepts/native' }],
    ['guides/index', {}],
  ] as const)('uses the native canonical route for %s HTML', async (id, data) => {
    expect(await htmlOf(fixture(id, 'The value is `TMUX`.', data))).not.toContain('api-mention')
  })

  it.fails.each([
    ['ja/topics/environment', {}],
    ['_staged/native/intro', { route: 'concepts/native' }],
    ['guides/index', {}],
  ] as const)('uses the native canonical route for %s exports', (id, data) => {
    expect(markdownOf(fixture(id, 'The value is `TMUX`.', data))).not.toContain('[`TMUX`](')
  })

  it('preserves authored destinations, manual links, command inference and copied fences', async () => {
    const body = [
      '[`renamed:source`](/swift/latest/reference/regexpattern-source/)',
      '[`TMUX`][authored]',
      '[authored]: https://example.com/selected#keep',
      '[manual](/tmux/latest/manual/full/#FORMATS)',
      'Use `run-shell` and tmux display-message.',
      '```sh\nprintf \'%s\\n\' renamed:source\n```',
    ].join('\n\n')
    const entry = fixture('guides/explicit', body)
    const html = await htmlOf(entry)
    const markdown = markdownOf(entry)
    for (const suffix of ['/swift/latest/reference/regexpattern-source/', '/tmux/latest/manual/full/#FORMATS',
      '/tmux/latest/manual/run-shell/', '/tmux/latest/manual/display-message/', 'example.com/selected#keep']) {
      expect(html).toContain(suffix)
      expect(markdown).toContain(suffix)
    }
    expect(fences(markdown)).toEqual(fences(body))
    expect(html).toContain('renamed:source\n</code></pre>')
  })

  it.each([
    ['ports/py/workspace/reference', { port: 'py', product: 'workspace' }, 'Use `loader.trickle`.', 'tmuxp-workspace-loader-trickle'],
    ['_staged/lua/method', { port: 'lua', route: 'guides/runtime' }, 'Use `server:new_session`.', 'libtmux-server-new_session'],
    ['ports/rs/queries', { port: 'rs' }, 'Use `Session::filter_fields()`.', 'query-filterable-filter_fields'],
    ['parity', {}, "Python uses `Window.split_window`.", 'libtmux-window-split_window'],
  ] as const)('preserves non-native inference for %s', async (id, data, body, destination) => {
    const entry = fixture(id, body, data)
    expect(await htmlOf(entry)).toContain(destination)
    expect(markdownOf(entry)).toContain(destination)
  })

  it('retains a selected port build on an otherwise shared route', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'py')
    const entry = fixture('guides/example', 'Use `Window.split_window`.')
    expect(await htmlOf(entry)).toContain('libtmux-window-split_window')
    expect(markdownOf(entry)).toContain('libtmux-window-split_window')
  })

  it.each([
    ['swift', 'RegexPattern', '``source``', 'RegexPattern.source'],
    ['py', 'libtmux.Window', ':meth:`split_window`', 'libtmux.Window.split_window'],
    ['ts', 'server.Server', '{@link Server.setHook}', 'server.Server.setHook'],
  ] as const)('preserves native %s doc roles', (port, ownerId, text, targetId) => {
    const model = API_MODELS[port]
    const owner = model.symbols.find((symbol) => (symbol.publicId ?? symbol.id) === ownerId)!
    const index = new SymbolIndex(model.symbols, (symbol) => `/target/${symbol.publicId ?? symbol.id}/`, port)
    expect(index.linkText(text, owner).some((span) => span.kind === 'ref' && span.link?.href === `/target/${targetId}/`)).toBe(true)
  })
})
