import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { captureToctree } from '../../scripts/native-shell-context.mjs'
import { nativeToctreeNodes, type NativeNavigationItem } from '../src/lib/native-shell'
import type { SidebarNode } from '../src/lib/api-sidebar'

// Sidebars copied from a built tmuxp artifact (gp-sphinx, gp-furo-theme).
const BASE = '/en/py/latest/api/'
const INDEX_URL = BASE
const COLORS_URL = `${BASE}internals/api/_internal/colors/`

function capture(name: string, pageUrl: string): NativeNavigationItem[] {
  const window = new Window()
  window.document.body.innerHTML = readFileSync(new URL(`./fixtures/native-toctree/${name}.sidebar.html`, import.meta.url), 'utf8')
  return captureToctree(window.document.querySelector('.sidebar-tree')!, pageUrl)
}

const walk = <T extends { children?: T[] }>(items: T[]): T[] => items.flatMap((item) => [item, ...walk(item.children ?? [])])
const find = (items: NativeNavigationItem[], title: string) => walk(items).find((item) => item.title === title)!

describe('captured Sphinx global toctree', () => {
  const tree = capture('tmuxp-index', INDEX_URL)

  it('keeps the nesting, the caption group and the titles as Sphinx renders them', () => {
    expect(tree.map((item) => item.title)).toEqual(['Quickstart', 'CLI Reference', 'Workspace files', 'Topics', 'Internals', 'Project', 'Changelog', 'More'])
    expect(find(tree, 'CLI Reference').children.map((item) => item.title)).toContain('tmuxp load')
    const colors = find(tree, 'Colors - tmuxp._internal.colors')
    expect(colors.html).toBe('Colors - <code>tmuxp._internal.colors</code>')
    expect(colors.url).toBe(COLORS_URL)
    // Internals > API Reference > Internal Modules > Colors
    const chain = (items: NativeNavigationItem[], target: NativeNavigationItem): string[] | undefined => {
      for (const item of items) {
        if (item === target) return [item.title]
        const below = chain(item.children, target)
        if (below) return [item.title, ...below]
      }
    }
    expect(chain(tree, colors)?.slice(0, 3)).toEqual(['Internals', 'API Reference', 'Internal Modules'])
  })

  it('names the More group by its caption and marks the links that leave the site', () => {
    const more = find(tree, 'More')
    expect(more.caption).toBe(true)
    expect(more.url).toBeUndefined()
    expect(more.children.map((item) => item.title)).toEqual(['The Tao of tmux', 'Migration notes', 'Glossary', 'MCP', 'GitHub'])
    expect(more.children.filter((item) => item.external).map((item) => item.url)).toEqual([
      'https://libtmux-mcp.git-pull.com', 'https://github.com/tmux-python/tmuxp'])
    expect(find(tree, 'Glossary').url).toBe(`${BASE}glossary/`)
  })

  it('is the same tree from a page deep in the hierarchy, whatever its relative hrefs or current marks', () => {
    expect(capture('tmuxp-colors', COLORS_URL)).toEqual(tree)
  })
})

describe('toctree rows', () => {
  const tree = capture('tmuxp-index', INDEX_URL)
  const rows = nativeToctreeNodes(tree, COLORS_URL)
  const all = walk<SidebarNode>(rows)

  it('opens the ancestors of the current page and nothing else', () => {
    const current = all.filter((node) => node.current)
    expect(current.map((node) => node.href)).toEqual([COLORS_URL])
    const open = all.filter((node) => node.expanded).map((node) => node.label)
    expect(open).toEqual(['Internals', 'API Reference', 'Internal Modules'])
    expect(all.find((node) => node.label === 'CLI Reference')!.expanded).toBe(false)
  })

  it('renders captions as headings above their entries and externals as external rows', () => {
    const index = rows.findIndex((node) => node.heading)
    expect(rows[index]).toMatchObject({ label: 'More', heading: true })
    expect(rows.slice(index + 1).map((node) => node.label)).toEqual(['The Tao of tmux', 'Migration notes', 'Glossary', 'MCP', 'GitHub'])
    expect(rows.filter((node) => node.external).map((node) => node.label)).toEqual(['MCP', 'GitHub'])
    expect(all.find((node) => node.label.startsWith('Colors'))!.labelHtml).toContain('<code>')
  })

  it('marks no row current away from the toctree, and never labels a row with an id', () => {
    expect(walk<SidebarNode>(nativeToctreeNodes(tree, `${BASE}genindex/`)).some((node) => node.current)).toBe(false)
    for (const node of all) {
      expect(node.label).not.toMatch(/^page:/)
      expect(node.label.trim()).not.toBe('')
    }
  })
})
