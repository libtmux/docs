import { fromHtml } from 'hast-util-from-html'
import { h, select, selectAll, toHtml, type Element, type Root } from 'astro-expressive-code/hast'
import { visit } from 'unist-util-visit'
import { rowAnchor } from './row-anchors'
import { keyCap, keySpanNodes, tmuxKeyAliases, tmuxKeyList, tmuxKeySequence, tmuxKeysInProse, type KeySpan, type ProseItem } from './tmux-keys'

function text(node: Root['children'][number]): string {
  return node.type === 'text' ? node.value : 'children' in node ? node.children.map(text).join('') : ''
}

const punctuation: Record<string, string> = {
  '!': 'exclamation', '"': 'double-quote', '#': 'hash', '$': 'dollar', '%': 'percent',
  '&': 'ampersand', "'": 'single-quote', '(': 'left-parenthesis', ')': 'right-parenthesis',
  '*': 'asterisk', ',': 'comma', '-': 'minus', '.': 'period', ':': 'colon', ';': 'semicolon',
  '=': 'equals', '?': 'question', '[': 'left-bracket', ']': 'right-bracket',
  '{': 'left-brace', '}': 'right-brace', '~': 'tilde', '/': 'slash', '\\': 'backslash',
}

/** Keep lower-case keys distinct from Shift keys and punctuation addressable. */
function entryName(label: string): string {
  if (punctuation[label]) return punctuation[label]
  if (/^[A-Z]$/.test(label)) return `shift-${label.toLowerCase()}`
  if (/^-[A-Z]$/.test(label)) return `flag-capital-${label.slice(1).toLowerCase()}`
  if (/^-[a-z0-9]$/.test(label)) return `flag-${label.slice(1)}`
  return label.replace(/\bC-/g, 'ctrl-').replace(/\bM-/g, 'alt-').split(/\s+/).slice(0, 3).join(' ')
}

const squash = (value: string) => value.replace(/\s+/g, ' ').trim()
const classes = (node: Element) => Array.isArray(node.properties.className) ? node.properties.className.map(String) : []

// Commands whose descriptions are about key names: a bare `c` there is a key.
const KEY_COMMANDS = new Set(['bind-key', 'unbind-key', 'send-keys', 'send-prefix', 'list-keys'])

/** The element a literal becomes, keeping the id a permalink points at. */
function keyReplacement(node: Element, spans: KeySpan[]): Element {
  const [only] = spans
  const replacement = spans.length === 1 && 'keys' in only ? keyCap(only.keys) : h('span', keySpanNodes(spans))
  if (node.properties.id) replacement.properties.id = node.properties.id
  return replacement
}

/** mandoc quotes a literal as ‘x’; a key cap needs no quotation marks. */
function stripQuotes(parent: Element | Root, index: number) {
  const before = parent.children[index - 1]
  const after = parent.children[index + 1]
  if (before?.type !== 'text' || after?.type !== 'text' || !before.value.endsWith('‘') || !after.value.startsWith('’')) return
  before.value = before.value.slice(0, -1)
  after.value = after.value.slice(1)
}

interface KeyState { section: string }

const isLiteral = (node: Element | Root['children'][number]): node is Element => node.type === 'element' && node.tagName === 'code' && classes(node).includes('Li')

/** Convert one `.Ql` literal or `.Em` name when its text and place say it is a key. */
function markKeyLiteral(parent: Element | Root, index: number, state: KeyState, listed: boolean[], command?: string) {
  const node = parent.children[index] as Element
  if (node.children.some((child) => child.type !== 'text')) return
  const literal = isLiteral(node)
  const value = squash(text(node))
  const inKeyScope = literal && (command ? KEY_COMMANDS.has(command) : state.section === 'KEY BINDINGS')
  const aliases = tmuxKeyAliases(value)
  const keys = aliases ? undefined : tmuxKeySequence(value, inKeyScope || listed[index] ? 'key' : 'mention')
  const spans: KeySpan[] | undefined = aliases
    ? aliases.flatMap((name, position): KeySpan[] => [...(position ? [{ text: '/' }] : []), { keys: [name] }])
    : keys && [{ keys }]
  if (!spans) return
  parent.children[index] = keyReplacement(node, spans)
  if (literal) stripQuotes(parent, index)
}

/** Key tables list keys in their first column or under `vi` and `emacs`. */
function markKeyTable(table: Element) {
  const rows = selectAll('tr', table)
  const header = (rows[0]?.children ?? []).filter((cell): cell is Element => cell.type === 'element').map((cell) => squash(text(cell)))
  const columns = header[0] === 'Key' ? [0] : header.includes('vi') && header.includes('emacs') ? [header.indexOf('vi'), header.indexOf('emacs')] : []
  for (const row of rows.slice(1)) {
    const cells = row.children.filter((cell): cell is Element => cell.type === 'element')
    for (const column of columns) {
      const cell = cells[column]
      if (!cell) continue
      // The first column's literal sits inside its row permalink.
      const only = cell.children.length === 1 ? cell.children[0] : undefined
      const holder = only?.type === 'element' && only.tagName === 'a' ? only : cell
      const spans = tmuxKeyList(text(holder))
      if (!spans || holder.children.some((child) => child.type === 'element' && !(classes(child).includes('Li') && child.children.every((leaf) => leaf.type === 'text')))) continue
      holder.children = keySpanNodes(spans)
    }
  }
}

/**
 * Render the manual's key notation as `<kbd>`.
 *
 * A key counts where the manual uses it as one: key tables, the default
 * binding list, the descriptions of the key commands, and quoted or emphasised
 * names such as ‘C-b c’ and `Tab` anywhere. A bare `c` elsewhere is a literal
 * in a format or a command line, and stays code. `command` names the page when
 * `html` is one command's description rather than the whole manual.
 */
export function markTmuxManualKeys(html: string, command?: string): string {
  const tree = fromHtml(html, { fragment: true })
  const state: KeyState = { section: '' }
  function walk(parent: Element | Root, command?: string) {
    let current = command
    // Decided before any quote is stripped, which the list cue reads.
    const listed = tmuxKeysInProse(parent.children.map((child): ProseItem => child.type === 'text' ? { type: 'text', value: child.value }
      : isLiteral(child) && child.children.every((leaf) => leaf.type === 'text') ? { type: 'code', value: squash(text(child)) } : { type: 'other' }))
    for (let index = 0; index < parent.children.length; index++) {
      const node = parent.children[index]
      if (node.type !== 'element' || node.tagName === 'pre') continue
      const names = classes(node)
      if (node.tagName === 'h2') state.section = squash(text(node))
      else if (node.tagName === 'dt') {
        current = select('code.Ic', node) ? squash(text(select('code.Ic', node)!)) : undefined
        if (state.section === 'DEFAULT KEY BINDINGS' && node.children.every((child) => child.type === 'text')) {
          const spans = tmuxKeyList(text(node))
          if (spans) node.children = keySpanNodes(spans)
        }
      } else if (node.tagName === 'table' && names.includes('Bl-column')) markKeyTable(node)
      else if ((node.tagName === 'code' && names.includes('Li')) || (node.tagName === 'i' && names.includes('Em'))) markKeyLiteral(parent, index, state, listed, current)
      else if (node.tagName === 'dd') walk(node, current)
      else if (!['code', 'i', 'b', 'var'].includes(node.tagName)) walk(node, current)
    }
  }
  walk(tree, command)
  return toHtml(tree)
}

/** Add section-scoped entry links in place, preserving mandoc's existing anchors. */
export function linkTmuxManualTree(tree: Root, namespace = 'manual'): Root {
  const used = new Set<string>()
  visit(tree, 'element', (node) => { if (node.properties.id) used.add(String(node.properties.id)) })
  function walk(parent: Element | Root, section: string) {
    for (const node of parent.children) {
      if (node.type !== 'element') continue
      if (node.tagName === 'h2') {
        section = text(node).replace(/\s+/g, ' ').trim() === 'DEFAULT KEY BINDINGS'
          ? 'default-key-binding' : text(node)
      } else if (node.tagName === 'h3') section = rowAnchor(section, text(node))
      if (node.tagName === 'dt') {
        const label = text(select('code', node) ?? node).replace(/\s+/g, ' ').trim()
        const base = rowAnchor(section, entryName(label))
        let id = base
        for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`
        used.add(id)
        const oldId = node.properties.id
        node.properties.id = id
        node.properties.className = [...(node.properties.className as string[] ?? []), 'anchored-entry']
        const link = { href: `#${id}`, ariaLabel: `Link to ${label} in ${section.replace(/\s+/g, ' ').trim()}` }
        if (!select('a', node)) node.children = [h('a.row-label-link', link, node.children)]
        else node.children.push(h('a.manual-entry-permalink', link, [h('span', { ariaHidden: 'true' }, '#')]))
        if (oldId) node.children.unshift(h('span', { id: oldId, ariaHidden: 'true' }))
      }
      walk(node, section)
    }
  }
  walk(tree, namespace)
  return tree
}

/** Add section-scoped entry links while preserving mandoc's existing anchors. */
export function linkTmuxManualEntries(html: string, namespace = 'manual'): string {
  return toHtml(linkTmuxManualTree(fromHtml(html, { fragment: true }), namespace))
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
  // Link resolution imports this module without loading the highlighter.
  const { highlight } = await import('./highlight')
  const tree = fromHtml(html, { fragment: true })
  const pending: Promise<void>[] = []
  visit(tree, 'element', (node, index, parent) => {
    const synopsis = node.tagName === 'table' && Array.isArray(node.properties.className) && node.properties.className.includes('Nm')
    if ((!synopsis && node.tagName !== 'pre') || !parent || index === undefined) return
    const code = synopsis ? text(node).replace(/\s+/g, ' ').trim() : text(node)
    if (!code.trim()) return
    const language = synopsis ? 'tmux-usage' : tmuxManualLanguage(code)
    pending.push((async () => {
      const rendered = await highlight(code, language)
      if (!rendered) throw new Error(`Cannot highlight tmux manual ${language} block`)
      const replacement = fromHtml(rendered, { fragment: true }).children.find((child): child is Element => child.type === 'element')!
      replacement.properties.className = [...(replacement.properties.className as string[] ?? []), 'lm-highlighted']
      replacement.properties.dataLanguage = language
      if (node.properties.id) replacement.properties.id = node.properties.id
      parent.children[index] = replacement
    })())
  })
  await Promise.all(pending)
  return toHtml(tree)
}
