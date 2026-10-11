import { fromHtml } from 'hast-util-from-html'
import { h, select, toHtml, type Element, type Root } from 'astro-expressive-code/hast'
import { visit } from 'unist-util-visit'
import { highlight } from './highlight'
import { rowAnchor } from './row-anchors'

function text(node: Root['children'][number]): string {
  return node.type === 'text' ? node.value : 'children' in node ? node.children.map(text).join('') : ''
}

const punctuation: Record<string, string> = {
  '!': 'exclamation',
  '"': 'double-quote',
  '#': 'hash',
  $: 'dollar',
  '%': 'percent',
  '&': 'ampersand',
  "'": 'single-quote',
  '(': 'left-parenthesis',
  ')': 'right-parenthesis',
  '*': 'asterisk',
  ',': 'comma',
  '-': 'minus',
  '.': 'period',
  ':': 'colon',
  ';': 'semicolon',
  '=': 'equals',
  '?': 'question',
  '[': 'left-bracket',
  ']': 'right-bracket',
  '{': 'left-brace',
  '}': 'right-brace',
  '~': 'tilde',
  '/': 'slash',
  '\\': 'backslash',
}

/** Keep lower-case keys distinct from Shift keys and punctuation addressable. */
function entryName(label: string): string {
  if (punctuation[label]) return punctuation[label]
  if (/^[A-Z]$/.test(label)) return `shift-${label.toLowerCase()}`
  if (/^-[A-Z]$/.test(label)) return `flag-capital-${label.slice(1).toLowerCase()}`
  if (/^-[a-z0-9]$/.test(label)) return `flag-${label.slice(1)}`
  return label.replace(/\bC-/g, 'ctrl-').replace(/\bM-/g, 'alt-').split(/\s+/).slice(0, 3).join(' ')
}

/** Add section-scoped entry links while preserving mandoc's existing anchors. */
export function linkTmuxManualEntries(html: string, namespace = 'manual'): string {
  const tree = fromHtml(html, { fragment: true })
  const used = new Set<string>()
  visit(tree, 'element', (node) => {
    if (node.properties.id) used.add(String(node.properties.id))
  })
  function walk(parent: Element | Root, section: string) {
    for (const node of parent.children) {
      if (node.type !== 'element') continue
      if (node.tagName === 'h2') {
        section = text(node).replace(/\s+/g, ' ').trim() === 'DEFAULT KEY BINDINGS' ? 'default-key-binding' : text(node)
      } else if (node.tagName === 'h3') section = rowAnchor(section, text(node))
      if (node.tagName === 'dt') {
        const label = text(select('code', node) ?? node)
          .replace(/\s+/g, ' ')
          .trim()
        const base = rowAnchor(section, entryName(label))
        let id = base
        for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`
        used.add(id)
        const oldId = node.properties.id
        node.properties.id = id
        node.properties.className = [...((node.properties.className as string[]) ?? []), 'anchored-entry']
        const link = { href: `#${id}`, ariaLabel: `Link to ${label} in ${section.replace(/\s+/g, ' ').trim()}` }
        if (!select('a', node)) node.children = [h('a.row-label-link', link, node.children)]
        else node.children.push(h('a.manual-entry-permalink', link, [h('span', { ariaHidden: 'true' }, '#')]))
        if (oldId) node.children.unshift(h('span', { id: oldId, ariaHidden: 'true' }))
      }
      walk(node, section)
    }
  }
  walk(tree, namespace)
  return toHtml(tree)
}

/** The manual contains both configuration examples and shell transcripts. */
export function tmuxManualLanguage(code: string): string {
  // This first example compares shell, config and binding syntax in one block.
  if (/^\$ /m.test(code) && !/^bind-key /m.test(code)) return 'console'
  if (code.startsWith('/bin/sh ')) return 'tmux-shell'
  if (/^(?:%begin |disallowedWindowOps:)/.test(code)) return 'text'
  return 'tmux-config'
}

/** Use the site's shared grammars and light/dark palette on pinned man-page HTML. */
export async function highlightTmuxManual(html: string): Promise<string> {
  const tree = fromHtml(html, { fragment: true })
  const pending: Promise<void>[] = []
  visit(tree, 'element', (node, index, parent) => {
    const synopsis =
      node.tagName === 'table' && Array.isArray(node.properties.className) && node.properties.className.includes('Nm')
    if ((!synopsis && node.tagName !== 'pre') || !parent || index === undefined) return
    const code = synopsis ? text(node).replace(/\s+/g, ' ').trim() : text(node)
    if (!code.trim()) return
    const language = synopsis ? 'tmux-usage' : tmuxManualLanguage(code)
    pending.push(
      (async () => {
        const rendered = await highlight(code, language)
        if (!rendered) throw new Error(`Cannot highlight tmux manual ${language} block`)
        const replacement = fromHtml(rendered, { fragment: true }).children.find(
          (child): child is Element => child.type === 'element',
        )!
        replacement.properties.className = [...((replacement.properties.className as string[]) ?? []), 'lm-highlighted']
        replacement.properties.dataLanguage = language
        if (node.properties.id) replacement.properties.id = node.properties.id
        parent.children[index] = replacement
      })(),
    )
  })
  await Promise.all(pending)
  return toHtml(tree)
}
