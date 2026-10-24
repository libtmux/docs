/**
 * The parts of a documentation page the verifier reads: its title, headings,
 * anchors, the text under an anchor, and the small text helpers they share.
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', middot: '.', hellip: '...', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', para: '\u00b6', uarr: '\u2191' }
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
  const headings = [...html.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((match) => ({ level: Number(match[1]), text: strip(match[2]), at: match.index, end: match.index + match[0].length })).filter((heading) => heading.text)
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

/**
 * The heading a fragment opens: the one that holds the anchor, or the first that
 * follows it with no text between (an anchor on a wrapper, an empty `<a name>`
 * before the heading). A fragment that sits on an entry has none.
 */
export function headingAt(page, fragment) {
  const decoded = safeDecode(fragment)
  const anchor = page.anchors.find((candidate) => candidate.id === fragment || candidate.id === decoded)
  if (!anchor) return undefined
  const holding = page.headings.find((heading) => heading.at <= anchor.at && anchor.at < heading.end)
  if (holding) return holding.text
  const next = page.headings.find((heading) => heading.at >= anchor.at)
  return next && strip(page.html.slice(anchor.at, next.at)).length <= 12 ? next.text : undefined
}

/** A heading as a reader sees it: one line, without the permalink mark a manual hangs on it. */
export const normalizeHeading = (text) => text.replace(/[\u00b6\u2192\u2191\u200b\ufeff]|\u200c|\u200d/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * The heading a link names, in the words its page gives it: the heading its fragment opens
 * (`#id` when the anchor sits on an entry that has none), and for a link to the page, the
 * heading that carries the page's own section label (`[class.mem]`, as the C++ draft writes it),
 * else the top heading that carries the last word of its address, else the top heading its title
 * begins with (a book's title heads every page, and a page may end in "Contributors"), else its first
 * top heading that is not the site's name (a manual's title bar is a heading above the page's own),
 * else its title.
 */
export function pageHeading(page, fragment, url) {
  if (fragment) return normalizeHeading(headingAt(page, fragment) ?? `#${safeDecode(fragment)}`)
  const slug = url ? decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '').replace(/\.html?$/i, '') : ''
  const labelled = slug ? page.headings.find((candidate) => candidate.text.replace(/\s+/g, '').endsWith(`[${slug}]`.replace(/\s+/g, ''))) : undefined
  if (labelled) return normalizeHeading(labelled.text)
  const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
  const title = normalizeHeading(page.title).toLowerCase()
  const tops = page.headings.filter((candidate) => candidate.level === 1).map((candidate) => normalizeHeading(candidate.text)).filter(Boolean)
  const addressed = slug.length >= 3 ? tops.find((text) => squash(text).includes(squash(slug))) : undefined
  const named = tops.filter((text) => title.startsWith(text.toLowerCase())).sort((a, b) => b.length - a.length)[0]
  const site = title.split(/\s+[-|\u2013\u2014]\s+/).slice(1).map((part) => part.trim())
  const own = tops.filter((text) => !site.includes(text.toLowerCase()))
  return addressed ?? named ?? own[0] ?? tops[0] ?? normalizeHeading(page.title)
}
