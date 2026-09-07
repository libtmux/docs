import { describe, expect, it } from 'vitest'
import { rehypeApiLinks } from '../src/plugins/rehype-api-links'

type Element = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Element[] }
const text = (value: string): Element => ({ type: 'text', value })
const element = (tagName: string, ...children: Element[]): Element => ({ type: 'element', tagName, children })

describe('API links in port sections', () => {
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
