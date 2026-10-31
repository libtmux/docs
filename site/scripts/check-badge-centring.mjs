#!/usr/bin/env node
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { chromium } from 'playwright'

/**
 * The kind mark's ink sits centred in its box, and a chip's mark and word are
 * one line of text. Measured from the pixels of real pages, not from the CSS.
 *
 * A mark's box snaps to an even height and its baseline to a whole pixel, so
 * the gap above the ink and the gap below it differ by at most one device
 * pixel, at any sub-pixel position of the line it sits in. A legend chip or a
 * split chip is one line of text: the mark's baseline and the word's baseline
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
const SPLIT = '.api-elsewhere-value, .api-command-related, nav.api-related'
// The cap of a split chip. The badge that leads a mention in a note of the usage table or of an other-port entry is not one.
const CHIP_MARK = '.api-nav__kind:where(:not(.api-link-kind))'
// A compact mark that leads a bare name: an index or tool card, and a member list row.
const ROW_MARKS = '.api-index-card:not(.api-related-card) .api-index-card__link > .api-nav__kind:first-child, .api-member-list li > span:first-child > .api-nav__kind:first-child'
const PER_GROUP = 12
// The preview card is out of the way, and the dotted preview underline is ink below the baseline that the measurement would read as the word.
const MEASURING_STYLE = '.reference-link-preview { display: none !important; } *, *::before, *::after { text-decoration: none !important; }'
const SKIP = new Set(['p', '$'])

/** The device pixels of an element and a margin around it, with what the measurement needs to know about it. */
export async function sample(page, handle, kind) {
  await handle.scrollIntoViewIfNeeded()
  const info = await handle.evaluate((element, kind) => {
    const pick = kind === 'mark' || kind === 'row' || kind === 'mod' ? element.querySelector(':scope > .api-badge__label, .api-badge__label') : kind === 'leg' ? element.querySelector('.api-leg__g') : element.querySelector(':scope > .api-nav__kind > .api-badge__label')
    const word = kind === 'mod' ? pick : kind === 'leg' ? element.querySelector('.api-leg__wl') : kind === 'split' ? element.querySelector(':scope > .api-nav__kind + code') : null
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
    const box = rectOf(element)
    return {
      box, label: pick && rectOf(pick), word: name ?? (word && rectOf(word)),
      gap: name ? name.x - (box.x + box.w) : undefined,
      text: pick?.textContent ?? '', wordFont: kind === 'row' ? parseFloat(getComputedStyle(element.parentElement).fontSize) : word ? parseFloat(getComputedStyle(word).fontSize) : 0,
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
    // The name's capitals centre on the mark, and the two do not touch.
    if (Math.abs(result.runCentre) > 1.25) failures.push(`${label}: the name is ${result.runCentre.toFixed(1)} device px off the mark's centre`)
    if (result.gap < 4) failures.push(`${label}: the mark is ${result.gap.toFixed(1)}px from the name`)
    else if (result.gap > 0.75 * result.font) failures.push(`${label}: the mark is ${result.gap.toFixed(1)}px from the name, more than the gap rule allows`)
  } else if (kind !== 'mark') {
    if (!skipBaseline && result.baselineGap !== undefined && Math.abs(result.baselineGap) > 0.5) failures.push(`${label}: the mark and the word are ${result.baselineGap} device px apart on the baseline`)
    if (result.runCentre !== undefined && Math.abs(result.runCentre) > 1) failures.push(`${label}: the text run is ${result.runCentre.toFixed(1)} device px off the chip's centre`)
  }
  return failures
}

const GROUPS = [
  { kind: 'mark', selector: `.api-nav__kind:not(:is(${SPLIT.split(', ').map((s) => `${s} a > ${CHIP_MARK}`).join(', ')}))`, name: 'mark' },
  { kind: 'leg', selector: '.api-leg', name: 'legend chip' },
  { kind: 'split', selector: SPLIT.split(', ').map((s) => `${s} a:has(> ${CHIP_MARK})`).join(', '), name: 'split chip' },
  { kind: 'row', selector: ROW_MARKS, name: 'card and list mark' },
  { kind: 'mod', selector: '.api-badge--mod', name: 'modifier chip' },
]


/**
 * The related-APIs chips in the contents column: each is one outlined box that
 * contains its mark and its name, with the mark as its cap (flush with the top-left
 * corner inside the border, as tall as the first line of the name), no box overlaps
 * the next, and the rows are evenly spaced. Measured from the laid-out boxes, since the
 * failure it guards is a box that does not hold its content.
 *
 * A chip grows with a name that wraps, so padding does not overflow it: it insets the
 * mark from the corner instead, and that is what the flush rule sees.
 */
export async function railProblems(page) {
  const rows = await page.evaluate(() => [...document.querySelectorAll('nav.api-related a:has(> .api-nav__kind)')].filter((a) => a.offsetParent).map((a) => {
    const box = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right } }
    const style = getComputedStyle(a)
    return {
      chip: box(a), mark: box(a.querySelector(':scope > .api-nav__kind')), name: box(a.querySelector(':scope > code')), text: a.textContent.trim(),
      // `min-height` is the height of a chip with a one-line name, which the mark spans however many lines the name takes.
      line: parseFloat(style.minHeight) || a.getBoundingClientRect().height,
      border: { top: parseFloat(style.borderTopWidth) || 0, left: parseFloat(style.borderLeftWidth) || 0 },
      clipped: a.scrollHeight > a.clientHeight + 1 || a.scrollWidth > a.clientWidth + 1,
    }
  }))
  const problems = []
  const slack = 0.51
  for (const row of rows) {
    for (const part of ['mark', 'name']) {
      const inside = row[part].top >= row.chip.top - slack && row[part].bottom <= row.chip.bottom + slack && row[part].left >= row.chip.left - slack && row[part].right <= row.chip.right + slack
      if (!inside) problems.push(`${row.text}: the chip's box does not contain its ${part}`)
    }
    // The mark is the chip's cap: flush with its top-left corner inside the border, and as tall as the first line, which is the whole chip when the name is one line.
    if (Math.abs(row.mark.top - (row.chip.top + row.border.top)) > 1) problems.push(`${row.text}: the mark is not flush with the chip's top edge`)
    if (Math.abs(row.mark.left - (row.chip.left + row.border.left)) > 1) problems.push(`${row.text}: the mark is not flush with the chip's left edge`)
    if (row.mark.bottom - row.mark.top < Math.min(row.chip.bottom - row.chip.top, row.line) - 2 - slack) problems.push(`${row.text}: the mark does not fill the chip's height`)
    // Nothing is clipped by the chip's edge.
    if (row.clipped) problems.push(`${row.text}: the chip clips its content`)
  }
  const gaps = rows.slice(1).map((row, index) => row.chip.top - rows[index].chip.bottom)
  gaps.forEach((gap, index) => { if (gap < 0) problems.push(`${rows[index + 1].text}: overlaps the row above by ${(-gap).toFixed(1)}px`) })
  if (gaps.length && Math.max(...gaps) - Math.min(...gaps) > 1) problems.push(`rows are unevenly spaced: gaps run ${Math.min(...gaps).toFixed(1)} to ${Math.max(...gaps).toFixed(1)}px`)
  return { rows: rows.length, problems }
}

/**
 * What is wrong with a Related APIs chip, from its measured boxes. A chip grows with a name that wraps, so the lines of the
 * name stay inside it, the mark stays one line tall in its corner and level with the first line, and no chip runs onto the next
 * or out of the column. Kept apart from the measuring so it can be exercised without a browser.
 */
export function judgeChipGrowth(chips) {
  const slack = 0.51
  const problems = []
  for (const chip of chips) {
    const { text, box, mark, lines, border, line, rail, where = 'Related APIs column' } = chip
    if (!lines.length) { problems.push(`${text}: the name has no line to measure`); continue }
    const top = box.top + border
    const bottom = box.bottom - border
    if (lines[0].top < top - slack) problems.push(`${text}: the name starts ${(top - lines[0].top).toFixed(1)}px above the chip's top edge`)
    if (lines.at(-1).bottom > bottom + slack) problems.push(`${text}: the name runs ${(lines.at(-1).bottom - bottom).toFixed(1)}px past the chip's bottom edge`)
    if (Math.max(...lines.map((entry) => entry.right)) > box.right - border + slack) problems.push(`${text}: the name runs past the chip's right edge`)
    if (chip.clipped) problems.push(`${text}: the chip clips its name`)
    if (lines.length > 1 && box.bottom - box.top <= line + slack) problems.push(`${text}: the chip is still one line tall, ${(box.bottom - box.top).toFixed(1)}px, for a name of ${lines.length} lines`)
    const markHeight = mark.bottom - mark.top
    if (Math.abs(markHeight - (line - 2 * border)) > 1) problems.push(`${text}: the mark is ${markHeight.toFixed(1)}px tall, not the ${(line - 2 * border).toFixed(1)}px of one line`)
    if (Math.abs(mark.top - top) > slack) problems.push(`${text}: the mark left the top of the chip`)
    const offset = (lines[0].top + lines[0].bottom) / 2 - (mark.top + mark.bottom) / 2
    if (Math.abs(offset) > 1) problems.push(`${text}: the first line of the name is ${Math.abs(offset).toFixed(1)}px ${offset < 0 ? 'above' : 'below'} the centre of the mark`)
    if (box.left < rail.left - slack || box.right > rail.right + slack) problems.push(`${text}: the chip runs out of the ${where}`)
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
 * The boxes and lines of every chip of one list on the page, judged by `judgeChipGrowth`. The list is the Related APIs
 * rail unless `scope` names another: the `.tmux-usage` table of senders on a tmux command page. A line is the box of its
 * text, or with `ink` the box of its letters, from the cap height to the baseline that `text-box` trims the name to: the
 * usage table sets its names in a semibold face whose text box is taller than the chip's letters and not centred on them,
 * so the box of the text would put every name a little above its chip.
 */
export async function chipGrowthProblems(page, scope = { list: 'nav.api-related', where: 'Related APIs column' }) {
  const chips = await page.evaluate(({ list, where, ink }) => {
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
      if (ink) {
        // The trimmed name spans the cap height of its first line to the baseline of its last, so it is one cap height and a line pitch for each line after the first.
        const trimmed = name.getBoundingClientRect()
        const pitch = lines.length > 1 ? (lines.at(-1).top - lines[0].top) / (lines.length - 1) : 0
        const cap = trimmed.height - pitch * (lines.length - 1)
        lines.forEach((line, index) => { line.top = trimmed.top + index * pitch; line.bottom = line.top + cap })
      }
      const style = getComputedStyle(a)
      const box = a.getBoundingClientRect()
      return {
        text: name.textContent.trim(), box: plain(box), mark: plain(a.querySelector(':scope > .api-nav__kind').getBoundingClientRect()), lines,
        border: parseFloat(style.borderTopWidth) || 0, line: parseFloat(style.minHeight) || box.height, rail: plain(a.closest(list).getBoundingClientRect()), where,
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
  const found = await page.evaluate(() => [...document.querySelectorAll('h2.api-index-summary')].filter((h) => h.offsetParent && h.querySelector('.headerlink')).slice(0, 6).map((heading) => {
    const baseline = (host) => {
      const probe = document.createElement('span')
      probe.style.cssText = 'display:inline-block;width:0;height:0'
      host.prepend(probe)
      const y = probe.getBoundingClientRect().bottom
      probe.remove()
      return y
    }
    const parts = { title: heading, count: heading.querySelector(':scope > span'), permalink: heading.querySelector(':scope > .headerlink') }
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
 * The protocol sidebar (MCP tools, prompts, resources): its groups name their
 * kind, so a row carries a mark only in a group that mixes kinds, and the mark
 * is inline at the row's normal gap. There is no gutter: a row without a mark
 * starts its text at the row's indent. The kind stays on every row for
 * assistive technology (`aria-description`).
 */
export function protocolSidebarProblems(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.api-nav[data-marks="mixed"]')
    if (!nav) return { groups: 0, marks: 0, rows: 0, problems: [] }
    const problems = []
    let groups = 0, marks = 0, rows = 0
    for (const group of nav.querySelectorAll('ul[role="group"]')) {
      const entries = [...group.querySelectorAll(':scope > li > a.api-nav__row, :scope > li > div.api-nav__row')].filter((row) => row.offsetParent)
      if (!entries.length) continue
      groups++
      const label = group.closest('li[role="treeitem"]')?.querySelector(':scope > .api-nav__row .api-nav__label')?.textContent?.trim() ?? 'a group'
      const kindOf = (row) => row.getAttribute('aria-description') ?? row.closest('li[role="treeitem"]')?.getAttribute('aria-description') ?? undefined
      const kinds = new Set(entries.map(kindOf).filter(Boolean))
      for (const row of entries) {
        rows++
        const mark = row.querySelector(':scope > .api-nav__kind')
        const name = row.querySelector(':scope .api-nav__label')?.textContent?.trim() ?? ''
        if (kindOf(row) === undefined) continue
        if (mark) marks++
        if (kinds.size <= 1 && mark) problems.push(`"${name}" under "${label}" repeats a kind the group already names`)
        if (kinds.size > 1 && !mark) problems.push(`"${name}" under "${label}" has no mark in a group that mixes kinds`)
        if (!row.matches('a')) continue
        // No gutter: the first thing in the row starts at the row's own indent, and a mark is one gap from the name.
        const indent = row.getBoundingClientRect().left + parseFloat(getComputedStyle(row).paddingLeft)
        const text = row.querySelector(':scope > .api-nav__label')
        const textStart = text.getBoundingClientRect().left + parseFloat(getComputedStyle(text).paddingLeft)
        const lead = mark ? mark.getBoundingClientRect().left : textStart
        if (Math.abs(lead - indent) > 1) problems.push(`"${name}" under "${label}" starts ${(lead - indent).toFixed(1)}px from its indent: a gutter`)
        if (mark) {
          const gap = textStart - mark.getBoundingClientRect().right
          if (gap < 3 || gap > 6) problems.push(`"${name}" under "${label}": the mark is ${gap.toFixed(1)}px from the name`)
        }
      }
    }
    return { groups, marks, rows, problems }
  })
}

/**
 * The API tree indents each row whole, mark and label together: a mark sits half a rem from the left of its row at the
 * first two levels and one indent further in for each level after them, so a reader scans down one column of marks per
 * level.
 */
export function apiTreeGutterProblems(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.api-nav:not([data-marks])')
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
  const rail = await railProblems(page)
  results.counts['related chip row'] = (results.counts['related chip row'] ?? 0) + rail.rows
  results.failures.push(...rail.problems.map((problem) => `${entry.label} (${scheme}) related APIs: ${problem}`))
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

  // Each way a related chip can stop being one box with its mark as its cap, and the problem the check must name for it.
  await page.goto(`${base}${PAGES[6].path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  const clean = await railProblems(page)
  assert(clean.rows > 1 && clean.problems.length === 0, `The related chips are not clean before the control: ${clean.problems.join('; ')}`)
  const CHIP = 'nav.api-related a:has(> .api-nav__kind)'
  const broken = async (css, expected, why) => {
    const style = await page.addStyleTag({ content: css })
    const { problems } = await railProblems(page)
    await style.evaluate((node) => node.remove())
    assert(problems.some((problem) => expected.test(problem)), `The rail check did not notice ${why}; it said: ${problems.join('; ') || 'nothing'}`)
    return problems.length
  }
  // A chip that inherits the contents column's link padding: the chip grows around it, and the mark sits inside the padding and not in the corner.
  results.railControl = await broken(`${CHIP} { padding: .4rem .35rem !important; }`, /the mark is not flush with the chip's top edge/, 'a chip that inherits the contents column\'s link padding')
  // A chip too narrow for its name, which is held on one line: the name runs out of the chip.
  results.railControl += await broken(`${CHIP} { inline-size: 3rem !important; } ${CHIP} > code { white-space: nowrap !important; overflow-wrap: normal !important; }`, /the chip's box does not contain its name/, 'a name running out of its chip')
  // A mark shorter than the first line of the name.
  results.railControl += await broken(`${CHIP} > .api-nav__kind { height: 6px !important; }`, /the mark does not fill the chip's height/, 'a mark shorter than a line')
  assert(results.railControl > 0, 'The rail check did not notice a chip that does not contain its content')

  // A modifier word shifted two pixels inside its chip.
  await page.goto(`${base}${PAGES[10].path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  await page.addStyleTag({ content: MEASURING_STYLE })
  const chip = page.locator('.api-badge--mod').filter({ visible: true }).first()
  assert.deepEqual(judge('control', measure(await sample(page, await chip.elementHandle(), 'mod'), 'mod'), 'mod'), [], 'The modifier chip is not centred before the control')
  const shifted = await page.addStyleTag({ content: '.api-badge--mod > .api-badge__label { translate: 0 2px !important; }' })
  results.modControl = judge('control', measure(await sample(page, await chip.elementHandle(), 'mod'), 'mod'), 'mod').length
  await shifted.evaluate((node) => node.remove())
  assert(results.modControl > 0, 'The modifier check did not notice a word shifted off its chip\'s centre')

  // The protocol sidebar: a redundant mark under a group of one kind must fail, and a mark in a mixed group must pass.
  await page.goto(`${base}${PAGES[8].path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  const sidebar = await protocolSidebarProblems(page)
  assert(sidebar.groups > 0 && sidebar.problems.length === 0, `The protocol sidebar is not clean before the control (${sidebar.groups} groups): ${sidebar.problems.join('; ')}`)
  // Rows copied out of an open group, with the kinds and marks the control gives them.
  const addGroup = (kinds, drawn) => page.evaluate(([kinds, drawn]) => {
    const source = [...document.querySelectorAll('.api-nav[data-marks="mixed"] ul[role="group"]')].find((group) => group.querySelector(':scope > li > a.api-nav__leaf'))
    const group = source.cloneNode(true)
    group.dataset.control = ''
    const leaves = [...group.querySelectorAll(':scope > li > a.api-nav__leaf')].slice(0, kinds.length)
    for (const item of group.querySelectorAll(':scope > li')) if (!leaves.includes(item.querySelector('a'))) item.remove()
    leaves.forEach((leaf, index) => {
      leaf.querySelector('.api-nav__kind')?.remove()
      leaf.setAttribute('aria-description', kinds[index])
      if (drawn) {
        const mark = document.createElement('span')
        mark.className = `api-nav__kind api-badge--kind-${kinds[index]}`
        mark.innerHTML = '<span class="api-badge__label" data-mark="cap">t</span>'
        leaf.prepend(mark)
      }
    })
    source.after(group)
  }, [kinds, drawn])
  const control = async (kinds, drawn) => {
    await addGroup(kinds, drawn)
    const found = (await protocolSidebarProblems(page)).problems
    await page.evaluate(() => { document.querySelectorAll('[data-control]').forEach((node) => node.remove()) })
    return found
  }
  results.sidebarRedundant = (await control(['tool', 'tool'], true)).length
  assert(results.sidebarRedundant > 0, 'The sidebar check did not notice a redundant mark under a group of one kind')
  results.sidebarMixedBare = (await control(['tool', 'prompt'], false)).length
  assert(results.sidebarMixedBare > 0, 'The sidebar check did not notice a mixed group without marks')
  results.sidebarMixedMarked = (await control(['tool', 'prompt'], true)).length
  assert(results.sidebarMixedMarked === 0, 'The sidebar check rejected marks in a group that mixes kinds')

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
  const lifted = await page.addStyleTag({ content: 'h2.api-index-summary > .headerlink { vertical-align: 4px !important; }' })
  results.headingControl = (await headingProblems(page)).problems.length
  await lifted.evaluate((node) => node.remove())
  assert(results.headingControl > 0, 'The heading check did not notice a permalink off the baseline')
  const mark = page.locator(ROW_MARKS).filter({ visible: true }).first()
  const touching = await page.addStyleTag({ content: `${ROW_MARKS} { margin-inline-end: 0 !important; top: 3px !important; }` })
  results.rowControl = judge('control', measure(await sample(page, await mark.elementHandle(), 'row'), 'row'), 'row').length
  await touching.evaluate((node) => node.remove())
  assert(results.rowControl > 0, 'The row check did not notice a mark that touches its name and sits off its centre')
}

export async function checkBadgeCentring(browser, base, { sample: bounded = false } = {}) {
  const results = { measured: 0, failures: [], counts: {}, control: 0, railControl: 0, headingControl: 0, rowControl: 0, sidebarRedundant: 0, sidebarMixedBare: 0, sidebarMixedMarked: 0, gutterControl: 0, modControl: 0 }
  // The bounded sample keeps one page for each thing the gate holds: an MCP and a guide page, the API type page (tree gutter, rail, rows) and an MCP tool (sidebar rule).
  const pages = bounded ? [PAGES[0], PAGES[1], PAGES[6], PAGES[8]] : PAGES
  const hi = await chromium.launch({ args: ['--force-device-scale-factor=2', '--window-size=1440,1000'] })
  try {
    for (const [engine, factor] of [[browser, 1], [hi, 2]]) {
      const context = await engine.newContext(factor === 1 ? { viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' } : { viewport: null, reducedMotion: 'reduce' })
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
  console.log(`Badge centring: ${results.measured} samples at 1x and a real 2x, light and dark (${Object.entries(results.counts).map(([k, v]) => `${v} ${k}`).join(', ')}); negative controls caught ${results.control} of ${results.controlTested} shifted marks, ${results.railControl} chip problems, ${results.headingControl} heading problem and ${results.rowControl} row problems, ${results.sidebarRedundant} redundant sidebar mark (a mixed group's marks: ${results.sidebarMixedMarked} complaints), ${results.gutterControl} broken indent, ${results.modControl} shifted modifier word PASS`)
}

/**
 * The density rule on real pages: within a section, the first mention of a name
 * carries the mark and a later one is a plain link that keeps its kind.
 */
export async function checkMentionDensity(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
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

const CHIP_PAGES = ['server', 'session', 'window', 'pane', 'client'].map((name) => `/scala/latest/reference/io-github-libtmux-scaladsl-${name}/`)

/**
 * The Related APIs chips of the Scala Server, Session, Window, Pane and Client pages, where the name `Session (io.github.libtmux.scaladsl)` wraps onto
 * three lines in the contents column: each chip grows to fit its name, its mark stays one line tall beside the first line, and nothing runs out
 * of a chip or onto the next. The controls put back the fixed height the chip once had, stretch the mark down the chip, take the name's first-line
 * offset away and lay one chip over another, and the check must name each.
 */
export async function checkChipGrowth(browser, base) {
  // The contents column, and the Related APIs in it, show from 85rem.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(60000)
  const open = async (path) => {
    await page.goto(`${base}${path}`, { waitUntil: 'load' })
    await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  }
  try {
    let chips = 0
    let wrapped = 0
    for (const path of CHIP_PAGES) {
      await open(path)
      const found = await chipGrowthProblems(page)
      assert(found.wrapped > 0, `No Related APIs chip wrapped its name at 1440px on ${path}, so growth was not measured there`)
      assert.deepEqual(found.problems, [], `A Related APIs chip on ${path}:\n${found.problems.join('\n')}`)
      chips += found.chips
      wrapped += found.wrapped
    }
    // The Session page mixes one-line chips with wrapped ones, so a name that loses its first-line offset differs from its neighbours.
    await open(CHIP_PAGES[1])
    const CHIP = 'nav.api-related a:has(> .api-nav__kind)'
    const caught = {}
    const broken = async (label, css, expected) => {
      const style = await page.addStyleTag({ content: css })
      const { problems } = await chipGrowthProblems(page)
      await style.evaluate((node) => node.remove())
      for (const pattern of expected) assert(problems.some((problem) => pattern.test(problem)), `The chip check did not notice ${label} (${pattern}); it said: ${problems.join('; ') || 'nothing'}`)
      caught[label] = problems.length
    }
    await broken('the fixed height', `${CHIP} { height: var(--sp-h) !important; min-height: 0 !important; }`, [/the name starts .* above the chip's top edge/, /the chip is still one line tall/])
    await broken('a mark stretched down the chip', `${CHIP} > .api-nav__kind { align-self: stretch !important; height: auto !important; }`, [/the mark is .* tall, not the/])
    await broken('a first line that lost its offset', `${CHIP} > .api-nav__kind + code { margin-top: 0 !important; }`, [/the first line of the name is .* the centre of the mark/])
    await broken('one chip over another', 'nav.api-related li:nth-child(2) a { translate: 0 -14px !important; }', [/overlaps/])
    console.log(`Chip growth: ${chips} Related APIs chips (${wrapped} wrapped) on the Scala Server, Session, Window, Pane and Client pages each hold their name, keep the mark one line tall beside the first line and clear the next chip; controls caught ${Object.entries(caught).map(([label, count]) => `${label} (${count} problems)`).join(', ')} PASS`)
  } finally { await context.close() }
}

const USAGE = { list: '.tmux-usage', where: 'usage table', ink: true }

/**
 * The chips of the usage table on the page the maintainer saw them wrap on, `list-panes` at 1134px, and in a container narrow
 * enough to wrap a name onto three lines, each judged as the Related APIs chips are. A chip with a qualifier keeps the width its
 * name needs. Each control breaks one thing and the check must name it: a chip pinned to one line's height, a name below its chip,
 * a chip squeezed by its qualifier and one chip moved onto another.
 */
export async function checkUsageChips(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1134, height: 900 } })
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(60000)
  const ready = () => page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  const measure = () => chipGrowthProblems(page, USAGE)
  try {
    await page.goto(`${base}/tmux/latest/manual/list-panes/`, { waitUntil: 'load' })
    await ready()
    const real = await measure()
    assert(real.wrapped > 0, 'No chip wrapped its name at 1134px, so growth was not measured on the page that showed it')
    assert.deepEqual(real.problems, [], `A chip of the usage table on the list-panes manual page:\n${real.problems.join('\n')}`)
    // Each chip with a qualifier keeps the width its name needs, and its qualifier is beside it or under it.
    const qualified = await qualifierProblems(page)
    assert(qualified.asked > 0, 'No chip with a qualifier on the list-panes manual page, so none was measured')
    assert.deepEqual(qualified.problems, [], `A qualifier took room from its chip:\n${qualified.problems.join('\n')}`)
    // A narrow container with a name that fits, one that wraps twice and one that wraps three times.
    await page.evaluate(() => {
      const model = document.querySelector('.tmux-usage a:has(> .api-nav__kind:where(:not(.api-link-kind)))')
      const box = document.createElement('div')
      box.className = 'tmux-usage'
      box.dataset.control = 'narrow'
      box.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:6px;inline-size:8.5rem;margin:1rem 0'
      for (const name of ['Window#panes', 'Async::Server#list_panes', 'LibTmux::Server#search_panes_with_options']) {
        const chip = model.cloneNode(true)
        chip.querySelector(':scope > .api-nav__kind + code').innerHTML = name.replace(/(::|(?=[#_]))/g, '$1<wbr>')
        box.append(chip)
      }
      model.closest('main, article, body').append(box)
    })
    const narrow = await measure()
    assert(narrow.wrapped >= real.wrapped + 2, 'The narrow container did not wrap the long names')
    assert.deepEqual(narrow.problems, [], `A wrapped chip in a narrow container:\n${narrow.problems.join('\n')}`)
    // A qualified chip in a cell too narrow to hold it and its qualifier side by side: the qualifier goes under the chip, which keeps its size.
    const addQualified = () => page.evaluate(() => {
      const item = [...document.querySelectorAll('.tmux-usage__item')].find((entry) => entry.querySelector(':scope > .tmux-usage__when'))
      const links = item.parentElement.cloneNode(false)
      links.dataset.control = 'qualified'
      links.style.cssText = 'inline-size:11rem;margin:1rem 0'
      links.append(item.cloneNode(true))
      item.closest('.tmux-usage').append(links)
    })
    await addQualified()
    const narrowQualified = await qualifierProblems(page)
    assert(narrowQualified.asked === qualified.asked + 1, 'The qualified chip in a narrow cell was not measured')
    assert.deepEqual(narrowQualified.problems, [], `A qualifier took room from its chip in a narrow cell:\n${narrowQualified.problems.join('\n')}`)
    const fresh = async () => {
      await page.reload({ waitUntil: 'load' })
      await ready()
    }
    const CHIP = `.tmux-usage a:has(> ${CHIP_MARK})`
    // Control 1: a chip held to one line's height cannot hold a name of two lines, so the name spills out of it.
    await fresh()
    await page.addStyleTag({ content: `${CHIP} { height: var(--sp-h) !important; min-height: 0 !important; }` })
    const pinned = await measure()
    assert(pinned.problems.some((problem) => /the chip is still one line tall/.test(problem)), 'The check did not notice a chip too short for its name')
    assert(pinned.problems.some((problem) => /the name starts .* above the chip's top edge/.test(problem)), 'The check did not notice a name spilling out of the top of its chip')
    // Control 2: a name that ends below its chip's bottom edge.
    await fresh()
    await page.addStyleTag({ content: `${CHIP} > .api-nav__kind + code { margin-bottom: -8px !important; }` })
    const below = await measure()
    assert(below.problems.some((problem) => /runs .* past the chip's bottom edge/.test(problem)), 'The check did not notice a name running past its chip')
    // Control 3: the layout this replaced, in which the chip shrinks beside a qualifier that cannot wrap, so its name wraps with room to spare.
    await fresh()
    await addQualified()
    await page.addStyleTag({ content: '.tmux-usage__item { flex-wrap: nowrap !important; white-space: nowrap !important; } .tmux-usage__item > a { flex: 0 1 auto !important; } .tmux-usage__when { white-space: nowrap !important; }' })
    const squeezed = await qualifierProblems(page)
    assert(squeezed.problems.some((problem) => /px wide in .*px of room and its name needs/.test(problem)), 'The check did not notice a chip that shrank for its qualifier')
    // Control 4: a chip moved onto the one above it overlaps.
    await fresh()
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('.tmux-usage__item a:has(> .api-nav__kind:where(:not(.api-link-kind)))')]
      const second = items.find((chip, index) => items[index - 1] && chip.parentElement === items[index - 1].parentElement) ?? items[1]
      second.style.transform = 'translateY(-12px)'
    })
    const moved = await measure()
    assert(moved.problems.some((problem) => /overlaps/.test(problem)), 'The check did not notice a chip on top of the one above')
    console.log(`Usage chips: ${real.chips} chips on the list-panes manual page (${real.wrapped} wrapped) and 3 in an 8.5rem container, each tall enough for its name, level with its mark and clear of the next, and ${qualified.asked + 1} qualified chips at the width their names need; controls caught a pinned height (${pinned.problems.length} problems), a name below its chip (${below.problems.length}), a chip squeezed by its qualifier (${squeezed.problems.length}) and an overlap (${moved.problems.length}) PASS`)
  } finally { await context.close() }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6) ?? 'http://localhost:47392/en'
  const browser = await chromium.launch()
  try {
    await checkBadgeCentring(browser, url, { sample: process.argv.includes('--sample') })
    await checkMentionDensity(browser, url)
    await checkChipGrowth(browser, url)
    await checkUsageChips(browser, url)
  } finally { await browser.close() }
}
