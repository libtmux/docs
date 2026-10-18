/** Link option, hook and format mentions inside the manual's rendered HTML. */
import { fromHtml } from 'hast-util-from-html'
import { toHtml, type Element, type Root } from 'astro-expressive-code/hast'
import { tmuxCatalogMentions } from './tmux-catalog-links'
import { tmuxCatalogHref, type CatalogKind } from './tmux-catalog'

type Parent = Element | Root
type Child = Parent['children'][number]

const text = (node?: Child): string => !node ? '' : node.type === 'text' ? node.value
  : 'children' in node ? node.children.map(text).join('') : ''
const classes = (node: Element) => (Array.isArray(node.properties.className) ? node.properties.className.map(String) : [])
const SKIP = new Set(['a', 'pre', 'script', 'style'])

/** The `Ic` literal that names a definition, found at any depth of its term. */
function termName(node: Element): Element | undefined {
  for (const child of node.children) {
    if (child.type !== 'element') continue
    if (child.tagName === 'code' && classes(child).includes('Ic')) return child
    const found = termName(child)
    if (found) return found
  }
  return undefined
}

/**
 * Wrap names in `Ic` and `Li` literals with links to their catalog entries.
 *
 * mandoc marks command and option names `Ic` and literal examples `Li`, so
 * only those carry a name. `current` is the entry the page is about, which
 * never links to itself. With `definitions`, each option, hook and variable
 * the manual defines also gets a link to its own catalog entry.
 */
export function linkTmuxManualCatalog(
  html: string, version: string, current?: { kind: CatalogKind; name: string }, { definitions = false } = {},
): string {
  const tree = fromHtml(html, { fragment: true })
  let changed = false
  const catalogLink = (kind: CatalogKind, name: string): Element | undefined => {
    const href = tmuxCatalogHref(kind, name, version)
    return href ? { type: 'element', tagName: 'a', properties: { className: ['manual-catalog-link'], href },
      children: [{ type: 'text', value: 'catalog' }] } : undefined
  }
  const define = (node: Element) => {
    if (node.tagName === 'dt') {
      const label = termName(node)
      const name = (label ? text(label) : text(node)).trim().replace(/\[\]$/, '')
      const link = catalogLink(label ? 'option' : 'hook', name)
      if (link) { node.children.push({ type: 'text', value: ' ' }, link); changed = true }
    } else if (node.tagName === 'tr' && typeof node.properties.id === 'string') {
      const cell = node.children.find((child): child is Element => child.type === 'element' && child.tagName === 'td')
      const link = cell && text(cell).trim() === node.properties.id ? catalogLink('format', node.properties.id) : undefined
      if (cell && link) { cell.children.push({ type: 'text', value: ' ' }, link); changed = true }
    }
  }
  const walk = (parent: Parent) => {
    for (let index = 0; index < parent.children.length; index++) {
      const node = parent.children[index]
      if (node.type !== 'element' || SKIP.has(node.tagName)) continue
      if (definitions) define(node)
      const names = classes(node)
      if (node.tagName !== 'code' || !(names.includes('Ic') || names.includes('Li'))) { walk(node); continue }
      // A displayed example is a command line to copy, not a sentence to annotate.
      if (parent.type === 'element' && classes(parent).includes('Bd')) continue
      const literal = text(node)
      const mentions = tmuxCatalogMentions(literal, {
        code: true, version, before: text(parent.children[index - 1]), after: text(parent.children[index + 1]),
      }).filter((mention) => !(current && mention.kind === current.kind && mention.name === current.name))
      if (!mentions.length) continue
      changed = true
      if (mentions.length === 1) {
        parent.children[index] = { type: 'element', tagName: 'a', properties: { href: mentions[0].href }, children: [node] }
      } else if (node.children.every((child) => child.type === 'text')) {
        const pieces: Element['children'] = []
        let end = 0
        for (const mention of mentions) {
          if (mention.start > end) pieces.push({ type: 'text', value: literal.slice(end, mention.start) })
          pieces.push({ type: 'element', tagName: 'a', properties: { href: mention.href }, children: [{ type: 'text', value: mention.text }] })
          end = mention.end
        }
        if (end < literal.length) pieces.push({ type: 'text', value: literal.slice(end) })
        node.children = pieces
      }
    }
  }
  walk(tree)
  return changed ? toHtml(tree) : html
}
