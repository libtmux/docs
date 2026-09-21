import { describe, expect, it } from 'vitest'
import { documentationAreas, documentationCards, documentationNavigation, sourceGuideFor } from '../src/lib/port-documentation'

describe('port documentation domains', () => {
  it('keeps Ruby packages separate from products and Lua runtime adapters', () => {
    expect(documentationAreas('ruby').map(({ id, kind, package: packageId, product }) => ({ id, kind, package: packageId, product }))).toEqual([
      { id: 'core', kind: 'core', package: 'core', product: undefined },
      { id: 'async', kind: 'companion-package', package: 'async', product: undefined },
      { id: 'mcp', kind: 'product', package: 'mcp', product: 'mcp' },
      { id: 'workspace', kind: 'product', package: 'workspace', product: 'workspace' },
    ])
    expect(documentationAreas('lua').map(({ id, kind, package: packageId, product }) => ({ id, kind, package: packageId, product }))).toEqual([
      { id: 'core', kind: 'core', package: 'core', product: undefined },
      { id: 'runtime', kind: 'runtime', package: undefined, product: undefined },
      { id: 'mcp', kind: 'unavailable', package: undefined, product: 'mcp' },
      { id: 'workspace', kind: 'unavailable', package: undefined, product: 'workspace' },
    ])
  })

  it('derives reader navigation and landing cards without language-specific rendering branches', () => {
    expect(documentationNavigation('ruby', 'latest')).toEqual([
      { label: 'Library', items: [{ type: 'link', label: 'Core library', href: '/ruby/latest/' }] },
      { label: 'Companion packages', items: [{ type: 'link', label: 'Async', href: '/ruby/latest/guides/async/' }] },
      {
        label: 'Products',
        items: [
          { type: 'link', label: 'MCP', href: '/ruby/latest/mcp/' },
          { type: 'link', label: 'Workspace Manager', href: '/ruby/latest/workspace/' },
        ],
      },
    ])
    expect(documentationNavigation('lua', 'latest')).toEqual([
      { label: 'Library', items: [{ type: 'link', label: 'Core library', href: '/lua/latest/' }] },
      { label: 'Runtime adapters', items: [{ type: 'link', label: 'luv and Neovim', href: '/lua/latest/guides/runtime/' }] },
      {
        label: 'Availability',
        items: [
          { type: 'link', label: 'MCP (not available)', href: '/lua/latest/mcp/' },
          { type: 'link', label: 'Workspace Manager (not available)', href: '/lua/latest/workspace/' },
        ],
      },
    ])
    expect(documentationCards('ruby', 'latest').map((card) => card.label)).toEqual(['Async', 'MCP', 'Workspace Manager'])
    expect(documentationCards('lua', 'latest').map((card) => card.label)).toEqual([
      'luv and Neovim',
      'MCP (not available)',
      'Workspace Manager (not available)',
    ])
  })

  it('owns canonical source-guide routes and legacy aliases without duplicating a revision', () => {
    expect(sourceGuideFor('ruby', 'gems/libtmux-async/README.md')).toMatchObject({
      domain: 'async',
      package: 'async',
      route: 'guides/async',
      aliases: ['guides/source/async'],
    })
    expect(sourceGuideFor('lua', 'docs/runtime.md')).toMatchObject({
      domain: 'runtime',
      route: 'guides/runtime',
      aliases: ['guides/source/runtime'],
    })
    expect(sourceGuideFor('lua', 'docs/options-reference.md')).toMatchObject({
      route: 'guides/options',
      aliases: ['guides/source/options'],
    })
    expect(sourceGuideFor('ruby', 'docs/recipes.md')).toMatchObject({
      route: 'examples/recipes',
      aliases: ['examples/source-recipes'],
    })
  })
})
