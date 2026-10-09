import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import type { CollectionEntry } from 'astro:content'
import { readFileSync } from 'node:fs'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { visit } from 'unist-util-visit'
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark'
import { linkProseMarkdown } from '../src/lib/prose-markdown'
import { llmsPage } from '../src/lib/llms'
import { API_MODELS } from '../src/lib/api-models'
import { productApiHref } from '../src/lib/product-api'
import { PORT_BY_SLUG } from '../src/lib/ports'
import { resolvePortCode, remarkPortCode } from '../src/plugins/remark-port-code.mjs'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'

afterEach(() => vi.unstubAllEnvs())

function urls(markdown: string): string[] {
  const links: string[] = []
  visit(fromMarkdown(markdown), 'link', (node) => { links.push(node.url) })
  return links
}

function exampleBytes(markdown: string): string[] {
  const blocks: string[] = []
  visit(fromMarkdown(markdown), 'code', (node) => {
    blocks.push(markdown.slice(node.position!.start.offset, node.position!.end.offset))
  })
  return blocks
}

describe('prose Markdown links', () => {
  it('keeps existing links, reference labels, raw HTML, and code examples intact', () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'rs')
    const preserved = [
      '[**`Server`**](https://example.com/owned)',
      '[`Session`][session]',
      '[`Window`][]',
      '[`Pane`]',
      '![`Server`](image.svg)',
      '<a href="https://example.com/owned">`Server`</a>',
      '<code>`Server`</code>',
      '\\`Server\\`',
      '    `Server`',
      '```rust\n// Keep `Server` and whitespace.\nlet x = 1;\n\n\n// literal\n```',
      '[session]: https://example.com/session',
      '[`Window`]: https://example.com/window',
      '[`Pane`]: https://example.com/pane',
    ].join('\n\n')
    const source = `${preserved}\n\nUse **\`Server\`** and \`crates/libtmux/src/server.rs\`.`
    const result = linkProseMarkdown(source, 'rs')
    expect(result.slice(0, preserved.length)).toBe(preserved)
    expect(exampleBytes(result)).toEqual(exampleBytes(source))
    expect(urls(result).filter((href) => href === '/rs/latest/reference/server-server/')).toHaveLength(1)
    expect(urls(result).some((href) => href.endsWith('/crates/libtmux/src/server.rs'))).toBe(true)
  })

  it('preserves explicit ownership in shared prose and avoids ambiguous file links', () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    vi.stubEnv('LIBTMUX_DOCS_PORT_DEFAULTS', '{"go":"next","py":"stable"}')
    const source = '<!-- port:go -->Use `Session.Panes`.<!-- /port -->\n\n<!-- port:py -->Use `Session.panes` and `list`.<!-- /port -->'
    expect(urls(linkProseMarkdown(source))).toEqual([
      '/go/next/reference/tmux-session-panes/', '/py/stable/reference/libtmux-session-panes/',
      'https://docs.python.org/3/library/stdtypes.html#list',
    ])
    expect(linkProseMarkdown('A `settings.rs` file and `missing-rust-file.rs`.', 'rs')).toBe('A `settings.rs` file and `missing-rust-file.rs`.')
    expect(urls(linkProseMarkdown('Read `src/libtmux/pane.py`.', 'rs'))).toEqual([])
  })

  it.each(Object.keys(PORT_BY_SLUG))('links a real %s declaration in its selected version', (port) => {
    const model = API_MODELS[port]
    const symbol = model.symbols.find((entry) => entry.name === 'Server' && !entry.parent)!
    expect(symbol, `${port} Server declaration`).toBeDefined()
    vi.stubEnv('LIBTMUX_DOCS_PORT', port)
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'next')
    const text = symbol.publicId ?? symbol.id
    expect(urls(linkProseMarkdown(`Use \`${text}\`.`, port))).toContain(productApiHref(model, symbol, 'next'))
  })

  it('keeps product and core declarations in their own sections', () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'next')
    expect(urls(linkProseMarkdown('Use `workspace.Parse` and `tmux.Server`.', 'go', 'workspace'))).toEqual([
      '/go/next/workspace/reference/workspace-parse/', '/go/next/reference/tmux-server/',
    ])
  })

  it('exports the architecture links that HTML renders, without changing programs or anchors', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'rs')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'next')
    const { content, frontmatter } = parseFrontmatter(readFileSync(new URL('../src/content/docs/topics/architecture.md', import.meta.url), 'utf8'))
    const entry = { id: 'topics/architecture', body: content, data: frontmatter } as CollectionEntry<'docs'>
    const exported = llmsPage(entry, 'https://libtmux.org', '/en/rs/next/')
    const renderer = await createMarkdownProcessor({ remarkPlugins: [remarkPortCode], rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
    const html = (await renderer.render(content)).code
    const expected = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*class="api-mention(?: api-mention--file)?"/g)]
      .map((match) => new URL(match[1], 'https://libtmux.org').href)
    expect(expected.length).toBeGreaterThan(20)
    for (const href of expected) expect(urls(exported.body)).toContain(href)
    expect(exampleBytes(exported.body)).toEqual(exampleBytes(resolvePortCode(content, 'rs')))
    expect(exported.body).toContain('id="a-generated-data-table-under-a-hand-written-surface"')
    expect(exported.body).not.toMatch(/\| Port \||\*\*Rust\*\*|<!-- port:/)
    const inventory = JSON.parse(readFileSync(new URL('../src/data/api/rs.paths.json', import.meta.url), 'utf8'))
    expect(urls(exported.body)).toContain(`https://github.com/${inventory.repo}/blob/${inventory.revision}/crates/libtmux/src/formats.rs`)
  })

  it('rewrites angle destinations without corrupting parentheses or literal code', () => {
    const body = '[member](</reference/member(_:_:)>)\n\n`[literal](</other/>)`\n\n[ref]: </reference/member(_:_:)>'
    const output = resolvePortCode(body, undefined, undefined, (href: string) => new URL(href, 'https://libtmux.org').href)
    expect(urls(output)).toEqual(['https://libtmux.org/reference/member(_:_:)'])
    expect(output).toContain('`[literal](</other/>)`')
    expect(output).toContain('[ref]: <https://libtmux.org/reference/member(_:_:)>')
  })
})
