import assert from 'node:assert/strict'
import { newCheckContext } from './browser-context.mjs'

/**
 * A port landing and the product homes keep their layout from first paint to ready.
 *
 * The design system asks for zero layout shift from players, tabs, filters and panes. This probe measures
 * `layout-shift` entries (those without recent input) from navigation to the point where the page's scripts
 * have bound, on a landing's three Core programs and on the Core, MCP and Workspace homes, at a phone and a
 * desktop width, in both colour schemes. A shift is named by the element that moved, so a failure points at
 * the element that grew rather than at a score.
 *
 * A shift counts once the document has finished parsing. Before that the browser paints what has arrived, and
 * the strip or a column that is still streaming in settles as its siblings are parsed; that is the order a
 * server sends the page in, and no script or stylesheet of the page decides it. After parsing, every move is
 * the page changing itself: a script closing a list, a button unhidden, a face swapped in.
 *
 * Run it against a production build, where it reads 0: a dev server adds its own shifts. The Go tree is built
 * like `scripts/build-site.sh` builds it (`LIBTMUX_DOCS_BASE=/en/go/latest/ ... astro build`) and served so that
 * `/en/go/latest/` maps to the build directory:
 *
 *   node scripts/check-landing-shift.mjs http://127.0.0.1:4321/en go
 */

export const WIDTHS = [390, 1280]
export const SCHEMES = ['light', 'dark']
/** Product homes under a port's version root. Each one carries a player or a chrome strip that must not move. */
export const PRODUCT_HOMES = ['core/', 'mcp/', 'workspace/']
/** What the page may still add before it counts as settled: the showcase binds its script on `data-live`. */
const BOUND = '[data-core-plan]:not([data-live])'

/** Records layout shifts with the element that moved, from the first byte. */
function recordShifts() {
  window.__shift = 0
  window.__streamed = 0
  window.__sources = []
  // The shifts before the parser finishes are the page arriving, not the page moving.
  let parsed = Infinity
  document.addEventListener('readystatechange', () => { if (document.readyState !== 'loading') parsed = Math.min(parsed, performance.now()) })
  const name = (node) => {
    if (!node || node.nodeType !== 1) return String(node?.nodeName)
    const classes = [...node.classList].slice(0, 3).map((c) => `.${c}`).join('')
    return `${node.localName}${node.id ? `#${node.id}` : ''}${classes}`
  }
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue
      if (entry.startTime < parsed) { window.__streamed += entry.value; continue }
      window.__shift += entry.value
      for (const source of entry.sources ?? []) {
        const { previousRect: before, currentRect: after } = source
        window.__sources.push(`${Math.round(entry.startTime)}ms ${entry.value.toFixed(4)} ${name(source.node)} y ${Math.round(before.y)}->${Math.round(after.y)} h ${Math.round(before.height)}->${Math.round(after.height)} x ${Math.round(before.x)}->${Math.round(after.x)} w ${Math.round(before.width)}->${Math.round(after.width)}`)
      }
    }
  }).observe({ type: 'layout-shift', buffered: true })
}

/**
 * Load `url` and return the layout shift, after parsing, up to the moment its scripts have bound and a further
 * second has passed (`streamed` is what moved while the page was still arriving). `disturb` runs once the page is ready, for a probe that must prove it sees a shift.
 */
export async function measureShift(browser, base, url, { width, colorScheme, disturb } = {}) {
  const context = await newCheckContext(browser, base, { viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme })
  try {
    const page = await context.newPage()
    await page.addInitScript(recordShifts)
    const response = await page.goto(url, { waitUntil: 'load' })
    assert(response?.ok(), `${url} answers (${response?.status()})`)
    await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready', null, { timeout: 60000 })
    await page.waitForFunction((selector) => !document.querySelector(selector), BOUND, { timeout: 60000 })
    if (disturb) await page.evaluate(disturb)
    await page.waitForTimeout(1000)
    return await page.evaluate(() => ({ shift: window.__shift, streamed: window.__streamed, sources: window.__sources }))
  } finally {
    await context.close()
  }
}

/** The capability ids of the landing's Core showcase, in tab order. */
async function capabilitiesOf(browser, base, url) {
  const context = await newCheckContext(browser, base, { viewport: { width: 1280, height: 900 } })
  try {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'load' })
    return await page.locator('nav[aria-label="Capabilities"] [data-capability-option]').evaluateAll((links) => links.map((link) => link.dataset.capabilityOption))
  } finally {
    await context.close()
  }
}

/** Zero, to the precision a browser reports a sub-pixel shift. */
export const SHIFT_LIMIT = 0.00001

export async function checkLandingShift(browser, base, { port = 'go', widths = WIDTHS, schemes = SCHEMES, homes = PRODUCT_HOMES } = {}) {
  const root = `${base.replace(/\/$/, '')}/${port}/latest/`
  const ids = await capabilitiesOf(browser, base, root)
  assert(ids.length >= 1, `${port}: the landing offers a Core program`)
  const pages = [...ids.map((id, index) => (index === 0 ? '' : `?capability=${id}`)), ...homes]
  const failures = []
  for (const width of widths) {
    for (const colorScheme of schemes) {
      for (const page of pages) {
        const { shift, streamed, sources } = await measureShift(browser, base, `${root}${page}`, { width, colorScheme })
        console.log(`  ${port} ${width}px ${colorScheme} ${page || '(landing)'}: shift ${shift.toFixed(5)} (${streamed.toFixed(5)} while streaming in)`)
        if (shift > SHIFT_LIMIT) failures.push(`${port} ${width}px ${colorScheme} ${page || '(landing)'}: layout shift ${shift.toFixed(5)}\n    ${sources.join('\n    ')}`)
      }
    }
  }
  assert.deepEqual(failures, [], `${port}: nothing moves between first paint and ready\n${failures.join('\n')}`)
  console.log(`${port} landing (${ids.length} Core programs) and ${homes.join(', ')}: layout shift 0 at ${widths.join(', ')}px in ${schemes.join(' and ')} PASS`)
}

/** The probe fails on a page whose showcase grows after it is ready: 120px of content slides in above it. */
export async function checkLandingShiftFail(browser, base, { port = 'go' } = {}) {
  const root = `${base.replace(/\/$/, '')}/${port}/latest/`
  const { shift, sources } = await measureShift(browser, base, root, {
    width: 390,
    colorScheme: 'light',
    disturb: () => {
      const notice = document.createElement('div')
      notice.style.height = '120px'
      notice.textContent = 'late content'
      document.querySelector('main')?.prepend(notice)
    },
  })
  assert(shift > 0.01, `a block inserted above the page's content is a layout shift (${shift})`)
  assert(sources.some((line) => line.includes('main') || line.includes('.')), 'the shift names the element that moved')
  console.log(`Landing shift probe fails on injected content (${shift.toFixed(3)}) PASS`)
}

// node scripts/check-landing-shift.mjs [http://127.0.0.1:4321/en] [go]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const base = (process.argv[2] ?? 'http://127.0.0.1:4321/en').replace(/\/$/, '')
    const port = process.argv[3] ?? 'go'
    await checkLandingShiftFail(browser, base, { port })
    await checkLandingShift(browser, base, { port })
  } finally {
    await browser.close()
  }
}
