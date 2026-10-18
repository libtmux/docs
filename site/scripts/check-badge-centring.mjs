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
const PAGES = [
  { label: 'Rust MCP reference', path: '/rs/latest/mcp/reference/mcp-caller-calleridentity-from_env/' },
  { label: 'Python attaching-to-tmux', path: '/py/stable/guides/attaching-to-tmux/' },
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
  { kind: 'mark', selector: `.api-nav__kind:not(:is(${SPLIT.split(', ').map((s) => `${s} a > .api-nav__kind`).join(', ')}))`, name: 'mark' },
  { kind: 'leg', selector: '.api-leg', name: 'legend chip' },
  { kind: 'split', selector: SPLIT.split(', ').map((s) => `${s} a:has(> .api-nav__kind)`).join(', '), name: 'split chip' },
  { kind: 'row', selector: ROW_MARKS, name: 'card and list mark' },
  { kind: 'mod', selector: '.api-badge--mod', name: 'modifier chip' },
]


/**
 * The related-APIs chips in the contents column: each is one outlined box that
 * contains its mark and its name, no box overlaps the next, and the rows are
 * evenly spaced. Measured from the laid-out boxes, since the failure it guards
 * is a box that does not hold its content.
 */
export async function railProblems(page) {
  const rows = await page.evaluate(() => [...document.querySelectorAll('nav.api-related a:has(> .api-nav__kind)')].filter((a) => a.offsetParent).map((a) => {
    const box = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right } }
    return { chip: box(a), mark: box(a.querySelector(':scope > .api-nav__kind')), name: box(a.querySelector(':scope > code')), text: a.textContent.trim(), clipped: a.scrollHeight > a.clientHeight + 1 || a.scrollWidth > a.clientWidth + 1 }
  }))
  const problems = []
  const slack = 0.51
  for (const row of rows) {
    for (const part of ['mark', 'name']) {
      const inside = row[part].top >= row.chip.top - slack && row[part].bottom <= row.chip.bottom + slack && row[part].left >= row.chip.left - slack && row[part].right <= row.chip.right + slack
      if (!inside) problems.push(`${row.text}: the chip's box does not contain its ${part}`)
    }
    // The mark is the chip's cap: it spans the chip's full height, and nothing is clipped by the chip's edge.
    if (row.mark.bottom - row.mark.top < row.chip.bottom - row.chip.top - 2 - slack) problems.push(`${row.text}: the mark does not fill the chip's height`)
    if (row.clipped) problems.push(`${row.text}: the chip clips its content`)
  }
  const gaps = rows.slice(1).map((row, index) => row.chip.top - rows[index].chip.bottom)
  gaps.forEach((gap, index) => { if (gap < 0) problems.push(`${rows[index + 1].text}: overlaps the row above by ${(-gap).toFixed(1)}px`) })
  if (gaps.length && Math.max(...gaps) - Math.min(...gaps) > 1) problems.push(`rows are unevenly spaced: gaps run ${Math.min(...gaps).toFixed(1)} to ${Math.max(...gaps).toFixed(1)}px`)
  return { rows: rows.length, problems }
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
 * The API tree keeps its fixed gutter: every mark sits at the same distance
 * from the left of its row, whatever the row's level, so a reader scans down
 * one column.
 */
export function apiTreeGutterProblems(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.api-nav:not([data-marks])')
    if (!nav) return { marks: 0, problems: [] }
    const found = [...nav.querySelectorAll('.api-nav__row > .api-nav__kind')].filter((mark) => mark.offsetParent).map((mark) => {
      const row = mark.parentElement
      return { offset: mark.getBoundingClientRect().left - row.getBoundingClientRect().left, level: Number(getComputedStyle(row).getPropertyValue('--level')) }
    })
    const problems = []
    if (found.length) {
      const offsets = found.map((entry) => entry.offset)
      if (Math.max(...offsets) - Math.min(...offsets) > 1) problems.push(`marks do not share one gutter: offsets run ${Math.min(...offsets).toFixed(1)} to ${Math.max(...offsets).toFixed(1)}px across levels ${[...new Set(found.map((entry) => entry.level))].join(', ')}`)
    }
    return { marks: found.length, problems }
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

  // A chip that inherits the contents column's link padding no longer holds its content.
  await page.goto(`${base}${PAGES[6].path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  const clean = await railProblems(page)
  assert(clean.rows > 1 && clean.problems.length === 0, `The related chips are not clean before the control: ${clean.problems.join('; ')}`)
  const padded = await page.addStyleTag({ content: 'nav.api-related a:has(> .api-nav__kind) { padding: .4rem .35rem !important; }' })
  results.railControl = (await railProblems(page)).problems.length
  await padded.evaluate((node) => node.remove())
  assert(results.railControl > 0, 'The rail check did not notice a chip that does not contain its content')

  // A modifier word shifted two pixels inside its chip.
  await page.goto(`${base}${PAGES[9].path}`, { waitUntil: 'load' })
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

  // The API tree: breaking the shared gutter must fail.
  await page.goto(`${base}${PAGES[6].path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 30000 }).catch(() => {})
  const gutter = await apiTreeGutterProblems(page)
  assert(gutter.marks > 1 && gutter.problems.length === 0, `The API tree gutter is not clean before the control (${gutter.marks} marks): ${gutter.problems.join('; ')}`)
  const ragged = await page.addStyleTag({ content: '.api-nav__row { padding-inline-start: calc(.75rem + (var(--level) - 1) * var(--api-nav-indent)) !important; }' })
  results.gutterControl = (await apiTreeGutterProblems(page)).problems.length
  await ragged.evaluate((node) => node.remove())
  assert(results.gutterControl > 0, 'The gutter check did not notice marks that stopped sharing a column')

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
  const pages = bounded ? PAGES.slice(0, 2) : PAGES
  const hi = await chromium.launch({ args: ['--force-device-scale-factor=2', '--window-size=1440,1000'] })
  try {
    for (const [engine, factor] of [[browser, 1], [hi, 2]]) {
      const context = await engine.newContext(factor === 1 ? { viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' } : { viewport: null, reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
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
  console.log(`Badge centring: ${results.measured} samples at 1x and a real 2x, light and dark (${Object.entries(results.counts).map(([k, v]) => `${v} ${k}`).join(', ')}); negative controls caught ${results.control} of ${results.controlTested} shifted marks, ${results.railControl} chip problems, ${results.headingControl} heading problem and ${results.rowControl} row problems, ${results.sidebarRedundant} redundant sidebar mark (a mixed group's marks: ${results.sidebarMixedMarked} complaints), ${results.gutterControl} broken gutter, ${results.modControl} shifted modifier word PASS`)
}

/**
 * The density rule on real pages: within a section, the first mention of a name
 * carries the mark and a later one is a plain link that keeps its kind.
 */
export async function checkMentionDensity(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
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
    await page.goto(`${base}/py/stable/guides/attaching-to-tmux/`, { waitUntil: 'load' })
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6) ?? 'http://localhost:47392/en'
  const browser = await chromium.launch()
  try {
    await checkBadgeCentring(browser, url, { sample: process.argv.includes('--sample') })
    await checkMentionDensity(browser, url)
  } finally { await browser.close() }
}
