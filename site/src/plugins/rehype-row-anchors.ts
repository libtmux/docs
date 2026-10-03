import type { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'
import { rowAnchor } from '../lib/row-anchors'

type Root = ReturnType<typeof fromHtml>
type Element = Extract<Root['children'][number], { type: 'element' }>

const textOf = (node: Element | Element['children'][number]): string =>
  node.type === 'text' ? node.value : 'children' in node ? node.children.map(textOf).join('') : ''

/** Give prose table rows shareable links without wrapping existing API links. */
export function rehypeRowAnchors() {
  return (tree: Root) => {
    const used = new Set<string>()
    visit(tree, 'element', (node) => {
      if (typeof node.properties.id === 'string') used.add(node.properties.id)
    })
    const sections: string[] = []
    let section = 'overview'
    let sectionName = 'Overview'
    visit(tree, 'element', (node, _index, parent) => {
      if (/^h[1-6]$/.test(node.tagName)) {
        const depth = Number(node.tagName[1])
        sections.length = depth
        sections[depth - 1] = String(node.properties.id ?? textOf(node))
        section = sections.filter(Boolean).reduce((path, id) =>
          !path || id.startsWith(`${path}-`) ? id : `${path}-${id}`, '')
        sectionName = textOf(node)
      }
      if (node.tagName !== 'tr' || (parent as Element)?.tagName === 'thead') return
      const cells = node.children.filter((child): child is Element => child.type === 'element')
      if (!cells.some((cell) => cell.tagName === 'td')) return
      const cell = cells[0]
      const label = textOf(cell).trim()
      if (!label || cell.children.some((child) => child.type === 'element' && child.properties.dataRowPermalink)) return
      const stem = rowAnchor(section, label)
      let id = typeof node.properties.id === 'string' ? node.properties.id : stem
      if (!node.properties.id) {
        let suffix = 2
        while (used.has(id)) id = `${stem}-${suffix++}`
      }
      used.add(id)
      node.properties.id = id
      node.properties.className = [...(Array.isArray(node.properties.className) ? node.properties.className : []), 'anchored-entry']
      cell.properties.className = [...(Array.isArray(cell.properties.className) ? cell.properties.className : []), 'row-anchor-cell']
      cell.children.push({
        type: 'element', tagName: 'a',
        properties: {
          href: `#${id}`, className: ['row-anchor-link'], dataRowPermalink: true,
          dataPagefindIgnore: 'all', ariaLabel: `Link to ${label} in ${sectionName}`,
        },
        children: [{ type: 'text', value: '¶' }],
      })
    })
  }
}
