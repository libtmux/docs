import type { Element, Root } from 'astro-expressive-code/hast'
import { visit, SKIP } from 'unist-util-visit'
import { keyCap, tmuxKeySequence, tmuxKeysInProse, type ProseItem } from '../lib/tmux-keys'

type Child = Element['children'][number]

/** The inline code of a child, which may be the whole text of a link. */
function inlineCode(child: Child): Element | undefined {
  if (child.type !== 'element') return undefined
  if (child.tagName === 'a' && child.children.length === 1) return inlineCode(child.children[0])
  return child.tagName === 'code' && child.children.every((leaf) => leaf.type === 'text') ? child : undefined
}

const valueOf = (node: Element) => node.children.map((leaf) => leaf.type === 'text' ? leaf.value : '').join('')

/**
 * Mark the tmux keys in inline code as `<kbd>`, such as `C-b d` in a guide.
 *
 * Fenced code is left alone, and so is the Markdown source the exports read.
 * `tmuxKeysInProse` decides which spans are keys.
 */
export function rehypeTmuxKeys() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName === 'pre' || node.tagName === 'kbd') return SKIP
      const items = node.children.map((child): ProseItem => {
        if (child.type === 'text') return { type: 'text', value: child.value }
        const code = inlineCode(child)
        return code ? { type: 'code', value: valueOf(code).trim() } : { type: 'other' }
      })
      const flags = tmuxKeysInProse(items)
      node.children.forEach((child, index) => {
        if (!flags[index] || child.type !== 'element') return
        const keys = tmuxKeySequence(valueOf(inlineCode(child)!), 'key')!
        if (child.tagName === 'a') child.children = [keyCap(keys)]
        else node.children[index] = keyCap(keys)
      })
      return undefined
    })
  }
}
