/**
 * Qualified API names on one line (design record 0069).
 *
 * A name that does not fit is cut at its separators (`.`, `::`, `#`, `/`, `:`), never inside a component, keeping the
 * rightmost components first: `io.github.libtmux.kotlin.Pane.capture` becomes `…kotlin.Pane.capture`. The owner
 * (`io.github.libtmux`, `com.acme`) is kept whole or not at all, and counts only when its peers do not all share it.
 * A form two peers would share loses to one that tells them apart, and a call's argument list goes before its owner:
 * `Server.capture(_:includingHistory:)` becomes `Server.capture(…)`. Widths are measured in the label's own font.
 */
const DNS_ROOTS = new Set(['com', 'org', 'net', 'io', 'dev', 'edu', 'gov', 'app', 'me'])
const HOSTED = new Set(['com.github', 'io.github', 'com.gitlab', 'io.gitlab'])
const THREE_PART = new Set(['uk.co', 'co.uk', 'com.au', 'co.jp', 'com.br'])

interface Part { separator: string; text: string }

/** Components with the separator before each; brackets, backticks and an arity suffix (`/2`) stay inside their component. */
function split(name: string): Part[] | null {
  const parts: Part[] = []
  let start = 0, depth = 0, quoted = false, separator = ''
  for (let i = 0; i < name.length; i++) {
    const c = name[i]!
    if (c === '`') { quoted = !quoted; continue }
    if (quoted) continue
    if ('(<['.includes(c)) { depth++; continue }
    if (')>]'.includes(c)) { depth = Math.max(0, depth - 1); continue }
    if (depth) continue
    const found = name.startsWith('::', i) ? '::'
      : c === '.' || c === '#' || c === ':' || (c === '/' && !/^\/\d+$/.test(name.slice(i))) ? c : ''
    if (!found) continue
    if (i === start) return null
    parts.push({ separator, text: name.slice(start, i) })
    separator = found
    start = i + found.length
    i += found.length - 1
  }
  if (quoted || start >= name.length) return null
  parts.push({ separator, text: name.slice(start) })
  return parts
}

const join = (parts: Part[], from: number, to: number) =>
  parts.slice(from, to).map((part, i) => (i ? part.separator : '') + part.text).join('')

function ownerLength(parts: Part[]): number {
  const two = parts.length > 1 && parts[1]!.separator === '.' ? `${parts[0]!.text}.${parts[1]!.text}` : ''
  const length = HOSTED.has(two) || THREE_PART.has(two) ? 3 : DNS_ROOTS.has(parts[0]!.text) && parts[1]?.separator === '.' ? 2 : 1
  return Math.min(length, parts.length - 1)
}

const sameStart = (a: Part[], b: Part[]) => { let n = 0; while (n < a.length && n < b.length && a[n]!.text === b[n]!.text) n++; return n }
const sameEnd = (a: Part[], b: Part[]) => {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - n - 1]!.text === b[b.length - n - 1]!.text) n++
  return n
}

function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (item) => item.segment)
  return Array.from(text)
}

export interface Abbreviated { text: string; truncated: boolean }

/** The best form of `full` that fits `maxWidth`, measured by `measure`, given the other names shown beside it. */
export function abbreviateQualifiedName(full: string, maxWidth: number, measure: (text: string) => number, peers: readonly string[] = []): Abbreviated {
  if (measure(full) <= maxWidth) return { text: full, truncated: false }
  if (maxWidth <= 0) return { text: '', truncated: true }
  const parts = split(full) ?? [{ separator: '', text: full }]
  const count = parts.length
  const owner = count > 1 ? ownerLength(parts) : 0
  const others = peers.filter((peer) => peer !== full).map(split).filter((peer): peer is Part[] => peer !== null)
    .map((peer) => ({ length: peer.length, head: sameStart(parts, peer), tail: sameEnd(parts, peer) }))
  const ownerShared = others.length > 0 && others.every((peer) => peer.head >= owner)
  let best: { text: string; unique: boolean; score: number; width: number } | undefined
  for (let prefix = 0; prefix < count - 1; prefix++) {
    // "io…capture" says nothing: keep the whole owner or none of it.
    if (prefix > 0 && prefix < owner) continue
    for (let suffix = 1; prefix + suffix < count; suffix++) {
      const text = `${prefix ? join(parts, 0, prefix) : ''}…${join(parts, count - suffix, count)}`
      const width = measure(text)
      if (width > maxWidth) continue
      const unique = !others.some((peer) => peer.length > prefix + suffix && peer.head >= prefix && peer.tail >= suffix)
      const keepsOwner = prefix > 0 && prefix >= owner
      const score = suffix * 100 + (keepsOwner && !ownerShared ? (suffix >= 2 ? 150 : 25) : 0) + (keepsOwner ? 12 * (prefix - owner) : 0)
      if (!best || (unique && !best.unique) || (unique === best.unique && (score > best.score || (score === best.score && width > best.width)))) {
        best = { text, unique, score, width }
      }
    }
  }
  if (best) return { text: best.text, truncated: true }
  const leaf = parts[count - 1]!.text
  // A call's argument list is the skippable part: Server.capture(_:includingHistory:) becomes Server.capture(…).
  const open = leaf.indexOf('(')
  if (open > 0 && leaf.slice(open) !== '(…)' && leaf.endsWith(')')) {
    const bare = `${full.slice(0, full.length - leaf.length + open)}(…)`
    const shorter = abbreviateQualifiedName(bare, maxWidth, measure, peers.filter((peer) => peer !== full))
    if (shorter.text.length > 1) return { text: shorter.text, truncated: true }
  }
  if (measure(leaf) <= maxWidth) return { text: leaf, truncated: true }
  const characters = graphemes(leaf)
  for (let n = characters.length - 1; n >= 1; n--) {
    const text = `${characters.slice(0, n).join('')}…`
    if (measure(text) <= maxWidth) return { text, truncated: true }
  }
  return { text: '…', truncated: true }
}

let canvas: HTMLCanvasElement | undefined

/**
 * Fit every `[data-qn]` label in `root` to its box: the shown span (`[data-qn-show]`) takes the best form, the full name
 * stays in the label's screen-reader text and the row's title. Labels in a closed or hidden panel measure no width and
 * are left as they are.
 */
export function fitQualifiedNames(root: ParentNode): void {
  const labels = [...root.querySelectorAll<HTMLElement>('[data-qn]')]
  if (!labels.length) return
  const names = labels.map((label) => label.dataset.qn ?? '')
  const context = (canvas ??= document.createElement('canvas')).getContext('2d')
  if (!context) return
  labels.forEach((label, i) => {
    const shown = label.querySelector<HTMLElement>('[data-qn-show]')
    if (!shown || !label.clientWidth) return
    const style = getComputedStyle(shown)
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const result = abbreviateQualifiedName(names[i]!, label.clientWidth - 1, (text) => context.measureText(text).width, names)
    if (shown.textContent !== result.text) shown.textContent = result.text
    label.toggleAttribute('data-qn-cut', result.truncated)
  })
}
