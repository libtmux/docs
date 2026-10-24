import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import type { CollectionEntry } from 'astro:content'
import { getCollection } from 'astro:content'
import { readFileSync } from 'node:fs'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { visit } from 'unist-util-visit'
import { createMarkdownProcessor, parseFrontmatter, rehypeHeadingIds } from '@astrojs/markdown-remark'
import { linkProseMarkdown } from '../src/lib/prose-markdown'
import { llmsPage, llmsPages, localeProse } from '../src/lib/llms'
import { getSidebar, pageBreadcrumbs } from '../src/lib/sidebar'
import { API_MODELS } from '../src/lib/api-models'
import { productApiHref } from '../src/lib/product-api'
import { CONCEPT_DESCRIPTION, PORT_BY_SLUG } from '../src/lib/ports'
import { resolvePortCode, remarkPortCode } from '../src/plugins/remark-port-code.mjs'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'
import { remarkDocumenterHeadings } from '../src/plugins/remark-documenter-headings'
import { rehypeRowAnchors } from '../src/plugins/rehype-row-anchors'

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
  it('links native commands through prose HTML and Markdown without claiming prose aliases', async () => {
    const source = 'Call tmux resize-pane. Use `$ tmux -L local run -b true` and `display-message`. Keep tmux has many panes.\n\n[Keep `run-shell`](https://example.com/authored).\n\n<code><a href="https://example.com/native">run-shell</a></code>\n\n`tmux run-shell true && tmux display-message hello`\n\n```sh\ntmux run-shell true\n```'
    const processor = await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
    const html = (await processor.render(source, { frontmatter: { port: 'go' } })).code
    const markdown = linkProseMarkdown(source, 'go')
    for (const command of ['resize-pane', 'run-shell', 'display-message']) {
      expect(html).toContain(`href="/tmux/latest/manual/${command}/"`)
      expect(urls(markdown)).toContain(`/tmux/latest/manual/${command}/`)
    }
    expect(markdown).toContain('Keep tmux has many panes.')
    expect(html).not.toContain('/manual/has-session/')
    expect(urls(markdown)).not.toContain('/tmux/latest/manual/has-session/')
    expect(markdown).toContain('[Keep `run-shell`](https://example.com/authored)')
    expect(markdown).toContain('<code><a href="https://example.com/native">run-shell</a></code>')
    expect(html).not.toMatch(/<a[^>]*>\s*<code>\s*<a/)
    expect(exampleBytes(markdown)).toEqual(exampleBytes(source))
  })

  it.each(['go', 'ruby', 'py', 'lua'])('preserves %s example support scope in guide exports', (port) => {
    for (const product of ['mcp', 'workspace'] as const) {
      const entry = { id: `ports/${port}/${product}/guides`, body: 'Read the guide.',
        data: { title: 'Guide', port, product, route: `${product}/guides` } } as CollectionEntry<'docs'>
      const exported = llmsPage(entry, 'https://libtmux.org', '/en/')
      if (port === 'go' || port === 'ruby') expect(exported.body).toContain(CONCEPT_DESCRIPTION)
      else expect(exported.body).not.toContain(CONCEPT_DESCRIPTION)
    }
  })

  it('retains native Documenter heading IDs in headings, row links and collected navigation', async () => {
    const renderer = await createMarkdownProcessor({ remarkPlugins: [remarkDocumenterHeadings],
      rehypePlugins: [rehypeHeadingIds, rehypeRowAnchors], syntaxHighlight: false })
    const content = '### [Cancellation `callback`](@id overview-cancellation-callback)\n\n'
      + '## [I/O and cancellation](@id overview)\n\n'
      + '| Resource | Owner |\n| --- | --- |\n| Control clients | Caller |\n\n'
      + '```markdown\n### [Example](@id example-only)\n```'
    const rendered = await renderer.render(content, { frontmatter: { port: 'julia' } })
    expect(rendered.code).toContain('<h3 id="overview-cancellation-callback">Cancellation <code>callback</code></h3>')
    expect(rendered.code).toContain('<h2 id="overview">I/O and cancellation</h2>')
    expect(rendered.code).toContain('<tr id="overview-control-clients"')
    expect(rendered.metadata.headings.map((heading) => heading.slug)).toEqual(['overview-cancellation-callback', 'overview'])
    expect(rendered.code).toContain('### [Example](@id example-only)')
    expect(rendered.code).not.toContain('<h3 id="example-only">')
    const other = await renderer.render(content, { frontmatter: { port: 'ruby' } })
    expect(other.code).not.toContain('<h2 id="overview">')
  })

  it('exports native heading IDs as CommonMark-compatible aliases with clean heading labels', () => {
    const body = '### [Cancellation callback](@id overview-cancellation-callback)\n\n'
      + '## [I/O and cancellation](@id overview)\n\n'
      + '```markdown\n### [Example](@id example-only)\n```\n'
    const projected = linkProseMarkdown(body, 'julia')
    expect(projected).toContain('<a id="overview-cancellation-callback"></a>\n\n### Cancellation callback')
    expect(projected).toContain('<a id="overview"></a>\n\n## I/O and cancellation')
    expect(projected).not.toContain('### [Cancellation callback](@id')
    expect(exampleBytes(projected)).toEqual(exampleBytes(body))
    expect(linkProseMarkdown(body, 'ruby')).toBe(body)
    const authored = vi.fn((href: string, owner?: string) => `/projected/${owner}/${href}`)
    expect(linkProseMarkdown('### [Read [guide](guides/setup.md)](@id setup)', 'julia', undefined, { authored }))
      .toBe('<a id="setup"></a>\n\n### Read [guide](/projected/julia/guides/setup.md)')
    expect(authored).toHaveBeenCalledWith('guides/setup.md', 'julia')
    const entry = { id: '_staged/julia/topics/ownership/index', body,
      data: { title: 'Ownership and I/O', port: 'julia', route: 'topics/ownership', sidebar: { group: 'Topics' } },
    } as CollectionEntry<'docs'>
    expect(llmsPage(entry, 'https://libtmux.org', '/en/julia/latest/').body).toBe(projected)
  })

  it('retains native heading IDs after the HTML pipeline selects port regions', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'julia')
    const renderer = await createMarkdownProcessor({ remarkPlugins: [remarkPortCode, remarkDocumenterHeadings],
      rehypePlugins: [rehypeHeadingIds, rehypeRowAnchors], syntaxHighlight: false })
    const content = '<!-- port:ruby -->\nRuby only.\n<!-- /port -->\n\n'
      + '<!-- port:julia -->\n## [I/O and cancellation](@id overview)\n\n'
      + '| Resource | Owner |\n| --- | --- |\n| Control clients | Caller |\n\n'
      + '```markdown\n### [Example](@id example-only)\n```\n<!-- /port -->\n'
    const rendered = await renderer.render(content, { frontmatter: { port: 'julia' } })
    expect(rendered.code).toContain('<h2 id="overview">I/O and cancellation</h2>')
    expect(rendered.code).toContain('<tr id="overview-control-clients"')
    expect(rendered.metadata.headings.map((heading) => heading.slug)).toEqual(['overview'])
    expect(rendered.code).not.toContain('Ruby only.')
    expect(rendered.code).not.toContain('<h3 id="example-only">')
    const projected = linkProseMarkdown(content, 'julia')
    expect(projected).toContain('<a id="overview"></a>\n\n## I/O and cancellation')
    expect(projected).toContain('### [Example](@id example-only)')
    expect(projected).not.toContain('Ruby only.')
  })

  it('uses the native Concepts page in routes, exports, sidebar and breadcrumbs', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'ruby')
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
    const shared = { id: 'concepts', body: 'Shared concepts.', data: { title: 'Concepts', sidebar: { group: 'Concepts' } } }
    const native = { id: '_staged/ruby/concepts', body: 'Ruby concepts.', data: { title: 'Ruby concepts', port: 'ruby', route: 'concepts', sidebar: { group: 'Concepts' } } }
    const entries = [shared, native] as CollectionEntry<'docs'>[]
    vi.mocked(getCollection<'docs'>).mockImplementation(async (_collection, filter) => entries.filter((entry) => !filter || filter(entry)))
    try {
      expect(localeProse(entries, 'en', 'ruby')).toEqual([{ entry: native, route: 'concepts' }])
      const exported = await llmsPages('https://libtmux.org', '/en/ruby/latest/')
      const prose = exported.filter((page) => !page.url.endsWith('/reference/glossary/'))
      expect(prose).toHaveLength(1)
      expect(prose[0]).toMatchObject({ title: 'Ruby concepts', body: 'Ruby concepts.', url: 'https://libtmux.org/en/ruby/latest/concepts/' })
      const sidebar = await getSidebar('ruby', 'latest')
      const concepts = sidebar.find((entry) => entry.type === 'group' && entry.label === 'Concepts')
      expect(concepts).toMatchObject({ href: expect.stringContaining('/ruby/latest/concepts/'), items: [] })
      expect((await pageBreadcrumbs('Model', 'concepts/model', 'latest', 'ruby')).map((entry) => entry.name)).toEqual(['Ruby', 'Ruby concepts', 'Model'])
    } finally {
      vi.mocked(getCollection).mockResolvedValue([])
    }
  })

  it('marks explicit and resolved API links with their destination kind, leaving copied code intact', async () => {
    const renderer = await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
    const content = [
      '[`New-TmuxSession`](../../reference/libtmux-new-tmuxsession/)',
      'Use `Get-TmuxSnapshot`.',
      '[`Server`](/en/csharp/latest/reference/libtmux-server/)',
      '[`Server`](/en/julia/latest/reference/libtmux-server/)',
      '[external](https://example.com/en/julia/latest/reference/libtmux-server/)',
      '[parameter](../../reference/libtmux-new-tmuxsession/#parameter.Name)',
      '```powershell\nNew-TmuxSession\n```',
    ].join('\n\n')
    const rendered = await renderer.render(content, { frontmatter: { port: 'powershell', route: 'examples/create-layout' } })
    expect(rendered.code.match(/data-api-kind="function"/g)).toHaveLength(2)
    expect(rendered.code.match(/data-api-kind="class"/g)).toHaveLength(1)
    expect(rendered.code.match(/data-api-kind="struct"/g)).toHaveLength(1)
    expect(rendered.code).toContain('aria-hidden="true" title="cmdlet"><span class="api-badge__label" data-mark="asc">f</span></span><span class="api-symbol-link__name"><code>New-TmuxSession</code></span>')
    expect(rendered.code.match(/class="api-symbol-link__name"/g)).toHaveLength(4)
    expect(rendered.code).toContain('<pre><code class="language-powershell">New-TmuxSession\n</code></pre>')
    expect(linkProseMarkdown(content, 'powershell')).not.toContain('data-api-kind')
    const repeated = await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks, rehypeApiLinks], syntaxHighlight: false })
    expect((await repeated.render(content, { frontmatter: { port: 'powershell', route: 'examples/create-layout' } })).code).toBe(rendered.code)
  })

  it.each([
    ['ports/cxx/workspace/internals/examples', 'cxx', 'workspace', '[`Server`](../../../reference/libtmux-server/)', 'class'],
    ['ports/go/mcp/examples/run-command', 'go', 'mcp', '[`Session.ResolveActivePane`](../../../reference/tmux-session-resolveactivepane/)', 'method'],
    ['ports/rs/workspace/internals/examples', 'rs', 'workspace', '[`Server`](../../../reference/server-server/)', 'struct'],
  ])('resolves badge destinations using the actual source route of %s', async (id, port, product, content, kind) => {
    const renderer = await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
    const rendered = await renderer.render(content, {
      fileURL: new URL(`../src/content/docs/${id}.md`, import.meta.url), frontmatter: { port, product },
    })
    expect(rendered.code).toContain(`data-api-kind="${kind}"`)
  })

  it.each([
    ['powershell', 'Use `Get-TmuxSnapshot` with `LibTmux.Server` and `Server`. Read `src/LibTmux.PowerShell/ConnectTmuxServerCommand.cs`.', [
      '/powershell/latest/reference/libtmux-get-tmuxsnapshot/', '/csharp/latest/reference/libtmux-server/',
    ], '/src/LibTmux.PowerShell/ConnectTmuxServerCommand.cs'],
    ['julia', 'Use `Base.strip` on captured output. Read `src/server.jl`.', [
      'https://docs.julialang.org/en/v1/base/strings/#Base.strip',
    ], '/src/server.jl'],
  ])('links %s prose in HTML and Markdown with its API and source inventories', async (port, content, targets, sourcePath) => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', port)
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
    vi.stubEnv('LIBTMUX_DOCS_PORT_DEFAULTS', '{"csharp":"latest"}')
    const renderer = await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
    const html = (await renderer.render(content)).code
    const markdown = linkProseMarkdown(content, port)
    for (const target of targets) {
      expect(html).toContain(`href="${target}"`)
      expect(urls(markdown)).toContain(target)
    }
    const source = urls(markdown).find((href) => href.endsWith(sourcePath))!
    expect(source).toMatch(new RegExp(`^https://github.com/libtmux/libtmux-${port}/blob/[a-f0-9]{40}/`))
    expect(html).toContain(`href="${source}"`)
  })

  it('does not borrow PowerShell dependencies in Julia prose or resolve an invented cmdlet', () => {
    expect(urls(linkProseMarkdown('Use `LibTmux.Server` and `Server`.', 'julia')))
      .not.toContain('/csharp/latest/reference/libtmux-server/')
    expect(urls(linkProseMarkdown('Use `Invent-TmuxServer`.', 'powershell'))).toEqual([])
  })

  it('uses the same standard PowerShell destinations in prose HTML and Markdown', async () => {
    const names = ['Where-Object', 'Get-Member', 'Invoke-WebRequest', 'Start-ThreadJob', 'Receive-Job', 'Set-Content']
    const content = names.map(name => `Use \`${name}\`.`).join('\n\n')
      + '\n\n```powershell\nGet-Member\n```\n'
    const renderer = await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
    const html = (await renderer.render(content, { frontmatter: { port: 'powershell' } })).code
    const markdown = linkProseMarkdown(content, 'powershell')
    const links = urls(markdown)
    expect(links).toHaveLength(names.length)
    for (const href of links) {
      expect(href).toMatch(/^https:\/\/learn\.microsoft\.com\/powershell\/module\//)
      expect(html).toContain(`href="${href}"`)
    }
    expect(exampleBytes(markdown)).toEqual(exampleBytes(content))
    expect(html).toContain('<pre><code class="language-powershell">Get-Member\n</code></pre>')
  })

  it.each(['', '/pr-42'])('keeps explicit library and manual links consistent in Japanese HTML and exports under %s', async (prefix) => {
    vi.stubEnv('LIBTMUX_DOCS_ROOT', `${prefix}/ja`)
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', `${prefix}/en`)
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    vi.stubEnv('LIBTMUX_DOCS_PORT_DEFAULTS', '{}')
    vi.resetModules()
    const { llmsPage: deployedPage } = await import('../src/lib/llms')
    const { rehypeSiteRoot } = await import('../src/plugins/rehype-site-root.mjs')
    const { remarkPortCode: deployedPortCode } = await import('../src/plugins/remark-port-code.mjs')
    const renderer = await createMarkdownProcessor({
      remarkPlugins: [deployedPortCode], rehypePlugins: [rehypeSiteRoot], syntaxHighlight: false,
    })
    for (const id of ['examples/capture-pane-output', 'guides/attaching-to-tmux', 'examples/workspace-from-file', 'concepts/queries']) {
      const { content, frontmatter } = parseFrontmatter(readFileSync(new URL(`../src/content/docs/${id}.md`, import.meta.url), 'utf8'))
      const entry = { id, body: content, data: frontmatter } as CollectionEntry<'docs'>
      const exported = deployedPage(entry, 'https://libtmux.org', `${prefix}/ja/`)
      const html = (await renderer.render(content)).code
      const htmlLinks = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => new URL(match[1], 'https://libtmux.org').href)
      const owned = urls(content).filter((href) => {
        const owner = href.split('/')[1]
        return Object.hasOwn(PORT_BY_SLUG, owner) || href.startsWith('/tmux/latest/manual/')
      })
      expect(owned.length, id).toBeGreaterThan(0)
      for (const href of owned) {
        const target = `https://libtmux.org${prefix}/en${href}`
        expect(htmlLinks, `${id} HTML`).toContain(target)
        expect(urls(exported.body), `${id} Markdown`).toContain(target)
        expect(urls(exported.body)).not.toContain(`https://libtmux.org${prefix}/ja${href}`)
      }
      expect(exampleBytes(exported.body)).toEqual(exampleBytes(resolvePortCode(content)))
    }
  })

  it.each(['', '/pr-42'])('links owned tasks from Japanese exports to their English port under %s', async (prefix) => {
    vi.stubEnv('LIBTMUX_DOCS_ROOT', `${prefix}/ja`)
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', `${prefix}/en`)
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    vi.stubEnv('LIBTMUX_DOCS_PORT_DEFAULTS', '{"go":"next","java":"latest","ts":"next"}')
    vi.resetModules()
    const { llmsPage: deployedPage } = await import('../src/lib/llms')
    const pages = [
      ['ports/go/topics/architecture', ['go/next/concepts/queries']],
      ['ports/java/topics/architecture', ['java/latest/concepts/queries']],
      ['ports/ts/topics/waiting-and-retry', ['ts/next/concepts/transports']],
    ] as const
    for (const [id, targets] of pages) {
      const { content, frontmatter } = parseFrontmatter(readFileSync(new URL(`../src/content/docs/${id}.md`, import.meta.url), 'utf8'))
      const entry = { id, body: content, data: frontmatter } as CollectionEntry<'docs'>
      const exported = deployedPage(entry, 'https://libtmux.org', `${prefix}/ja/`)
      for (const target of targets) {
        expect(urls(exported.body)).toContain(`https://libtmux.org${prefix}/en/${target}/`)
        expect(urls(exported.body)).not.toContain(`https://libtmux.org${prefix}/ja/${target}/`)
      }
      expect(exampleBytes(exported.body)).toEqual(exampleBytes(resolvePortCode(content)))
    }
  })

  it.each([
    { root: '/en', ports: '/en' },
    { root: '/pr-42/en', ports: '/pr-42/en' },
    { root: '/pr-42/ja', ports: '/pr-42/en' },
  ])('keeps API and product destinations in their owning build under $root', async ({ root, ports }) => {
    vi.stubEnv('LIBTMUX_DOCS_ROOT', root)
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', ports)
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'next')
    vi.stubEnv('LIBTMUX_DOCS_PORT_DEFAULTS', '{"py":"stable","rs":"v0.1"}')
    vi.resetModules()
    const { llmsPage: deployedPage } = await import('../src/lib/llms')
    const { rehypeApiLinks: deployedApiLinks } = await import('../src/plugins/rehype-api-links')
    const { rehypeSiteRoot } = await import('../src/plugins/rehype-site-root.mjs')
    const { remarkPortCode: deployedPortCode } = await import('../src/plugins/remark-port-code.mjs')
    const cases = ['go', 'py', 'rs', 'java', 'csharp'].flatMap((owner) => [
      { owner, port: owner }, { owner, port: '' },
    ])
    for (const { owner, port } of cases) {
      const id = `ports/${owner}/concepts/workspaces`
      const { content, frontmatter } = parseFrontmatter(readFileSync(new URL(`../src/content/docs/${id}.md`, import.meta.url), 'utf8'))
      const entry = { id, body: content, data: frontmatter } as CollectionEntry<'docs'>
      vi.stubEnv('LIBTMUX_DOCS_PORT', port)
      const base = port ? `${root}/${port}/next/` : `${root}/`
      const exported = deployedPage(entry, 'https://libtmux.org', base)
      const renderer = await createMarkdownProcessor({
        remarkPlugins: [deployedPortCode], rehypePlugins: [rehypeSiteRoot, deployedApiLinks], syntaxHighlight: false,
      })
      const html = (await renderer.render(content, { frontmatter })).code
      const htmlLinks = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => new URL(match[1], 'https://libtmux.org').href)
      const defaults: Record<string, string> = { py: 'stable', rs: 'v0.1' }
      const version = owner === port ? 'next' : defaults[owner] ?? 'latest'
      const target = `https://libtmux.org${ports}/${owner}/${version}/workspace/`
      expect(htmlLinks, `${owner}/${port || 'root'} HTML`).toContain(target)
      expect(urls(exported.body), `${owner}/${port || 'root'} Markdown`).toContain(target)
      for (const target of htmlLinks.filter((href) => href.includes('/reference/'))) {
        expect(urls(exported.body), `${port || 'shared'} API ${target}`).toContain(target)
      }
      expect(exported.body).not.toContain(`${root}${ports}/`)
      expect(exampleBytes(exported.body)).toEqual(exampleBytes(resolvePortCode(content, port || undefined, owner)))
    }
  })

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
      'https://docs.python.org/3/builtins/stdtypes.html#list',
    ])
    expect(linkProseMarkdown('A `settings.rs` file and `missing-rust-file.rs`.', 'rs')).toBe('A `settings.rs` file and `missing-rust-file.rs`.')
    expect(urls(linkProseMarkdown('Read `src/libtmux/pane.py`.', 'rs'))).toEqual([])
  })

  it.each(Object.keys(PORT_BY_SLUG))('links a real %s declaration in its selected version', (port) => {
    const model = API_MODELS[port]
    const name = port === 'powershell' ? 'New-TmuxServer' : 'Server'
    const symbol = model.symbols.find((entry) => entry.name === name && (port === 'powershell' ? entry.command : !entry.parent))!
    expect(symbol, `${port} ${name} declaration`).toBeDefined()
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
    const { content, frontmatter } = parseFrontmatter(readFileSync(new URL('../src/content/docs/ports/rs/topics/architecture.md', import.meta.url), 'utf8'))
    const entry = { id: 'ports/rs/topics/architecture', body: content, data: frontmatter } as CollectionEntry<'docs'>
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
