import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
    expect(paragraph.children?.[0].properties?.href).toBe('/go/stable/workspace/reference/workspace-parse/')
  })

  it('keeps the current product version while preserving core reference URLs', () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'v0.1')
    const product = element('p', element('code', text('workspace.Parse')))
    const core = element('p', element('code', text('tmux.Server')))
    rehypeApiLinks()({ type: 'root', children: [product, core] }, { data: { astro: { frontmatter: { port: 'go', product: 'workspace' } } } })
    expect(product.children?.[0].properties?.href).toBe('/go/v0.1/workspace/reference/workspace-parse/')
    expect(core.children?.[0].properties?.href).toBe('/go/v0.1/reference/tmux-server/')
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
    expect(first.children?.[0].properties?.href).toBe('/py/latest/reference/libtmux-session-panes/')
    expect(nested.children?.[0].properties?.href).toMatch(/github.com\/.*\/src\/libtmux\/pane.py$/)
    expect(other.children?.[0].properties?.href).toBe('/go/latest/reference/tmux-session-panes/')
    expect(shared.children?.[0].tagName).toBe('code')
  })

  it('leaves a published inventory file plain after a Python fence, without reporting it dangling', () => {
    const report = fileURLToPath(new URL('../.astro/dangling-refs.json', import.meta.url))
    rmSync(report, { force: true })
    const fence = element('pre', element('code'))
    fence.children![0].properties = { className: ['language-python'] }
    const inventory = element('p', element('code', text('objects.inv')), element('code', text('reference/objects.inv')))
    const symbol = element('p', element('code', text('libtmux.Server')))
    const missing = element('p', element('code', text('Nope.thing()')))
    rehypeApiLinks()({ type: 'root', children: [fence, inventory, symbol, missing] })
    expect(inventory.children?.map((child) => child.tagName)).toEqual(['code', 'code'])
    expect(symbol.children?.[0].properties?.href).toBe('/py/latest/reference/libtmux-server/')
    // The control: the gate still records a Python name that nothing defines.
    expect(readFileSync(report, 'utf8').trim().split('\n').map((line) => JSON.parse(line).text)).toEqual(['Nope.thing()'])
  })
})
