import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { plainSummary, renderToolDescription, toolSummary } from '../src/lib/mcp-reference'
import { auditHtml, auditPlain, auditPort, MCP_PORTS, type Render } from './mcp-description-audit'

beforeEach(() => vi.stubEnv('LIBTMUX_DOCS_PORT_DEFAULTS', '{"py":"v0.46.2"}'))
afterEach(() => vi.unstubAllEnvs())

const CLEAN = { role: 0, directive: 0, backtick: 0, tmux: 0, literal: 0 }

describe('MCP descriptions, summaries and schema prose on every port', () => {
  it.each(MCP_PORTS)('%s renders without Sphinx markup, bare backticks, unstyled literals or unlinked tmux names', async (port) => {
    const audit = await auditPort(port, renderToolDescription, (object) => plainSummary(object.description, port))
    expect(audit.sources).toBeGreaterThan(0)
    expect(audit.findings).toEqual([])
    expect(audit.counts).toEqual(CLEAN)
    expect(audit.plain).toEqual(CLEAN)
  })

  // What origin/main rendered: Markdown and MCP-name links, with no Sphinx or tmux handling.
  const baseline: Render = async (text) => (await (await createMarkdownProcessor({ syntaxHighlight: false })).render(text)).code

  it('fails the origin/main rendering of the Python sources, naming the report\'s three defects', async () => {
    const audit = await auditPort('py', baseline, (object) => toolSummary(object.description))
    const at = (kind: string, text: string) => audit.findings.some((finding) => finding.kind === kind && finding.object === 'create_session' && finding.text.includes(text))
    expect(at('role', ':func:')).toBe(true)
    expect(at('tmux', 'show-environment')).toBe(true)
    expect(at('literal', '-eKEY=VALUE')).toBe(true)
    expect(audit.findings.some((finding) => finding.kind === 'directive' && finding.object === 'pipe_pane')).toBe(true)
    expect(audit.plain.backtick).toBeGreaterThan(0)
  })

  it('fails a port whose prose carries only unlinked tmux names', async () => {
    const audit = await auditPort('rs', baseline, (object) => toolSummary(object.description))
    expect(audit.findings.some((finding) => finding.kind === 'tmux')).toBe(true)
  })

  it.each([
    ['a role left as text', '<p>See :func:<code class="api-literal">x</code>.</p>', 'role'],
    ['a directive left as text', '<p>.. warning::\n   Careful.</p>', 'directive'],
    ['a backtick pair left as text', '<p>Use ``x`` here.</p>', 'backtick'],
    ['an unstyled literal', '<p>Use <code>x</code> here.</p>', 'literal'],
    ['an unlinked command', '<p>Use <code class="api-literal">show-environment</code> here.</p>', 'tmux'],
    ['an unlinked command in prose', '<p>Run kill-server first.</p>', 'tmux'],
    ['an unlinked option', '<p>Set <code class="api-literal">pane-border-status</code>.</p>', 'tmux'],
  ])('flags %s', (_name, html, kind) => {
    expect(auditHtml(html).map((finding) => finding.kind)).toContain(kind)
  })

  it('passes linked names, executable fences and text that only resembles markup', () => {
    for (const html of [
      '<p>Use <a href="/tmux/latest/manual/show-environment/"><code class="api-literal api-literal--link">show-environment</code></a>.</p>',
      '<pre><code>tmux show-environment\n:func:`x`</code></pre>',
      '<p>Wait 12:30:45 or use <code class="api-literal">max_lines</code>.</p>',
      '<p>Plain prose with no names.</p>',
    ]) expect(auditHtml(html), html).toEqual([])
    expect(auditPlain('Discover live tmux servers.')).toEqual([])
    expect(auditPlain('Use ``x`` and :func:`y`.').map((finding) => finding.kind)).toEqual(['role', 'backtick'])
  })
})
