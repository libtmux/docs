/**
 * The parts of a documentation page the verifier reads: its title, headings,
 * anchors, the text under an anchor, and the small text helpers they share.
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', middot: '.', hellip: '...', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' }
export const decode = (text) => text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
  if (name[0] === '#') {
    try { return String.fromCodePoint(name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))) } catch { return whole }
  }
  return ENTITIES[name.toLowerCase()] ?? whole
})
// `<wbr>` marks a place a long name may break, so it joins the words around it.
export const strip = (html) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<wbr\s*\/?>/gi, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
export const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The words of a heading, title or kebab-case anchor compare case-insensitively
 * and whole: `Set` is not in `SetAlgebra`, nor `sort` in `sort!`. A host whose
 * fragments are identifiers is read from its address instead (`addressOf`),
 * because `_`, `-` and `.` are word breaks here and parts of a name there.
 */
export const mentions = (text, symbol) => new RegExp(`(?<![a-z0-9_])${escapeRegExp(symbol.toLowerCase())}(?![a-z0-9_!?])`).test(text.toLowerCase())
// `!` and `?` end names (`sort!`, `empty?`), so they are part of what is compared.
export const compact = (text) => text.toLowerCase().replace(/[^a-z0-9!?]/g, '')

/**
 * What a rendered page offers to prove an identity: its title, headings, the
 * anchors it declares, and the text that sits under each anchor.
 */
export function readPage(html) {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  const headings = [...html.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((match) => ({ level: Number(match[1]), text: strip(match[2]) })).filter((heading) => heading.text)
  const anchors = []
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = match[2] ?? match[3]
    if (value) anchors.push({ id: decode(value), at: match.index, tag: match[1].toLowerCase() })
  }
  return { title, headings, anchors, html }
}

/**
 * The text a fragment opens, bounded by the entry it names. An anchor on a
 * heading, or on a wrapper just before one, opens the text after that heading
 * up to the next. An anchor on an entry (a `dt` in CPython's manual, a rustdoc
 * `section`, a Julia docstring) opens the text up to the next anchor on the
 * same kind of element, or the next heading, whichever comes first; a page
 * that lists its entries one after another has no heading between them.
 */
export function sectionAt(page, fragment) {
  const decoded = safeDecode(fragment)
  const index = page.anchors.findIndex((candidate) => candidate.id === fragment || candidate.id === decoded)
  if (index < 0) return undefined
  const anchor = page.anchors[index]
  const rest = page.html.slice(anchor.at)
  const headings = [...rest.matchAll(/<h[1-4]\b/gi)]
  const opens = headings[0]?.index
  const closes = rest.search(/<\/h[1-4]>/i)
  let from = 0
  let end
  if (closes >= 0 && (opens === undefined || closes < opens)) {
    // The anchor sits inside a heading (the JLS writes an empty `<a name>` there): the section follows it.
    from = closes
    end = opens
  } else if (opens !== undefined && strip(rest.slice(0, opens)).length <= 12) {
    end = headings[1]?.index
  } else {
    end = opens
    const sibling = page.anchors.slice(index + 1).find((candidate) => candidate.tag === anchor.tag && candidate.id !== anchor.id)
    if (sibling) end = end === undefined ? sibling.at - anchor.at : Math.min(end, sibling.at - anchor.at)
  }
  return strip(rest.slice(from, Math.min(end ?? 40_000, from + 40_000)))
}

export const safeDecode = (text) => { try { return decodeURIComponent(text) } catch { return text } }


/** Group `open` ... `close` at one level: the text with each balanced group, and the contents of the first, taken out. */
export function stripGroups(text, open, close) {
  let depth = 0
  let out = ''
  let first
  let current = ''
  for (const char of text) {
    if (char === open) {
      if (depth === 0) current = ''
      else current += char
      depth += 1
    } else if (char === close && depth > 0) {
      depth -= 1
      if (depth === 0) first ??= current
      else current += char
    } else if (depth > 0) {
      current += char
    } else {
      out += char
    }
  }
  return { text: out, first }
}

/** Split on commas that are not inside brackets. */
export function splitTop(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if ('<([{'.includes(char)) depth += 1
    if ('>)]}'.includes(char)) depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}
