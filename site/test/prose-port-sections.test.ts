import { afterEach, describe, expect, it, vi } from 'vitest'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'

type Element = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Element[] }
const text = (value: string): Element => ({ type: 'text', value })
const element = (tagName: string, ...children: Element[]): Element => ({ type: 'element', tagName, children })

describe('API links in port sections', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('links authored product declarations under the port default in a root build', () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    vi.stubEnv('LIBTMUX_DOCS_PORT_DEFAULTS', '{"go":"stable"}')
    const paragraph = element('p', element('code', text('workspace.Parse')))
    rehypeApiLinks()({ type: 'root', children: [paragraph] }, { data: { astro: { frontmatter: { port: 'go', product: 'workspace' } } } })
    expect(paragraph.children?.[0].properties?.href).toBe('/go/stable/workspace/api/workspace-parse/')
  })

  it('keeps the current product version while preserving core reference URLs', () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'v0.1')
    const product = element('p', element('code', text('workspace.Parse')))
    const core = element('p', element('code', text('tmux.Server')))
    rehypeApiLinks()({ type: 'root', children: [product, core] }, { data: { astro: { frontmatter: { port: 'go', product: 'workspace' } } } })
    expect(product.children?.[0].properties?.href).toBe('/go/v0.1/workspace/api/workspace-parse/')
    expect(core.children?.[0].properties?.href).toBe('/reference/go/tmux-server/')
  })

  it('links symbols and source paths under port headings, including nested sections', () => {
    const first = element('p', element('code', text('Session.panes')))
    const nested = element('p', element('code', text('pane.py')))
    const other = element('p', element('code', text('Session.Panes')))
    const shared = element('p', element('code', text('Session')))
    const tree = {
      type: 'root',
      children: [
        element('h3', text('Python')), first,
        element('h4', text('Implementation')), nested,
        element('h3', text('Go')), other,
        element('h3', text('Shared concepts')), shared,
      ],
    }
    rehypeApiLinks()(tree)
    expect(first.children?.[0].properties?.href).toBe('/reference/py/libtmux-session-panes/')
    expect(nested.children?.[0].properties?.href).toMatch(/github.com\/.*\/src\/libtmux\/pane.py$/)
    expect(other.children?.[0].properties?.href).toBe('/reference/go/tmux-session-panes/')
    expect(shared.children?.[0].tagName).toBe('code')
  })
})
