import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'
import { rowAnchor } from '../src/lib/row-anchors'
import { rehypeRowAnchors } from '../src/plugins/rehype-row-anchors'
import { TMUX_VERSIONS, tmuxCommandNotes, tmuxPageHeadings } from '../src/lib/tmux-reference'
import { SITE_BUILT, sitePath } from './site-root'

const render = (html: string) => {
  const tree = fromHtml(html, { fragment: true })
  rehypeRowAnchors()(tree)
  const rows: { id: unknown; href: unknown; label: unknown }[] = []
  visit(tree, 'element', (node) => {
    if (node.tagName !== 'tr' || !node.properties.id) return
    visit(node, 'element', (child) => {
      if (child.properties.dataRowPermalink) rows.push({
        id: node.properties.id, href: child.properties.href, label: child.properties.ariaLabel,
      })
    })
  })
  return { tree, rows }
}

describe('section and item permalinks', () => {
  it('names option rows consistently across tmux versions', () => {
    const rows = (version: string) => tmuxCommandNotes(version, 'capture-pane')!.groups
      .flatMap((group) => group.options)
    const current = rows('latest')
    expect(current.find((row) => row.flag === 'p')!.id).toBe('capture-pane-options-output-and-line-range-p')
    expect(current.find((row) => row.flag === 'S')!.id).toBe('capture-pane-options-output-and-line-range-s')
    expect(current.find((row) => row.flag === 'e')!.id).toBe('capture-pane-options-text-formatting-e')
    expect(new Set(current.map((row) => row.id)).size).toBe(current.length)
    for (const older of rows('3.2a')) expect(older.id).toBe(current.find((row) => row.flag === older.flag)!.id)
  })

  it('slugifies punctuation and keeps non-Latin labels descriptive', () => {
    expect(rowAnchor('Output and line range', '-b name')).toBe('output-and-line-range-b-name')
    expect(rowAnchor('Query options', 'Café / mode')).toBe('query-options-café-mode')
    expect(rowAnchor('設定', 'ウィンドウ')).toBe('設定-ウィンドウ')
  })

  it('links data rows using their section without changing existing links or header rows', () => {
    const { tree, rows } = render('<h2 id="filters">Filters</h2><table><thead><tr><th>Name</th><th>Meaning</th></tr></thead><tbody><tr><td><a href="/api/">Server</a></td><td>Owner</td></tr></tbody></table>')
    expect(rows).toEqual([{ id: 'filters-server', href: '#filters-server', label: 'Link to Server in Filters' }])
    const links: unknown[] = []
    visit(tree, 'element', (node) => { if (node.tagName === 'a') links.push(node.properties.href) })
    expect(links).toEqual(['/api/', '#filters-server'])
    rehypeRowAnchors()(tree)
    const permalinks: unknown[] = []
    visit(tree, 'element', (node) => { if (node.properties.dataRowPermalink) permalinks.push(node.properties.href) })
    expect(permalinks).toEqual(['#filters-server'])
  })

  it('preserves explicit IDs and avoids collisions with headings and repeated rows', () => {
    const { rows } = render('<h2 id="flags">Flags</h2><span id="flags-p"></span><table><tr><td>-p</td><td>First</td></tr><tr><td>-p</td><td>Second</td></tr><tr id="stable-option"><td>-q</td><td>Third</td></tr></table>')
    expect(rows.map((row) => row.id)).toEqual(['flags-p-2', 'flags-p-3', 'stable-option'])
  })

  it('keeps distinct row identities stable when rows are reordered or inserted', () => {
    const table = (labels: string[]) => `<h3 id="capture-options">Capture options</h3><table>${labels.map((label) => `<tr><td>${label}</td><td>Description</td></tr>`).join('')}</table>`
    const first = render(table(['-p', '-J'])).rows.map((row) => row.id)
    const changed = render(table(['-S start', '-J', '-p'])).rows.map((row) => row.id)
    expect(changed).toEqual(['capture-options-s-start', first[1], first[0]])
  })

  it('includes ancestor sections and resets the path at a sibling heading', () => {
    const row = '<table><tr><td>--json</td><td>Output JSON</td></tr></table>'
    const { rows } = render(`<h1 id="ls">ls</h1><h2 id="options">Options</h2>${row}<h3 id="formatting">Formatting</h3>${row}<h2 id="examples">Examples</h2>${row}`)
    expect(rows.map((entry) => entry.id)).toEqual(['ls-options-json', 'ls-options-formatting-json', 'ls-examples-json'])
    expect(render(`<h1 id="ls">ls</h1><h2 id="ls-options">Options</h2>${row}`).rows[0].id)
      .toBe('ls-options-json')
  })
})

describe.skipIf(!SITE_BUILT)('rendered option permalinks', () => {
  it('gives published prose table rows a section-qualified permalink', () => {
    const tree = fromHtml(readFileSync(sitePath('tmux/topics/options-and-hooks/index.html'), 'utf8'))
    const ids: string[] = []
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'tr' || typeof node.properties.id !== 'string') return
      ids.push(node.properties.id)
      const rowLinks: string[] = []
      visit(node, 'element', (child) => {
        if (child.properties.dataRowPermalink !== undefined) rowLinks.push(String(child.properties.href))
      })
      expect(rowLinks).toEqual([`#${node.properties.id}`])
    })
    expect(ids).toContain('tmux-version-compatibility-pane-title-changed-hook')
  })

  it.each(TMUX_VERSIONS)('keeps %s sections, option rows and Markdown links aligned', (version) => {
    const path = `tmux/${version}/reference/capture-pane`
    const html = readFileSync(sitePath(path, 'index.html'), 'utf8')
    const markdown = readFileSync(sitePath(`${path}.md`), 'utf8')
    const tree = fromHtml(html)
    const ids: string[] = []
    const links: string[] = []
    visit(tree, 'element', (node) => {
      if (typeof node.properties.id === 'string') ids.push(node.properties.id)
      if (typeof node.properties.href === 'string') links.push(node.properties.href)
    })
    const notes = tmuxCommandNotes(version, 'capture-pane')!
    for (const heading of tmuxPageHeadings(version, 'capture-pane')) {
      expect(ids.filter((id) => id === heading.slug)).toHaveLength(1)
      expect(links).toContain(`#${heading.slug}`)
    }
    for (const group of notes.groups) {
      expect(ids).toContain(group.legacyId)
      for (const option of group.options) {
        expect(ids.filter((id) => id === option.id)).toHaveLength(1)
        expect(links).toContain(`#${option.id}`)
        expect(markdown).toContain(`/en/${path}/#${option.id})`)
      }
    }
    expect(ids).toEqual(expect.arrayContaining(['examples', 'syntax', 'behavior', 'guides', 'libraries']))
  })
})
