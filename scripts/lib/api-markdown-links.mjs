/**
 * The links a hand-written text writes, as pairs of the words and the address, read the way a
 * Markdown parser reads them.
 *
 * Four patterns once stood for "a link": inline, reference with a definition, a glossary pair, and
 * nothing else. A link with a title, an autolink, a collapsed or shortcut reference, a `<url>`
 * definition, a raw `<a>` or code with brackets in its words was collected with no words and never
 * judged. So the text is parsed (`mdast-util-from-markdown`), every link node yields its pair, and
 * every address on an API host that no pair accounts for is reported as loose: written outside a
 * link, in a code span or fence, in front matter, or in a definition nothing uses. The verifier
 * fails a loose address, so a form this parser does not know cannot pass by being missed.
 */

import { fromMarkdown } from 'mdast-util-from-markdown'

/**
 * An address as the browser reads it, so that the same page is one destination however it was written: the
 * scheme and host in lower case, a protocol-relative `//host` on https, a bare `www.` host on http, and no
 * dot after the host. The path and fragment are kept as written.
 */
export function normalizeAddress(url) {
  const bare = /^www\./i.test(url) ? `http://${url}` : url
  const parts = /^(?:([a-z][a-z0-9+.-]*):)?\/\/([^/?#]*)(.*)$/is.exec(bare)
  if (!parts) return url
  return `${(parts[1] ?? 'https').toLowerCase()}://${parts[2].replace(/\.+(?=:\d+$|$)/, '').toLowerCase()}${parts[3]}`
}

/**
 * The addresses a text writes, with where each starts and ends, without the punctuation of the sentence
 * around them. An address is written the ways a Markdown renderer links it: `https://` or `http://` in
 * any case, a protocol-relative `//host`, and a bare `www.` host, which GFM turns into a link.
 */
export function occurrencesIn(text) {
  const found = []
  for (const match of text.matchAll(/(?:https?:\/\/|(?<![\w:/.-])\/\/(?=[a-z0-9])|(?<![\w./-])www\.(?=[a-z0-9]))[^\s'"`)<>\]\\|]+/gi)) {
    const url = match[0].replace(/[.,;:*_]+$/, '')
    if (url.includes('${')) continue
    found.push({ url, start: match.index, end: match.index + url.length })
  }
  return found
}

const plain = (html) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
// A Markdown parser reads an anchor with a quoted address as HTML. One with an unquoted address (`<a href=https://x.org>`) it reads as text,
// and the address in it is found loose.
const WHOLE_ANCHOR = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi
const OPEN_ANCHOR = /^\s*<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>\s*$/i
const CLOSE_ANCHOR = /^\s*<\/a\s*>\s*$/i

/** The addresses of a text that no pair covers. */
function looseIn(text, covered) {
  const loose = new Set()
  for (const { url, start, end } of occurrencesIn(text)) {
    if (!covered.some(([from, to]) => from <= start && end <= to)) loose.add(url)
  }
  return [...loose]
}

/**
 * Every link a Markdown text writes: `[words](url)` with or without a title, `<url>`, `[words][ref]`,
 * `[words][]`, `[words]` with a definition, and `<a href>` in raw HTML. A definition counts only
 * where a reference uses it.
 *
 * @param {string} text
 * @param {{ front?: number }} [options] `front` is how many characters of `text` are front matter: data, not prose,
 *   so no link in it is read, and an address in it is loose.
 * @returns {{ pairs: { label: string, url: string }[], loose: string[] }}
 */
export function markdownLinks(text, { front = 0 } = {}) {
  const tree = fromMarkdown(text.slice(0, front).replace(/[^\n]/g, ' ') + text.slice(front))
  const definitions = new Map()
  const collect = (node) => {
    if (node.type === 'definition') definitions.set(node.identifier, node)
    for (const child of node.children ?? []) collect(child)
  }
  collect(tree)
  const pairs = []
  const covered = []
  const used = new Set()
  const offsets = (node) => [node.position.start.offset, node.position.end.offset]
  const take = (url, children, range) => {
    const label = children?.length ? text.slice(children[0].position.start.offset, children.at(-1).position.end.offset).replace(/\s+/g, ' ').trim() : ''
    if (!label || !url) return false
    pairs.push({ label, url })
    covered.push(range)
    return true
  }
  const visit = (parent) => {
    const children = parent.children ?? []
    for (let index = 0; index < children.length; index += 1) {
      const node = children[index]
      if (node.type === 'link') {
        take(node.url, node.children, offsets(node))
      } else if (node.type === 'linkReference') {
        const definition = definitions.get(node.identifier)
        if (definition && take(definition.url, node.children, offsets(node))) used.add(definition)
      } else if (node.type === 'html') {
        const at = node.position.start.offset
        for (const match of node.value.matchAll(WHOLE_ANCHOR)) {
          const label = plain(match[3])
          if (!label) continue
          pairs.push({ label, url: (match[1] ?? match[2]).replace(/&amp;/g, '&') })
          covered.push([at + match.index, at + match.index + match[0].length])
        }
        // An anchor opened in this node and closed in a later one: `<a href="x">`, the words, `</a>`.
        const open = OPEN_ANCHOR.exec(node.value)
        if (open) {
          const close = children.findIndex((candidate, position) => position > index && candidate.type === 'html' && CLOSE_ANCHOR.test(candidate.value))
          if (close > index) {
            const label = plain(text.slice(node.position.end.offset, children[close].position.start.offset))
            if (label) {
              pairs.push({ label, url: (open[1] ?? open[2]).replace(/&amp;/g, '&') })
              covered.push([at, children[close].position.end.offset])
              index = close
            }
          }
        }
      } else {
        visit(node)
      }
    }
  }
  visit(tree)
  for (const definition of used) covered.push(offsets(definition))
  return { pairs, loose: looseIn(text, covered) }
}

/**
 * The `{ title: '…', url: '…' }` pairs a TypeScript data file writes, and the addresses it writes
 * any other way.
 *
 * @param {string} text
 * @returns {{ pairs: { label: string, url: string }[], loose: string[] }}
 */
export function dataLinks(text) {
  const pairs = []
  const covered = []
  for (const match of text.matchAll(/title:\s*(['"])([^'"\n]+)\1\s*,\s*url:\s*(['"])((?:https?:)?\/\/[^'"\n]+)\3/gi)) {
    pairs.push({ label: match[2], url: match[4] })
    covered.push([match.index, match.index + match[0].length])
  }
  return { pairs, loose: looseIn(text, covered) }
}
