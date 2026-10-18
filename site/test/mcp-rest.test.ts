import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'
import { MCP_REFERENCE, plainSummary, renderToolDescription } from '../src/lib/mcp-reference'
import { restToMarkdown } from '../src/lib/mcp-rest'

beforeEach(() => vi.stubEnv('LIBTMUX_DOCS_PORT_DEFAULTS', '{"py":"stable"}'))
afterEach(() => vi.unstubAllEnvs())

const py = { port: 'py', version: 'stable' }
const tool = (name: string) => MCP_REFERENCE.py.registrations.find((entry) => entry.wireName === name)!
/** Each link with its visible text, excluding the aria-hidden kind badge. */
const anchors = (html: string) => {
  const found: { href: string; text: string; badge?: string }[] = []
  const text = (node: { type: string; value?: string; properties?: Record<string, unknown>; children?: unknown[] }): string =>
    node.type === 'text' ? node.value ?? '' : node.properties?.ariaHidden ? '' : (node.children as typeof node[] ?? []).map(text).join('')
  visit(fromHtml(html, { fragment: true }), 'element', (node) => {
    if (node.tagName !== 'a') return
    let badge: string | undefined
    visit(node, 'element', (child) => { if (child.properties.dataApiKind) badge = String(child.properties.dataApiKind) })
    found.push({ href: String(node.properties.href), text: text(node as never), badge })
  })
  return found
}

it('rewrites roles to the pages that document their targets and leaves the rest as code', () => {
  expect(restToMarkdown(':func:`~libtmux_mcp.tools.hook_tools.show_hooks` lists them.', py))
    .toBe('[`show_hooks`](/py/stable/mcp/tools/show_hooks/) lists them.')
  expect(restToMarkdown('Returns :class:`~libtmux_mcp.models.HookEntry` rows.', py))
    .toBe('Returns [`HookEntry`](/py/stable/mcp/reference/libtmux_mcp-models-hookentry/) rows.')
  expect(restToMarkdown('See :data:`SHOW_BUFFER_DEFAULT_MAX_LINES`.', py))
    .toMatch(/^See \[`SHOW_BUFFER_DEFAULT_MAX_LINES`\]\(\/py\/stable\/mcp\/reference\/[^)]+\)\.$/)
  // A private helper has no page: the full dotted path stays as code.
  expect(restToMarkdown('described in :func:`libtmux_mcp._utils._coerce_dict_arg`.', py))
    .toBe('described in `libtmux_mcp._utils._coerce_dict_arg`.')
  expect(restToMarkdown('the :attr:`.panes` list', py)).toBe('the `panes` list')
  expect(restToMarkdown('the :func:`~libtmux_mcp.x.y` call', undefined)).toBe('the `y` call')
  expect(restToMarkdown('Set :envvar:`LIBTMUX_SOCKET` or :term:`winlink`.', py)).toBe('Set `LIBTMUX_SOCKET` or winlink.')
})

it('resolves a tool function to its protocol page, not a library symbol of the same name', () => {
  expect(restToMarkdown(':func:`split_window`', py)).toBe('[`split_window`](/py/stable/mcp/tools/split_window/)')
  const send = restToMarkdown(':meth:`libtmux.Pane.send_keys`', py)
  expect(send).toContain('/py/stable/reference/libtmux-pane-send_keys/')
  expect(send).not.toContain('/mcp/tools/')
})

it('links a :doc: role to the upstream site only where the port has one', () => {
  expect(restToMarkdown('See :doc:`/topics/trust` for more.', py)).toBe('See [topics/trust](https://libtmux-mcp.git-pull.com/topics/trust/) for more.')
  expect(restToMarkdown(':doc:`Trust model </topics/trust>`', py)).toBe('[Trust model](https://libtmux-mcp.git-pull.com/topics/trust/)')
  expect(restToMarkdown(':doc:`/topics/trust`', { port: 'ts', version: 'latest' })).toBe('topics/trust')
})

it('turns a directive and its indented body into an aside and resumes the prose', () => {
  const text = 'Log a pane.\n\n.. warning::\n   Writes anywhere. See :func:`split_window`.\n\n   Be careful.\n\nAfter the aside.'
  const markdown = restToMarkdown(text, py)
  expect(markdown).toContain('<aside class="lm-aside lm-aside--caution lm-aside--hybrid" role="note">')
  expect(markdown).toContain('<span>Warning</span>')
  expect(markdown).toContain('Writes anywhere. See [`split_window`](/py/stable/mcp/tools/split_window/).\n\nBe careful.')
  expect(markdown.endsWith('</aside>\n\n\nAfter the aside.') || markdown.endsWith('</aside>\n\nAfter the aside.')).toBe(true)
  expect(markdown).not.toMatch(/\.\. warning::/)
})

it('leaves fenced examples and text without Sphinx markup unchanged', () => {
  const fenced = 'Example:\n\n```rst\n.. warning::\n   :func:`x`\n```\n\nDone.'
  expect(restToMarkdown(fenced, py)).toBe(fenced)
  const plain = 'Use `capture_pane`; times like 12:30:45 and :: stay.'
  expect(restToMarkdown(plain, py)).toBe(plain)
})

it('renders the create_session environment prose with styled literals, a tmux link and no role text', async () => {
  const { description } = (tool('create_session').inputSchema as { properties: { environment: { description: string } } }).properties.environment
  const html = await renderToolDescription(description, { ...py, objectId: 'mcp.tool.create_session' })
  expect(html).not.toMatch(/:func:|:class:/)
  const tree = fromHtml(html, { fragment: true })
  const literals: Record<string, string[]> = {}
  visit(tree, 'element', (node) => {
    if (node.tagName === 'code') literals[(node.children[0] as { value: string }).value] = node.properties.className as string[]
  })
  expect(Object.keys(literals)).toEqual(expect.arrayContaining(['-eKEY=VALUE', 'show-environment', 'libtmux_mcp._utils._coerce_dict_arg']))
  for (const classes of Object.values(literals)) expect(classes).toContain('api-literal')
  expect(literals['show-environment']).toContain('api-literal--link')
  const links = anchors(html)
  expect(links).toEqual([{ href: '/tmux/latest/manual/show-environment/', text: 'show-environment', badge: 'command' }])
  expect(html).toContain('title="tmux command"')
})

it('does not link an argument name to a library symbol that happens to share it', async () => {
  const html = await renderToolDescription(tool('load_buffer').description, { ...py, objectId: 'mcp.tool.load_buffer' })
  expect(anchors(html).some((link) => link.href.includes('logical_name'))).toBe(false)
  expect(anchors(html).some((link) => link.text.includes('buffer_name') && link.href.includes('bufferref-buffer_name'))).toBe(true)
  expect(anchors(html).filter((link) => link.href.endsWith('/mcp/tools/load_buffer/'))).toEqual([])
})

it('keeps plain-text summaries free of markup', () => {
  const summary = plainSummary("Discover live tmux servers under the current user's ``$TMUX_TMPDIR``. More.", 'py')
  expect(summary).toBe("Discover live tmux servers under the current user's $TMUX_TMPDIR. More.")
  expect(plainSummary('Read output. `text` is sent literally.\n\nSecond paragraph.', 'rs')).toBe('Read output. text is sent literally.')
})
