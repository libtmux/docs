#!/usr/bin/env node
import { newCheckContext } from './browser-context.mjs'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { chromium } from 'playwright'

/**
 * The kind mark's ink sits centred in its box, and a chip's mark and word are
 * one line of text. Measured from the pixels of real pages, not from the CSS.
 *
 * A mark's box snaps to an even height and its baseline to a whole pixel, so
 * the gap above the ink and the gap below it differ by at most one device
 * pixel, at any sub-pixel position of the line it sits in. A legend chip is one
 * line of text: the mark's baseline and the word's baseline
 * are the same row, and the text run's cap-height block sits within one device
 * pixel of the chip's centre.
 *
 * Samples 1x and a real 2x (a Chromium launched with a device scale factor,
 * which snaps text to device pixels as a hi-dpi screen does; the emulated factor
 * snaps to CSS pixels and is not evidence), light and dark.
 *
 * `p` and `$` are not measured: their ink hangs below the baseline.
 */
/** The version the dev build mounts a port's prose pages at: its default, as check-dev sets it. */
const defaultVersion = (port) => JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}')[port] ?? 'latest'
const PAGES = [
  { label: 'Rust MCP reference', path: '/rs/latest/mcp/reference/mcp-caller-calleridentity-from_env/' },
  { label: 'Python attaching-to-tmux', get path() { return `/py/${defaultVersion('py')}/guides/attaching-to-tmux/` } },
  { label: 'TypeScript reference', path: '/ts/latest/reference/client-client/' },
  { label: 'Go reference', path: '/go/latest/reference/tmux-server-server/' },
  { label: 'tmux manual', path: '/tmux/latest/manual/list-clients/' },
  { label: 'Rust reference index', path: '/rs/latest/reference/' },
  { label: 'Rust type page', path: '/rs/latest/reference/server-server/' },
  { label: 'Rust MCP tools', path: '/rs/latest/mcp/tools/' },
  { label: 'Rust MCP tool', path: '/rs/latest/mcp/tools/create_window/' },
  { label: 'Rust struct', path: '/rs/latest/reference/session-session/' },
  { label: 'TypeScript async method', path: '/ts/latest/reference/server-server-withconnection/' },
  { label: 'TypeScript static attribute', path: '/ts/latest/reference/errors-libtmuxerror-code/' },
  { label: 'TypeScript readonly attribute', path: '/ts/latest/reference/client-client-clientbrand/' },
]
// The runs of linked API names: a mark and a dotted-underlined name, with no chip around them (record 0025).
const LINKED = '.api-elsewhere-value, .api-command-related, .tmux-usage'
// The mark that leads such a name. The badge that leads a mention in a note of the usage table or of an other-port entry is not one.
const LINK_MARK = '.api-nav__kind:where(:not(.api-link-kind))'
// A compact mark that leads a bare name: an index or tool card, a member list row, and a linked name in a run.
const ROW_MARKS = `.api-index-card:not(.api-related-card) .api-index-card__link > .api-nav__kind:first-child, .api-member-list li > span:first-child > .api-nav__kind:first-child, ${LINKED.split(', ').map((s) => `${s} a > ${LINK_MARK}:first-child`).join(', ')}`
const PER_GROUP = 12
// The preview card is out of the way, and the dotted preview underline is ink below the baseline that the measurement would read as the word.
const MEASURING_STYLE = '.reference-link-preview { display: none !important; } *, *::before, *::after { text-decoration: none !important; }'
const SKIP = new Set(['p', '$'])

/** The device pixels of an element and a margin around it, with what the measurement needs to know about it. */
export async function sample(page, handle, kind) {
  // A row in a member box is brought to the middle of the box, where neither its sticky heading nor its edge is in the clip.
  await handle.evaluate((element) => {
    const box = element.closest('.api-member-budget')
    if (!box) return
    const rect = element.getBoundingClientRect()
    const frame = box.getBoundingClientRect()
    box.scrollTop += rect.top - frame.top - (frame.height - rect.height) / 2
  })
  await handle.scrollIntoViewIfNeeded()
  const info = await handle.evaluate((element, kind) => {
    const pick = kind === 'mark' || kind === 'row' || kind === 'mod' ? element.querySelector(':scope > .api-badge__label, .api-badge__label') : kind === 'leg' ? element.querySelector('.api-leg__g') : element.querySelector(':scope > .api-nav__kind > .api-badge__label')
    const word = kind === 'mod' ? pick : kind === 'leg' ? element.querySelector('.api-leg__wl') : null
    const style = getComputedStyle(element)
    // Document coordinates: the screenshot clip is relative to the page, not to the scrolled viewport.
    const rectOf = (node) => { const r = node.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height } }
    const plain = (r) => ({ x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height })
    // A mark that leads a name: the name is whatever follows it, and its first line is what the mark must centre on.
    let name = null
    if (kind === 'row') {
      const range = document.createRange()
      range.setStartAfter(element)
      range.setEndAfter(element.parentElement.lastChild)
      const first = [...range.getClientRects()].find((r) => r.width > 1 && r.height > 1)
      if (first) name = plain(first)
    }
    // The name's own size: a name in a code element is .875em of the link that holds the mark, and its capitals are that size's.
    const nameSize = () => {
      const walker = document.createTreeWalker(element.parentElement, NodeFilter.SHOW_TEXT)
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (text.textContent.trim() && element.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING && !element.contains(text)) return parseFloat(getComputedStyle(text.parentElement).fontSize)
      }
      return parseFloat(getComputedStyle(element.parentElement).fontSize)
    }
    const box = rectOf(element)
    return {
      box, label: pick && rectOf(pick), word: name ?? (word && rectOf(word)),
      gap: name ? name.x - (box.x + box.w) : undefined,
      text: pick?.textContent ?? '', wordFont: kind === 'row' ? nameSize() : word ? parseFloat(getComputedStyle(word).fontSize) : 0,
      border: { top: parseFloat(style.borderTopWidth), bottom: parseFloat(style.borderBottomWidth) },
      dpr: devicePixelRatio,
    }
  }, kind)
  const margin = 6
  // A row's clip spans the mark and the first line of its name.
  const right = info.gap === undefined ? info.box.x + info.box.w : info.word.x + info.word.w
  const clip = { x: Math.max(0, info.box.x - margin), y: Math.max(0, info.box.y - margin), width: right - info.box.x + margin * 2, height: info.box.h + margin * 2 }
  const png = PNG.sync.read(await page.screenshot({ clip, fullPage: true }))
  return { info, clip, png }
}

const channel = (png, x, y) => { const i = (png.width * y + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]] }
const distance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])

function modeColour(png, x0, x1, y0, y1) {
  const counts = new Map()
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const key = channel(png, x, y).join(',')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number)
}

/** The inner box of the element, found from its painted edges, and the ink rows of a label or word inside it. */
export function measure({ info, clip, png }, kind) {
  const dpr = info.dpr
  const toX = (value) => Math.round((value - clip.x) * dpr)
  const background = channel(png, 1, 1)
  const centre = Math.round((toX(info.box.x) + toX(info.box.x + info.box.w)) / 2)
  let top = -1, bottom = -1
  for (let y = 0; y < png.height; y++) if (distance(channel(png, centre, y), background) > 12) { top = y; break }
  for (let y = png.height - 1; y >= 0; y--) if (distance(channel(png, centre, y), background) > 12) { bottom = y; break }
  if (top < 0 || bottom < 0) return undefined
  const border = (width) => (width <= 0 ? 0 : Math.max(1, Math.floor(width * dpr)))
  const inner = { top: top + border(info.border.top), bottom: bottom + 1 - border(info.border.bottom) }
  const columns = (rect) => [Math.max(toX(rect.x), 1), Math.min(toX(rect.x + rect.w), png.width - 1)]
  const rowsOf = (x0, x1) => {
    const region = []
    for (let y = inner.top; y < inner.bottom; y++) { const row = []; for (let x = x0; x < x1; x++) row.push(channel(png, x, y)); region.push(row) }
    const mode = modeColour(png, x0, x1, inner.top, inner.bottom)
    const strength = region.map((row) => Math.max(...row.map((pixel) => distance(pixel, mode))))
    const peak = Math.max(...strength)
    return { region, mode, strength, peak }
  }
  const [lx0, lx1] = columns(info.label)
  const mark = rowsOf(lx0, lx1)
  if (mark.peak < 60) return undefined
  const strong = mark.strength.map((value, index) => (value >= 0.6 * mark.peak ? index : -1)).filter((index) => index >= 0)
  const faint = mark.strength.map((value, index) => (value >= 0.08 * mark.peak ? index : -1)).filter((index) => index >= 0)
  const inkTop = inner.top + strong[0], inkBottom = inner.top + strong.at(-1) + 1
  const out = { dpr }
  // Gap above the ink minus the gap below it, from whole rows and from partly covered edge rows.
  out.whole = (inkTop - inner.top) - (inner.bottom - inkBottom)
  const coverage = (index) => Math.min(1, mark.strength[index] / mark.peak)
  const subTop = inner.top + faint[0] + (1 - coverage(faint[0]))
  const subBottom = inner.top + faint.at(-1) + coverage(faint.at(-1))
  out.fine = (subTop - inner.top) - (inner.bottom - subBottom)
  if (info.gap !== undefined) { out.gap = info.gap; out.font = info.wordFont }
  if (kind !== 'mark' && info.word) {
    const [wx0, wx1] = columns(info.word)
    const word = rowsOf(wx0, wx1)
    const density = word.region.map((row) => row.filter((pixel) => distance(pixel, word.mode) >= 0.5 * word.peak).length)
    const densest = Math.max(...density)
    let baseline = inner.top + Math.max(...density.map((value, index) => (value >= 0.35 * densest ? index : -1))) + 1
    if (kind === 'row') {
      // A name carries descenders (g, p, y, _), which fool the densest-rows rule. Most letters end on the baseline, so it is the row where the most columns of ink end.
      const ends = new Map()
      for (let column = 0; column < word.region[0].length; column++) {
        for (let y = word.region.length - 1; y >= 0; y--) {
          if (distance(word.region[y][column], word.mode) >= 0.5 * word.peak) { ends.set(y, (ends.get(y) ?? 0) + 1); break }
        }
      }
      baseline = inner.top + [...ends.entries()].sort((a, b) => b[1] - a[1])[0][0] + 1
    }
    const cap = info.wordFont * 0.698 * dpr
    out.baselineGap = baseline - inkBottom
    out.runCentre = (baseline - cap / 2) - (inner.top + inner.bottom) / 2
    // A mark that leads a name is raised so its ink, not its box, shares the name's centre (kind-marks.css): an x-height letter
    // sits low in its box by design.
    if (kind === 'row') out.inkRunCentre = (baseline - cap / 2) - (inkTop + inkBottom) / 2
  }
  return out
}

/** A violation is more than one device pixel by whole rows and by partial rows; a chip's baselines must be the same row. */
export function judge(label, result, kind, { skipBaseline = false } = {}) {
  if (!result) return []
  const failures = []
  if (kind === 'mark' || kind === 'row') {
    if (Math.abs(result.whole) > 1 && Math.abs(result.fine) > 1.25) failures.push(`${label}: ink is ${result.whole} device px off centre`)
  }
  if (kind === 'mod') {
    // A modifier is one word in an outline: its capitals centre in the chip, as the legend chip's run does.
    if (Math.abs(result.runCentre) > 1) failures.push(`${label}: the word is ${result.runCentre.toFixed(1)} device px off the chip's centre`)
  } else if (kind === 'row') {
    // The name's capitals centre on the mark's ink, and the two do not touch.
    if (Math.abs(result.inkRunCentre) > 1.25) failures.push(`${label}: the name is ${result.inkRunCentre.toFixed(1)} device px off the mark's centre`)
    if (result.gap < 4) failures.push(`${label}: the mark is ${result.gap.toFixed(1)}px from the name`)
    else if (result.gap > 0.75 * result.font) failures.push(`${label}: the mark is ${result.gap.toFixed(1)}px from the name, more than the gap rule allows`)
  } else if (kind !== 'mark') {
    if (!skipBaseline && result.baselineGap !== undefined && Math.abs(result.baselineGap) > 0.5) failures.push(`${label}: the mark and the word are ${result.baselineGap} device px apart on the baseline`)
    if (result.runCentre !== undefined && Math.abs(result.runCentre) > 1) failures.push(`${label}: the text run is ${result.runCentre.toFixed(1)} device px off the chip's centre`)
  }
  return failures
}

const GROUPS = [
  { kind: 'mark', selector: `.api-nav__kind:not(:is(${LINKED.split(', ').map((s) => `${s} a > ${LINK_MARK}`).join(', ')}))`, name: 'mark' },
  // A legend chip's letter glyph and word; an action chip whose mark is an icon (the source button) has no glyph to centre. A chip in a
  // declaration's corner tab is measured from its boxes instead (checkPage): its floor is open onto the declaration (record 0047).
  { kind: 'leg', selector: '.api-leg:has(> .api-leg__m > .api-leg__g):not(.api-corner > *)', name: 'legend chip' },
  { kind: 'row', selector: ROW_MARKS, name: 'card, list and linked-name mark' },
  { kind: 'mod', selector: '.api-badge--mod:not(.api-corner > *)', name: 'modifier chip' },
]


/**
 * What is wrong with a linked name that wraps, from its measured boxes. The link grows with a name that wraps, so the lines
 * of the name stay inside it, the mark stays beside the first line, and no link runs onto the next or out of its column.
 * Kept apart from the measuring so it can be exercised without a browser.
 */
export function judgeChipGrowth(chips) {
  const slack = 0.51
  const problems = []
  for (const chip of chips) {
    const { text, box, mark, lines, rail, where = 'list' } = chip
    if (!lines.length) { problems.push(`${text}: the name has no line to measure`); continue }
    if (lines[0].top < box.top - slack) problems.push(`${text}: the name starts ${(box.top - lines[0].top).toFixed(1)}px above the link's top edge`)
    if (lines.at(-1).bottom > box.bottom + slack) problems.push(`${text}: the name runs ${(lines.at(-1).bottom - box.bottom).toFixed(1)}px past the link's bottom edge`)
    if (Math.max(...lines.map((entry) => entry.right)) > box.right + slack) problems.push(`${text}: the name runs past the link's right edge`)
    if (chip.clipped) problems.push(`${text}: the link clips its name`)
    // The mark leads the first line, level with it, however many lines the name takes.
    const offset = (lines[0].top + lines[0].bottom) / 2 - (mark.top + mark.bottom) / 2
    if (Math.abs(offset) > 1) problems.push(`${text}: the first line of the name is ${Math.abs(offset).toFixed(1)}px ${offset < 0 ? 'above' : 'below'} the centre of the mark`)
    if (box.left < rail.left - slack || box.right > rail.right + slack) problems.push(`${text}: the link runs out of the ${where}`)
  }
  for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
    const a = chips[i].box
    const b = chips[j].box
    const across = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    if (across > slack && down > slack) problems.push(`${chips[j].text}: overlaps ${chips[i].text} by ${down.toFixed(1)}px`)
  }
  return problems
}

/**
 * The boxes and lines of every link of one list on the page, judged by `judgeChipGrowth`: `scope` names the list, the
 * `.tmux-usage` table of senders on a tmux command page. A line is the capitals of the name on that line, from the cap
 * height to the baseline, read from a zero-width probe set in the name's own face (the probe is one `cap` high and stands
 * on the baseline of the first line, and each later line is one line pitch below it). The box of the text would not do: a
 * name is set at line-height 1.4 in a face whose text box is taller than that, so the box of every line sticks out of the
 * link by a pixel or two, though no letter does.
 */
export async function chipGrowthProblems(page, scope) {
  const chips = await page.evaluate(({ list, where }) => {
    const plain = (r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
    return [...document.querySelectorAll(`${list} a:has(> .api-nav__kind:where(:not(.api-link-kind)))`)].filter((a) => a.offsetParent).map((a) => {
      const name = a.querySelector(':scope > .api-nav__kind + code')
      const range = document.createRange()
      range.selectNodeContents(name)
      // A line is every fragment of the name whose top is within a few pixels of the one before it.
      const lines = []
      for (const r of [...range.getClientRects()].filter((entry) => entry.width > 0.5 && entry.height > 0.5).sort((x, y) => x.top - y.top)) {
        const last = lines.at(-1)
        if (last && r.top - last.top <= 3) { last.bottom = Math.max(last.bottom, r.bottom); last.right = Math.max(last.right, r.right) } else lines.push({ top: r.top, bottom: r.bottom, right: r.right })
      }
      // The first line's baseline and the name's cap height. Capitals are .698em of the face when the browser has no `cap` unit.
      const probe = document.createElement('span')
      probe.style.cssText = 'display:inline-block;width:0;height:1cap'
      name.prepend(probe)
      const stand = probe.getBoundingClientRect()
      probe.remove()
      const cap = stand.height || parseFloat(getComputedStyle(name).fontSize) * 0.698
      const pitch = lines.length > 1 ? (lines.at(-1).top - lines[0].top) / (lines.length - 1) : 0
      lines.forEach((line, index) => { line.bottom = stand.bottom + index * pitch; line.top = line.bottom - cap })
      const box = a.getBoundingClientRect()
      return {
        text: name.textContent.trim(), box: plain(box), mark: plain(a.querySelector(':scope > .api-nav__kind').getBoundingClientRect()), lines,
        rail: plain(a.closest(list).getBoundingClientRect()), where,
        clipped: a.scrollHeight > a.clientHeight + 1 || a.scrollWidth > a.clientWidth + 1,
      }
    })
  }, scope)
  return { chips: chips.length, wrapped: chips.filter((chip) => chip.lines.length > 1).length, problems: judgeChipGrowth(chips) }
}

/**
 * A qualifier ("the spec names a first window") sits beside its chip or under it, and the chip keeps the width its name needs
 * unless the cell is narrower than that: a chip that shrank to make room for its qualifier wrapped a name of ten characters in
 * a cell with room to spare. The width a chip needs is read from a copy of it in a box too wide to wrap anything, not by
 * hiding the qualifier, which would let the table lay its columns out again and move the cell being measured.
 */
export async function qualifierProblems(page) {
  return page.evaluate(() => {
    const problems = []
    let asked = 0
    const wide = document.createElement('div')
    wide.className = 'tmux-usage'
    wide.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;inline-size:4000px'
    document.body.append(wide)
    for (const item of document.querySelectorAll('.tmux-usage__item')) {
      const chip = item.querySelector(':scope > a')
      const when = item.querySelector(':scope > .tmux-usage__when')
      if (!chip || !when || !item.offsetParent) continue
      asked++
      const name = chip.textContent.trim()
      // The copy is set in the type the chip is set in, since every length of a chip is in em.
      const type = getComputedStyle(item)
      Object.assign(wide.style, { fontSize: type.fontSize, fontFamily: type.fontFamily, fontWeight: type.fontWeight, letterSpacing: type.letterSpacing })
      const copy = chip.cloneNode(true)
      wide.replaceChildren(copy)
      const needs = copy.getBoundingClientRect().width
      const box = chip.getBoundingClientRect()
      const room = item.getBoundingClientRect().width
      if (box.width < Math.min(needs, room) - 1) problems.push(`${name}: it is ${box.width.toFixed(1)}px wide in ${room.toFixed(1)}px of room and its name needs ${needs.toFixed(1)}px`)
      const qualifier = when.getBoundingClientRect()
      const across = Math.min(qualifier.right, box.right) - Math.max(qualifier.left, box.left)
      const down = Math.min(qualifier.bottom, box.bottom) - Math.max(qualifier.top, box.top)
      if (across > 1 && down > 1) problems.push(`${name}: its qualifier is over it by ${down.toFixed(1)}px`)
    }
    wide.remove()
    return { asked, problems }
  })
}

/**
 * A group heading is one line: the title, the count and the permalink share a baseline.
 * Each is probed with a zero-size inline box, which sits on the baseline of the line it is in.
 */
export async function headingProblems(page) {
  const found = await page.evaluate(() => [...document.querySelectorAll('h2.api-index-summary')].filter((h) => h.offsetParent && h.querySelector('.heading-link')).slice(0, 6).map((heading) => {
    const baseline = (host) => {
      // The link icon is the one flex item of its link: its bottom edge is the link's baseline, where a probe would be centred.
      if (host.matches('.heading-link')) return host.querySelector('svg').getBoundingClientRect().bottom
      const probe = document.createElement('span')
      probe.style.cssText = 'display:inline-block;width:0;height:0'
      host.prepend(probe)
      const y = probe.getBoundingClientRect().bottom
      probe.remove()
      return y
    }
    const parts = { title: heading, count: heading.querySelector(':scope > span'), permalink: heading.querySelector(':scope > .heading-link') }
    return { text: heading.firstChild?.textContent?.trim() ?? '', baselines: Object.fromEntries(Object.entries(parts).filter(([, node]) => node).map(([name, node]) => [name, baseline(node)])) }
  }))
  const problems = []
  for (const { text, baselines } of found) {
    const values = Object.values(baselines)
    if (Math.max(...values) - Math.min(...values) > 0.5) problems.push(`group heading "${text}": title, count and permalink are not on one baseline (${Object.entries(baselines).map(([name, y]) => `${name} ${y.toFixed(1)}`).join(', ')})`)
  }
  return { headings: found.length, problems }
}


/**
 * The protocol sidebar (MCP tools, prompts, resources) is the section menu: overline-headed groups of rows. A row is a label
 * with an optional count and carries no icon or mark (design record 0060), and every row starts its label on one edge. The
 * kind stays on each row for assistive technology (`aria-description`).
 */
export function protocolSidebarProblems(page) {
  return page.evaluate(() => {
    const nav = [...document.querySelectorAll('[data-section-navigation] nav')].find((node) => node.offsetParent)
    if (!nav) return { groups: 0, marks: 0, rows: 0, problems: [] }
    const problems = []
    const groups = [...nav.querySelectorAll('.sidebar-overline')].filter((heading) => heading.offsetParent).length
    const entries = [...nav.querySelectorAll('a.sidebar-link[aria-description]')].filter((row) => row.offsetParent)
    let marks = 0
    const lead = (row) => {
      const first = row.querySelector(':scope > :is(.api-nav__kind, img, svg, span)')
      return (first ?? row).getBoundingClientRect().left
    }
    const edge = entries.length ? Math.min(...entries.map(lead)) : 0
    for (const row of entries) {
      const name = row.textContent.trim().slice(0, 40)
      if (row.querySelector(':scope > :is(.api-nav__kind, img, svg)')) {
        marks++
        problems.push(`"${name}" carries a mark or icon; sidebar rows are labels (record 0060)`)
      }
      const offset = lead(row) - edge
      if (Math.abs(offset) > 1) problems.push(`"${name}" starts ${offset.toFixed(1)}px off the rows' edge`)
    }
    return { groups, marks, rows: entries.length, problems }
  })
}

/**
 * The API tree indents each row whole, mark and label together: a mark sits half a rem from the left of its row at the
 * first two levels and one indent further in for each level after them, so a reader scans down one column of marks per
 * level.
 */
export function apiTreeGutterProblems(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.api-nav')
    if (!nav) return { marks: 0, problems: [] }
    const probe = document.createElement('i')
    probe.style.cssText = 'position: absolute; width: var(--api-nav-indent);'
    nav.append(probe)
    const indent = probe.getBoundingClientRect().width
    probe.remove()
    const start = 0.5 * parseFloat(getComputedStyle(document.documentElement).fontSize)
    const found = [...nav.querySelectorAll('.api-nav__row > .api-nav__kind')].filter((mark) => mark.offsetParent).map((mark) => {
      const row = mark.parentElement
      return { offset: mark.getBoundingClientRect().left - row.getBoundingClientRect().left, level: Number(getComputedStyle(row).getPropertyValue('--level')) }
    })
    const problems = found.filter((entry) => Math.abs(entry.offset - (start + Math.max(0, entry.level - 2) * indent)) > 1)
      .map((entry) => `a level ${entry.level} mark sits ${entry.offset.toFixed(1)}px from its row, not ${(start + Math.max(0, entry.level - 2) * indent).toFixed(1)}px`)
    return { marks: found.length, problems: [...new Set(problems)] }
  })
}

async function checkPage(page, base, entry, scheme, results) {
  await page.goto(`${base}${entry.path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  await page.addStyleTag({ content: MEASURING_STYLE })
  for (const group of GROUPS) {
    const handles = page.locator(group.selector).filter({ visible: true })
    const count = Math.min(await handles.count(), PER_GROUP)
    for (let index = 0; index < count; index++) {
      const handle = handles.nth(index)
      const measured = measure(await sample(page, await handle.elementHandle(), group.kind), group.kind)
      const text = await handle.evaluate((element) => element.textContent.trim().slice(0, 12))
      if (SKIP.has(text.charAt(0)) && (group.kind === 'mark' || group.kind === 'row')) continue
      results.measured++
      results.failures.push(...judge(`${entry.label} (${scheme}) ${group.name} "${text}"`, measured, group.kind, { skipBaseline: SKIP.has(text.charAt(0)) }))
    }
    results.counts[group.name] = (results.counts[group.name] ?? 0) + count
  }
  // A corner-tab chip: painted edges cannot find a box whose floor is open, so the word's cap box (its label is trimmed to cap
  // height) is read against the tab between its borders.
  const corner = await page.evaluate(() => [...document.querySelectorAll('.api-corner > .api-badge')].filter((chip) => chip.offsetParent).flatMap((chip) => {
    const label = chip.querySelector('.api-leg__wl, .api-badge__label')
    if (!label) return []
    const style = getComputedStyle(chip)
    const box = chip.getBoundingClientRect()
    const word = label.getBoundingClientRect()
    const centre = (box.top + Number.parseFloat(style.borderTopWidth) + box.bottom - Number.parseFloat(style.borderBottomWidth)) / 2
    return [{ text: chip.textContent.trim().replace(/\s+/g, ' ').slice(0, 16), offset: (word.top + word.bottom) / 2 - centre }]
  }))
  results.counts['corner chip'] = (results.counts['corner chip'] ?? 0) + corner.length
  for (const { text, offset } of corner) {
    if (Math.abs(offset) > 0.75) results.failures.push(`${entry.label} (${scheme}) corner chip "${text}": the word's cap box is ${offset.toFixed(2)}px off the tab's centre`)
  }
  const protocol = await protocolSidebarProblems(page)
  results.counts['protocol sidebar group'] = (results.counts['protocol sidebar group'] ?? 0) + protocol.groups
  results.counts['protocol sidebar row'] = (results.counts['protocol sidebar row'] ?? 0) + protocol.rows
  results.failures.push(...protocol.problems.map((problem) => `${entry.label} (${scheme}) sidebar: ${problem}`))
  const gutter = await apiTreeGutterProblems(page)
  results.counts['API tree mark'] = (results.counts['API tree mark'] ?? 0) + gutter.marks
  results.failures.push(...gutter.problems.map((problem) => `${entry.label} (${scheme}) API tree: ${problem}`))
  const headings = await headingProblems(page)
  results.counts['group heading'] = (results.counts['group heading'] ?? 0) + headings.headings
  results.failures.push(...headings.problems.map((problem) => `${entry.label} (${scheme}) ${problem}`))
}

/**
 * Prove the gate can fail: shift every label and every chip word two pixels and require the same measurement to notice.
 */
async function negativeControl(page, base, results) {
  const entry = PAGES[6]
  await page.goto(`${base}${entry.path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  await page.addStyleTag({ content: MEASURING_STYLE })
  const style = await page.addStyleTag({ content: '.api-nav__kind > .api-badge__label, .api-leg__wl { translate: 0 2px !important; }' })
  let noticed = 0
  let tested = 0
  const marks = page.locator('.api-nav__kind').filter({ visible: true })
  for (let index = 0; index < Math.min(await marks.count(), 6); index++) {
    const handle = marks.nth(index)
    const text = await handle.evaluate((element) => element.textContent.trim())
    if (SKIP.has(text)) continue
    tested++
    noticed += judge('control', measure(await sample(page, await handle.elementHandle(), 'mark'), 'mark'), 'mark').length
  }
  await style.evaluate((node) => node.remove())
  results.control = noticed
  results.controlTested = tested
  assert(noticed > 0, 'The centring gate noticed no mark shifted by 2px: it cannot fail')

  // A modifier word shifted two pixels inside its chip.
  await page.goto(`${base}${PAGES[10].path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  await page.addStyleTag({ content: MEASURING_STYLE })
  // The page's modifier sits in a declaration's corner tab, at a fractional offset and with its floor open onto the declaration,
  // where painted edges cannot hold a pixel; the control measures a copy of it in its own outline, on whole pixels.
  await page.evaluate(() => {
    const source = [...document.querySelectorAll('.api-badge--mod')].find((element) => element.getBoundingClientRect().width > 0)
    const holder = Object.assign(document.createElement('div'), { id: 'mod-control' })
    holder.style.cssText = 'position: absolute; top: 120px; left: 120px; z-index: 9999; padding: 8px; background: Canvas'
    holder.append(source.cloneNode(true))
    document.body.append(holder)
  })
  const chip = page.locator('#mod-control > .api-badge--mod')
  assert.deepEqual(judge('control', measure(await sample(page, await chip.elementHandle(), 'mod'), 'mod'), 'mod'), [], 'The modifier chip is not centred before the control')
  const shifted = await page.addStyleTag({ content: '.api-badge--mod > .api-badge__label { translate: 0 2px !important; }' })
  results.modControl = judge('control', measure(await sample(page, await chip.elementHandle(), 'mod'), 'mod'), 'mod').length
  await shifted.evaluate((node) => node.remove())
  assert(results.modControl > 0, 'The modifier check did not notice a word shifted off its chip\'s centre')

  // The protocol sidebar: a mark put back on a row, and a row that leaves the shared edge, must each fail (record 0060).
  await page.goto(`${base}${PAGES[8].path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  const sidebar = await protocolSidebarProblems(page)
  assert(sidebar.groups > 0 && sidebar.rows > 1 && sidebar.problems.length === 0, `The protocol sidebar is not clean before the control (${sidebar.groups} groups, ${sidebar.rows} rows): ${sidebar.problems.join('; ')}`)
  const control = async (change) => {
    await page.evaluate((change) => {
      const rows = [...document.querySelectorAll('[data-section-navigation] nav a.sidebar-link[aria-description]')].filter((row) => row.offsetParent)
      const row = rows[1]
      row.dataset.controlRow = ''
      if (change === 'mark') {
        const mark = Object.assign(document.createElement('span'), { className: 'api-nav__kind', innerHTML: '<span class="api-badge__label" data-mark="cap">t</span>' })
        mark.dataset.control = ''
        row.prepend(mark)
      } else row.style.paddingInlineStart = 'calc(var(--sidebar-row-indent, 0px) + 0.5rem)'
    }, change)
    const found = (await protocolSidebarProblems(page)).problems
    await page.evaluate(() => {
      document.querySelectorAll('[data-control]').forEach((node) => node.remove())
      document.querySelectorAll('[data-control-row]').forEach((row) => { row.style.paddingInlineStart = ''; delete row.dataset.controlRow })
    })
    return found
  }
  results.sidebarMarked = (await control('mark')).length
  assert(results.sidebarMarked > 0, 'The sidebar check did not notice a mark on a row')
  results.sidebarOffEdge = (await control('indent')).length
  assert(results.sidebarOffEdge > 0, 'The sidebar check did not notice a row off the shared edge')

  // The API tree: rows that stop indenting a level at a time must fail.
  await page.goto(`${base}${PAGES[6].path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  const gutter = await apiTreeGutterProblems(page)
  assert(gutter.marks > 1 && gutter.problems.length === 0, `The API tree indent is not clean before the control (${gutter.marks} marks): ${gutter.problems.join('; ')}`)
  const ragged = await page.addStyleTag({ content: '.api-nav__row { padding-inline-start: .5rem !important; }' })
  results.gutterControl = (await apiTreeGutterProblems(page)).problems.length
  await ragged.evaluate((node) => node.remove())
  assert(results.gutterControl > 0, 'The indent check did not notice rows that stopped indenting a level at a time')

  // A permalink lifted off the line, and a mark pushed against its name and off its centre.
  await page.goto(`${base}${PAGES[7].path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  await page.addStyleTag({ content: MEASURING_STYLE })
  assert((await headingProblems(page)).problems.length === 0, 'The group headings are not clean before the control')
  const lifted = await page.addStyleTag({ content: 'h2.api-index-summary > .heading-link { vertical-align: 4px !important; }' })
  results.headingControl = (await headingProblems(page)).problems.length
  await lifted.evaluate((node) => node.remove())
  assert(results.headingControl > 0, 'The heading check did not notice a permalink off the baseline')
  const mark = page.locator(ROW_MARKS).filter({ visible: true }).first()
  const touching = await page.addStyleTag({ content: `${ROW_MARKS} { margin-inline-end: 0 !important; top: 3px !important; }` })
  results.rowControl = judge('control', measure(await sample(page, await mark.elementHandle(), 'row'), 'row'), 'row').length
  await touching.evaluate((node) => node.remove())
  assert(results.rowControl > 0, 'The row check did not notice a mark that touches its name and sits off its centre')

  // A linked name sets its name in a code element at .875em of its link: the capitals to centre on are the name's, not the link's.
  await page.goto(`${base}${PAGES[4].path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  await page.addStyleTag({ content: MEASURING_STYLE })
  const linked = await page.locator(`.tmux-usage a > ${LINK_MARK}`).filter({ visible: true, hasText: /^[maf]$/ }).first().elementHandle()
  const nameSize = await linked.evaluate((element) => parseFloat(getComputedStyle(element.nextElementSibling).fontSize))
  const linkSize = await linked.evaluate((element) => parseFloat(getComputedStyle(element.parentElement).fontSize))
  assert(nameSize < linkSize, `The linked name is not smaller than its link (${nameSize}px of ${linkSize}px), so the control cannot tell them apart`)
  const sampled = await sample(page, linked, 'row')
  assert.equal(sampled.info.wordFont, nameSize, 'The row measurement does not read the size of the name')
  assert.deepEqual(judge('control', measure(sampled, 'row'), 'row'), [], 'A linked name is not centred before the control')
  const drifted = await page.addStyleTag({ content: `${ROW_MARKS} { top: 3px !important; }` })
  results.linkedControl = judge('control', measure(await sample(page, linked, 'row'), 'row'), 'row').length
  await drifted.evaluate((node) => node.remove())
  assert(results.linkedControl > 0, 'The row check did not notice a linked-name mark three pixels off its name')
}

export async function checkBadgeCentring(browser, base, { sample: bounded = false } = {}) {
  const results = { measured: 0, failures: [], counts: {}, control: 0, headingControl: 0, rowControl: 0, sidebarMarked: 0, sidebarOffEdge: 0, gutterControl: 0, modControl: 0, linkedControl: 0 }
  // The bounded sample keeps one page for each thing the gate holds: an MCP and a guide page, the API type page (tree gutter, rail, rows) and an MCP tool (sidebar rule).
  const pages = bounded ? [PAGES[0], PAGES[1], PAGES[6], PAGES[8]] : PAGES
  const hi = await chromium.launch({ args: ['--force-device-scale-factor=2', '--window-size=1440,1000'] })
  try {
    for (const [engine, factor] of [[browser, 1], [hi, 2]]) {
      const context = await newCheckContext(engine, base, factor === 1 ? { viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' } : { viewport: null, reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
      // The first request for a reference page compiles it in the dev server, and the index and tool pages are large.
      page.setDefaultNavigationTimeout(60000)
      try {
        for (const scheme of ['light', 'dark']) {
          await page.emulateMedia({ colorScheme: scheme })
          for (const entry of pages) await checkPage(page, base, entry, `${scheme} ${factor}x`, results)
        }
        if (factor === 1) await negativeControl(page, base, results)
      } finally { await context.close() }
    }
  } finally { await hi.close() }
  assert(results.measured > 20, `Only ${results.measured} badge samples were measurable`)
  assert((results.counts['protocol sidebar group'] ?? 0) > 0, 'No protocol sidebar group was measured')
  assert((results.counts['API tree mark'] ?? 0) > 0, 'No API tree mark was measured, so the gutter was not checked')
  assert.deepEqual(results.failures, [], `Badge centring:\n${results.failures.join('\n')}`)
  console.log(`Badge centring: ${results.measured} samples at 1x and a real 2x, light and dark (${Object.entries(results.counts).map(([k, v]) => `${v} ${k}`).join(', ')}); negative controls caught ${results.control} of ${results.controlTested} shifted marks, ${results.headingControl} heading problem and ${results.rowControl} row problems, ${results.sidebarMarked} marked sidebar row and ${results.sidebarOffEdge} row off the edge, ${results.gutterControl} broken indent, ${results.modControl} shifted modifier word and ${results.linkedControl} drifted linked-name mark PASS`)
}

/**
 * The density rule on real pages: within a section, the first mention of a name
 * carries the mark and a later one is a plain link that keeps its kind.
 */
export async function checkMentionDensity(browser, base) {
  const context = await newCheckContext(browser, base, { viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(60000)
  try {
    const violations = (target) => target.evaluate(() => {
      const found = []
      let section = 0
      const seen = new Set()
      const walker = document.createTreeWalker(document.querySelector('main article, main') ?? document.body, NodeFilter.SHOW_ELEMENT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (/^H[1-6]$/.test(node.tagName)) { section++; seen.clear(); continue }
        if (node.tagName !== 'A' || !node.matches('.api-mention, .tmux-mention, .workspace-mention')) continue
        const key = `${section}|${node.getAttribute('href')}`
        const marked = Boolean(node.querySelector(':scope > .api-link-kind'))
        if (seen.has(key)) {
          if (marked) found.push(`later mention of ${node.getAttribute('href')} is marked`)
          if (!node.getAttribute('aria-label') || !node.dataset.apiKind) found.push(`later mention of ${node.getAttribute('href')} lost its kind`)
        } else if (!marked && node.dataset.apiKind === undefined) found.push(`first mention of ${node.getAttribute('href')} is plain`)
        seen.add(key)
      }
      return found
    })
    await page.goto(`${base}/py/${defaultVersion('py')}/guides/attaching-to-tmux/`, { waitUntil: 'load' })
    await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
    const marked = await page.locator('a:has(> .api-link-kind)').count()
    assert(marked > 0, 'No marked mention to check')
    assert.deepEqual(await violations(page), [], 'A section marks a repeated name or plain-links a first one')
    // Control: repeat a marked mention in its own section and require the check to notice.
    await page.evaluate(() => {
      const anchor = document.querySelector('a:has(> .api-link-kind).api-mention, a:has(> .api-link-kind).tmux-mention')
      const clone = anchor.cloneNode(true)
      clone.dataset.control = ''
      anchor.after(' ', clone)
    })
    const caught = await violations(page)
    assert(caught.some((message) => /later mention .* is marked/.test(message)), 'The density check did not notice a repeated marked mention')
    console.log(`Mention density: first mention marked, later plain, kind kept in aria-label (${marked} marked mentions on the guide); negative control caught the repeat PASS`)
  } finally { await context.close() }
}

const USAGE = { list: '.tmux-usage', where: 'usage table' }
// The table breaks its scope columns apart at a container width (TmuxUsage.astro). A name wraps, at its <wbr> points, only
// where a column is narrower than it, which is just past that width; a wider or stacked table gives every name its room.
// Pinning the container makes the wrapping layout the same at any viewport, where the page's own column follows the layout.
const SIDE_BY_SIDE = '.tmux-usage:has(> table) { inline-size: 52rem; }'
const STACKED = '.tmux-usage:has(> table) { inline-size: 40rem; }'

/**
 * The usage table against the rule for a linked name (kind-marks.css, "A linked API name"): the mark leads the name on its
 * first line, a long name wraps at its <wbr> points, the lines of the name stay inside the link, no link runs onto the next
 * or out of its column, and the name's capitals share a centre with the mark's ink. `judgeChipGrowth` reads the boxes of every
 * chip stacked and side by side, and each wrapped name's first line is read from its pixels as `checkBadgeCentring` reads a
 * linked name. A chip with a qualifier keeps the width its name needs. Each control breaks one thing and the check must name it:
 * a link pinned to one line's height, a name below its link, a mark sunk to the last line, a mark off the capitals, a name
 * that cannot wrap, a chip squeezed by its qualifier and one chip moved onto another.
 */
export async function checkUsageChips(browser, base) {
  const context = await newCheckContext(browser, base, { viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(60000)
  const ready = () => page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  const growth = () => chipGrowthProblems(page, USAGE)
  const CHIP = `.tmux-usage a:has(> ${LINK_MARK})`
  /** The first line of every wrapped name, read from pixels: its capitals against the ink of the mark that leads it. */
  const capitals = async () => {
    await page.addStyleTag({ content: MEASURING_STYLE })
    await page.evaluate(({ chip, mark }) => {
      document.querySelectorAll('[data-wrapped-mark]').forEach((node) => node.removeAttribute('data-wrapped-mark'))
      for (const link of document.querySelectorAll(chip)) {
        const name = link.querySelector(`:scope > ${mark} + code`)
        if (link.offsetParent && name.getBoundingClientRect().height > 1.5 * parseFloat(getComputedStyle(name).lineHeight)) link.querySelector(`:scope > ${mark}`).dataset.wrappedMark = ''
      }
    }, { chip: CHIP, mark: LINK_MARK })
    const marks = page.locator('[data-wrapped-mark]')
    const count = Math.min(await marks.count(), 8)
    const problems = []
    let measured = 0
    for (let index = 0; index < count; index++) {
      const handle = marks.nth(index)
      const text = await handle.evaluate((element) => element.nextElementSibling.textContent.trim())
      if (SKIP.has((await handle.evaluate((element) => element.textContent.trim())).charAt(0))) continue
      const result = measure(await sample(page, await handle.elementHandle(), 'row'), 'row')
      if (!result) { problems.push(`${text}: its mark could not be read from the pixels`); continue }
      measured++
      problems.push(...judge(text, result, 'row'))
    }
    return { measured, problems }
  }
  /** A name that fits, one that wraps twice and one that wraps three times, in a cell 8.5rem wide of its own. */
  const addNarrow = () => page.evaluate(() => {
    const model = document.querySelector('.tmux-usage a:has(> .api-nav__kind:where(:not(.api-link-kind)))')
    const box = document.createElement('div')
    box.className = 'tmux-usage'
    box.dataset.control = 'narrow'
    box.style.cssText = 'inline-size:8.5rem;margin:1rem 0'
    // The links of a cell, so that the table's own rules for them apply.
    const links = Object.assign(document.createElement('span'), { className: 'tmux-usage__links' })
    box.append(links)
    for (const name of ['Window#panes', 'Async::Server#list_panes', 'LibTmux::Server#search_panes_with_options']) {
      const chip = model.cloneNode(true)
      chip.querySelector(':scope > .api-nav__kind + code').innerHTML = name.replace(/(::|(?=[#_]))/g, '$1<wbr>')
      links.append(chip)
    }
    model.closest('main, article, body').append(box)
  })
  // A qualified chip in a cell too narrow to hold it and its qualifier side by side: the qualifier goes under the chip, which keeps its size.
  const addQualified = () => page.evaluate(() => {
    const item = [...document.querySelectorAll('.tmux-usage__item')].find((entry) => entry.querySelector(':scope > .tmux-usage__when'))
    const links = item.parentElement.cloneNode(false)
    links.dataset.control = 'qualified'
    links.style.cssText = 'inline-size:11rem;margin:1rem 0'
    links.append(item.cloneNode(true))
    item.closest('.tmux-usage').append(links)
  })
  const fresh = async () => {
    await page.reload({ waitUntil: 'load' })
    await ready()
    await page.addStyleTag({ content: SIDE_BY_SIDE })
  }
  try {
    await page.goto(`${base}/tmux/latest/manual/list-panes/`, { waitUntil: 'load' })
    await ready()
    // Stacked: each language is a block and every name has the room of its cell.
    const stacked = await page.addStyleTag({ content: STACKED })
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tmux-usage > table')).display), 'block', 'The usage table did not stack in a 40rem column')
    const flat = await growth()
    assert(flat.chips > 0, 'No chip of the usage table was measured in the stacked layout')
    assert.deepEqual(flat.problems, [], `A chip of the usage table, stacked:\n${flat.problems.join('\n')}`)
    await stacked.evaluate((node) => node.remove())
    // Side by side, where the columns are squeezed and names wrap.
    await page.addStyleTag({ content: SIDE_BY_SIDE })
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tmux-usage > table')).display), 'table', 'The usage table did not lay its columns side by side in a 52rem column')
    const real = await growth()
    assert(real.wrapped > 0, 'No name of the usage table wrapped in a 52rem column, so growth was not measured where it happens')
    assert.deepEqual(real.problems, [], `A chip of the usage table on the list-panes manual page:\n${real.problems.join('\n')}`)
    // Each chip with a qualifier keeps the width its name needs, and its qualifier is beside it or under it.
    const qualified = await qualifierProblems(page)
    assert(qualified.asked > 0, 'No chip with a qualifier on the list-panes manual page, so none was measured')
    assert.deepEqual(qualified.problems, [], `A qualifier took room from its chip:\n${qualified.problems.join('\n')}`)
    await addNarrow()
    const narrow = await growth()
    assert(narrow.wrapped >= real.wrapped + 2, 'The narrow container did not wrap the long names')
    assert.deepEqual(narrow.problems, [], `A wrapped chip in a narrow container:\n${narrow.problems.join('\n')}`)
    const centred = await capitals()
    assert(centred.measured > Math.min(narrow.wrapped, 8) - 2, `Only ${centred.measured} of ${narrow.wrapped} wrapped names were read from their pixels`)
    assert.deepEqual(centred.problems, [], `A wrapped name is not centred on its mark:\n${centred.problems.join('\n')}`)
    await addQualified()
    const narrowQualified = await qualifierProblems(page)
    assert(narrowQualified.asked === qualified.asked + 1, 'The qualified chip in a narrow cell was not measured')
    assert.deepEqual(narrowQualified.problems, [], `A qualifier took room from its chip in a narrow cell:\n${narrowQualified.problems.join('\n')}`)
    // Control 1: a link held to one line's height cannot hold a name of two lines, so the name spills out of it.
    await fresh()
    await page.addStyleTag({ content: `${CHIP} { height: 1.4em !important; overflow: hidden !important; }` })
    const pinned = await growth()
    assert(pinned.problems.some((problem) => /past the link's bottom edge/.test(problem)), 'The check did not notice a link too short for its name')
    // Control 2: a name that ends below its link's bottom edge.
    await fresh()
    await page.addStyleTag({ content: `${CHIP} > ${LINK_MARK} + code { margin-bottom: -8px !important; }` })
    const below = await growth()
    assert(below.problems.some((problem) => /runs .* past the link's bottom edge/.test(problem)), 'The check did not notice a name running past its link')
    // Control 3: a mark sunk to the last line of a wrapped name is not on its first line.
    await fresh()
    await page.addStyleTag({ content: `${CHIP} > ${LINK_MARK} { align-self: flex-end !important; }` })
    const sunk = await growth()
    assert(sunk.problems.some((problem) => /the first line of the name is .*px above the centre of the mark/.test(problem)), 'The check did not notice a mark on the last line of a wrapped name')
    // Control 4: a mark three pixels off the capitals of its name, by the boxes and by the pixels of a wrapped name.
    await fresh()
    await page.addStyleTag({ content: `${CHIP} > ${LINK_MARK} { top: 3px !important; }` })
    const drifted = await growth()
    assert(drifted.problems.some((problem) => /px (above|below) the centre of the mark/.test(problem)), 'The check did not notice a mark three pixels off the capitals of its name')
    const drifting = await capitals()
    assert(drifting.problems.some((problem) => /device px off the mark's centre/.test(problem)), 'The pixel reading did not notice a mark three pixels off the capitals of a wrapped name')
    // Control 5: a name with no <wbr> points cannot wrap, so it runs out of its link: the wrap is what holds a long name in.
    await fresh()
    await addNarrow()
    await page.evaluate(() => document.querySelectorAll("[data-control='narrow'] code").forEach((name) => name.replaceChildren(name.textContent)))
    const unwrapped = await growth()
    assert(unwrapped.problems.some((problem) => /runs past the link's right edge/.test(problem)), 'The check did not notice a long name that cannot wrap')
    // Control 6: the layout this replaced, in which the chip shrinks beside a qualifier that cannot wrap, so its name wraps with room to spare.
    await fresh()
    await addQualified()
    await page.addStyleTag({ content: '.tmux-usage__item { flex-wrap: nowrap !important; white-space: nowrap !important; } .tmux-usage__item > a { flex: 0 1 auto !important; } .tmux-usage__when { white-space: nowrap !important; }' })
    const squeezed = await qualifierProblems(page)
    assert(squeezed.problems.some((problem) => /px wide in .*px of room and its name needs/.test(problem)), 'The check did not notice a chip that shrank for its qualifier')
    // Control 7: a chip moved onto the one above it overlaps.
    await fresh()
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('.tmux-usage__item a:has(> .api-nav__kind:where(:not(.api-link-kind)))')]
      const second = items.find((chip, index) => items[index - 1] && chip.closest('.tmux-usage__links') === items[index - 1].closest('.tmux-usage__links')) ?? items[1]
      second.style.transform = 'translateY(-12px)'
    })
    const moved = await growth()
    assert(moved.problems.some((problem) => /overlaps/.test(problem)), 'The check did not notice a link on top of the one above')
    console.log(`Usage chips: ${flat.chips} chips of the list-panes manual page stacked, and ${real.chips} side by side in a 52rem column (${real.wrapped} wrapped), with 3 more in an 8.5rem cell: each inside its link, level with its mark on the first line, clear of the next, with ${centred.measured} wrapped names read from their pixels, and ${qualified.asked + 1} qualified chips at the width their names need; controls caught a pinned height (${pinned.problems.length} problems), a name below its link (${below.problems.length}), a mark on the last line (${sunk.problems.length}), a mark off the capitals (${drifted.problems.length} by boxes, ${drifting.problems.length} by pixels), a name that cannot wrap (${unwrapped.problems.length}), a chip squeezed by its qualifier (${squeezed.problems.length}) and an overlap (${moved.problems.length}) PASS`)
  } finally { await context.close() }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6) ?? 'http://localhost:47392/en'
  const browser = await chromium.launch()
  try {
    await checkBadgeCentring(browser, url, { sample: process.argv.includes('--sample') })
    await checkMentionDensity(browser, url)
    await checkUsageChips(browser, url)
  } finally { await browser.close() }
}
