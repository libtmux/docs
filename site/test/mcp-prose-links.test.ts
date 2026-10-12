import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { fromHtml } from 'hast-util-from-html'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { visit } from 'unist-util-visit'
import { createProseLinker } from '../src/lib/prose-resolver'
import { linkProseMarkdown } from '../src/lib/prose-markdown'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'

afterEach(() => vi.unstubAllEnvs())

const renderer = () => createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks], syntaxHighlight: false })
function markdownLinks(text: string): string[] {
  const hrefs: string[] = []
  visit(fromMarkdown(text), 'link', (node) => { hrefs.push(node.url) })
  return hrefs
}

describe('MCP protocol links in site prose', () => {
  it.each([
    ['py', 'mcp:tool:capture_pane', 'tools/capture_pane', 'tool'],
    ['py', 'mcp:prompt:run_and_wait', 'prompts/run_and_wait', 'prompt'],
    ['ts', 'mcp:resource:tmux://capabilities', 'resources/capabilities', 'resource'],
    ['py', 'mcp:resource-template:tmux://panes/{pane_id}{?socket_name}', 'resources/templates/get_pane', 'resource-template'],
  ])('resolves the %s %s contract in HTML and Markdown outside MCP pages', async (port, reference, path, kind) => {
    const content = `Read \`${reference}\`.`
    const href = `/${port}/latest/mcp/${path}/`
    const html = (await (await renderer()).render(content, { frontmatter: { port, route: 'guides/getting-started' } })).code
    expect(html).toContain(`href="${href}"`)
    expect(html).toContain(`data-api-kind="${kind}" aria-hidden="true"`)
    const markdown = linkProseMarkdown(content, port)
    expect(markdownLinks(markdown)).toEqual([href])
    expect(markdown).not.toMatch(/api-link-kind|data-api-kind|<span/)
  })

  it('uses the advertised name only inside MCP prose, preserving the library API namespace', async () => {
    const content = 'Use `capture_pane`, `run_and_wait`, and `tmux://panes/{pane_id}{?socket_name}`.'
    const processor = await renderer()
    const html = (await processor.render(content, { frontmatter: { port: 'py', product: 'mcp' } })).code
    const expected = ['/py/latest/mcp/tools/capture_pane/', '/py/latest/mcp/prompts/run_and_wait/', '/py/latest/mcp/resources/templates/get_pane/']
    for (const href of expected) expect(html).toContain(`href="${href}"`)
    expect(markdownLinks(linkProseMarkdown(content, 'py', 'mcp'))).toEqual(expected)
    const libraryHtml = (await processor.render(content, { frontmatter: { port: 'py' } })).code
    expect(libraryHtml).toContain('/py/latest/reference/libtmux-pane-capture_pane/')
    expect(libraryHtml).not.toMatch(/\/mcp\/(?:tools|prompts|resources)\//)
    expect(markdownLinks(linkProseMarkdown(content, 'py')).some((href) => /\/mcp\/(?:tools|prompts|resources)\//.test(href))).toBe(false)
  })

  it('resolves explicit Markdown destinations without changing labels, titles or authored ordinary links', async () => {
    const content = 'Read [the wait workflow](mcp:prompt:run_and_wait "Workflow") and [the pane](mcp:resource-template:tmux://panes/{pane_id}{?socket_name}). Keep [this link](https://example.com/).'
    const html = (await (await renderer()).render(content, { frontmatter: { port: 'py' } })).code
    const markdown = linkProseMarkdown(content, 'py', undefined, {
      resolved: (href) => `https://libtmux.org${href}`, authored: (href) => href,
    })
    expect(html).toContain('href="/py/latest/mcp/prompts/run_and_wait/" title="Workflow"')
    expect(html).toContain('data-api-kind="prompt"')
    expect(html).toContain('href="/py/latest/mcp/resources/templates/get_pane/"')
    expect(markdown).toContain('[the wait workflow](https://libtmux.org/py/latest/mcp/prompts/run_and_wait/ "Workflow")')
    expect(markdownLinks(markdown)).toEqual([
      'https://libtmux.org/py/latest/mcp/prompts/run_and_wait/',
      'https://libtmux.org/py/latest/mcp/resources/templates/get_pane/', 'https://example.com/',
    ])
    expect(markdown).not.toContain('data-api-kind')
  })

  it('does not borrow a capability from another port or infer an unknown explicit object', () => {
    const link = createProseLinker('mcp')
    for (const [port, text] of [
      ['ts', 'mcp:prompt:run_and_wait'], ['julia', 'mcp:tool:list_sessions'],
      ['py', 'mcp:resource:tmux://capabilities'], ['py', 'mcp:tool:not_a_tool'],
      ['py', 'mcp:tool:run_and_wait'],
    ]) expect(link(text, { pagePort: port }).kind, `${port}/${text}`).toBe('unresolved')
    expect(link('mcp:tool:list_sessions', {}).kind).toBe('unresolved')
    expect(link('mcp:prompt:run_and_wait', {})).toMatchObject({ kind: 'link', port: 'py' })
    expect(link('mcp:prompt:run_and_wait', { pagePort: 'ts', before: 'Python offers ' })).toMatchObject({ kind: 'link', port: 'py' })
  })

  it('resolves encoded URI templates in both renderers while retaining authored text and code', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'py')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'next')
    const reference = 'mcp:resource-template:tmux://panes/%7Bpane_id%7D%7B?socket_name%7D'
    const example = `\n\n\`\`\`markdown\n[pane](${reference})\n\`\`\``
    const content = `Read [the pane](${reference} "Pane resource") or [the same pane][pane].\n\n[pane]: ${reference} "URI template"${example}`
    const href = '/py/next/mcp/resources/templates/get_pane/'
    const html = (await (await renderer()).render(content, { frontmatter: { port: 'py' } })).code
    expect(html.match(new RegExp(`href="${href}"`, 'g'))).toHaveLength(2)
    const markdown = linkProseMarkdown(content, 'py', undefined, { resolved: (url) => `https://libtmux.org${url}` })
    expect(markdown).toContain(`[the pane](https://libtmux.org${href} "Pane resource")`)
    expect(markdown).toContain(`[pane]: https://libtmux.org${href} "URI template"`)
    expect(markdown).toContain('[the same pane][pane]')
    expect(markdown.endsWith(example)).toBe(true)
  })

  it('preserves malformed, unknown and unsupported encoded MCP destinations', async () => {
    const content = '[malformed](mcp:resource-template:tmux://panes/%ZZ) and [unknown](mcp:resource-template:tmux://missing/%7Bid%7D).'
    expect(linkProseMarkdown(content, 'py')).toBe(content)
    await expect((await renderer()).render(content, { frontmatter: { port: 'py' } })).resolves.toBeDefined()
    const unsupported = '[pane](mcp:resource-template:tmux://panes/%7Bpane_id%7D%7B?socket_name%7D)'
    expect(linkProseMarkdown(unsupported, 'julia')).toBe(unsupported)
  })

  it('keeps references in the selected build version and honors cross-port defaults', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'py')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'next')
    vi.stubEnv('LIBTMUX_DOCS_PORT_DEFAULTS', '{"ts":"stable"}')
    const link = createProseLinker()
    expect(link('mcp:prompt:run_and_wait', { pagePort: 'py' })).toMatchObject({ href: '/py/next/mcp/prompts/run_and_wait/' })
    expect(link('mcp:resource:tmux://capabilities', { pagePort: 'ts' })).toMatchObject({ href: '/ts/stable/mcp/resources/capabilities/' })
  })

  it('marks the actual relative or absolute destination, excluding ordinary pages, fields and foreign hosts', async () => {
    const content = [
      '[tool](../../tools/capture_pane/)',
      '[prompt](../../prompts/run_and_wait/)',
      '[template](../../resources/templates/get_pane/)',
      '[resource](/en/go/latest/mcp/resources/tmux-capabilities/)',
      '[overview](../../tools/)', '[unknown](../../tools/missing_tool/)',
      '[argument](../../tools/capture_pane/#mcp.tool.capture_pane.arguments.pane_id)',
      '[fragment](#mcp.tool.capture_pane)',
      '[foreign](https://example.com/en/py/latest/mcp/tools/capture_pane/)',
      '[foreign relative](//example.com/en/py/latest/mcp/tools/capture_pane/)',
      '[ordinary](../../guides/installation/)',
      '```json\n{"name":"capture_pane", "note":"mcp:prompt:run_and_wait"}\n```',
    ].join('\n\n')
    const frontmatter = { port: 'py', product: 'mcp', route: 'mcp/examples/run-command' }
    const html = (await (await renderer()).render(content, { frontmatter })).code
    const badges: string[] = []
    visit(fromHtml(html, { fragment: true }), 'element', (node) => {
      if (node.properties.dataApiKind) badges.push(String(node.properties.dataApiKind))
    })
    expect(badges).toEqual(['tool', 'prompt', 'resource-template', 'resource'])
    expect(html).toContain('<pre><code class="language-json">{"name":"capture_pane", "note":"mcp:prompt:run_and_wait"}\n</code></pre>')
    const twice = await createMarkdownProcessor({ rehypePlugins: [rehypeApiLinks, rehypeApiLinks], syntaxHighlight: false })
    expect((await twice.render(content, { frontmatter })).code).toBe(html)
    expect(linkProseMarkdown(content, 'py', 'mcp')).toBe(content)
  })
})
