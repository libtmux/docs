import type { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'
import { createRowAnchors } from '../lib/row-anchors'

type Root = ReturnType<typeof fromHtml>
type Element = Extract<Root['children'][number], { type: 'element' }>

// A kind mark is aria-hidden decoration; a row's permalink follows the words a reader sees named.
const hidden = (node: Element | Element['children'][number]) =>
  node.type === 'element' && [true, 'true'].includes(node.properties.ariaHidden as boolean | string)
const textOf = (node: Element | Element['children'][number]): string =>
  node.type === 'text' ? node.value : 'children' in node && !hidden(node) ? node.children.map(textOf).join('') : ''

/** Give prose table rows shareable links without wrapping existing API links. */
export interface InventoryTable {
  type: 'std:confval' | 'std:cmdoption' | 'std:envvar' | 'std:term'
  identity: string
  prefix?: string
}

export function rehypeRowAnchors() {
  return (tree: Root, file?: { data?: { astro?: { frontmatter?: { inventoryTables?: Record<string, InventoryTable> } } } }) => {
    const taken: string[] = []
    visit(tree, 'element', (node) => {
      if (typeof node.properties.id === 'string') taken.push(node.properties.id)
    })
    const anchors = createRowAnchors(taken)
    let sectionName = 'Overview'
    visit(tree, 'element', (node, _index, parent) => {
      if (/^h[1-6]$/.test(node.tagName)) {
        anchors.heading(Number(node.tagName[1]), String(node.properties.id ?? textOf(node)))
        sectionName = textOf(node)
      }
      if (node.tagName !== 'tr' || (parent as Element)?.tagName === 'thead') return
      const cells = node.children.filter((child): child is Element => child.type === 'element')
      if (!cells.some((cell) => cell.tagName === 'td')) return
      const cell = cells[0]
      const label = textOf(cell).trim()
      if (!label || cell.children.some((child) => child.type === 'element' && child.properties.dataRowPermalink)) return
      const id = anchors.row(label, typeof node.properties.id === 'string' ? node.properties.id : undefined)
      node.properties.id = id
      const inventory = file?.data?.astro?.frontmatter?.inventoryTables?.[anchors.section]
      if (inventory) {
        const names = label.match(/\$?[A-Z][A-Z0-9_]*|--?[\w-]+|[a-z_][\w.-]*/g) ?? []
        const selected = inventory.type === 'std:term' ? [label.replace(/^"|"$/g, '')]
          : inventory.type === 'std:cmdoption' ? names.filter((name) => name.startsWith('-')) : names
        node.properties.dataInventoryTargets = JSON.stringify(selected.map((name) => ({
          category: inventory.type.slice(4), identity: `${inventory.identity}:${name.replace(/^\$/, '')}`,
          display: `${inventory.prefix ?? ''}${name.replace(/^\$/, '')}`,
          native: [{ type: inventory.type, name: `${inventory.prefix ?? ''}${name.replace(/^\$/, '')}` }],
        })))
      }
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
