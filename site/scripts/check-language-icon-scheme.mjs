import assert from 'node:assert/strict'
import { PNG } from 'pngjs'

/**
 * The Rust mark is one dark shape that the page turns light on a dark theme.
 * A `prefers-color-scheme` rule inside an SVG shown through <img> does not
 * reliably follow the site's Light, Dark or System choice: depending on the
 * engine and on whether the page sets `color-scheme`, it follows the device,
 * so a phone in dark mode with the site on Light showed a white mark on a
 * white page. The check therefore also runs with the page's `color-scheme`
 * reset. Every pairing of device and site scheme is read from rendered
 * pixels, and again under forced colors, where the system palette repaints
 * the page and the mark keeps its own light plate.
 */
const SERVED_VERSION = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}').rs ?? 'latest'

/** Images follow the device wherever the embedding page's `color-scheme` is not consulted. */
const IMAGES_FOLLOW_THE_DEVICE = 'html, html * { color-scheme: normal !important }'

/** What the Rust file did: a rule inside the SVG that turns the mark white for a device in dark mode. */
const OWN_DEVICE_RULE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>@media (prefers-color-scheme: dark) { #mark { fill: #fff } }</style>'
  + '<path id="mark" d="M16 2a14 14 0 1 0 0 28 14 14 0 0 0 0-28zm0 6a8 8 0 1 1 0 16 8 8 0 0 1 0-16z" fill-rule="evenodd"/></svg>'

const luminance = (data, offset) => (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255

/** The pixels of the mark against the page behind it, and whether they are darker than it. */
export function readMark(buffer) {
  const { width, height, data } = PNG.sync.read(buffer)
  // The artwork leaves its corner empty, so the corner is the page.
  const page = luminance(data, 0)
  const ink = []
  for (let offset = 0; offset < width * height * 4; offset += 4) {
    const value = luminance(data, offset)
    if (Math.abs(value - page) > 0.5) ink.push(value)
  }
  return { ink: ink.length, darkerThanPage: ink.reduce((sum, value) => sum + value, 0) / ink.length < page, page }
}

/** How far in from the screenshot's edges the plate and the mark are read. */
const INSET = 2

/**
 * The plate under the mark and the mark's dark pixels. The Rust mark is round, so the corners
 * of its square box show the plate. Both are read inside the edges, because an image at a
 * fractional position puts a column or row of the page into its screenshot.
 */
export function readPlate(buffer) {
  const { width, height, data } = PNG.sync.read(buffer)
  const at = (x, y) => luminance(data, (y * width + x) * 4)
  const [left, top, right, bottom] = [INSET, INSET, width - 1 - INSET, height - 1 - INSET]
  const plate = Math.min(at(left, top), at(right, top), at(left, bottom), at(right, bottom))
  let dark = 0
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) if (at(x, y) < 0.25) dark += 1
  return { plate, dark }
}

async function readIcon(browser, url, icon, { device, site, css, replacement, forced = false, read = readMark }) {
  // A null site is a visit without JavaScript: no saved choice, so the page follows the device.
  const context = await browser.newContext({ colorScheme: device, forcedColors: forced ? 'active' : 'none', reducedMotion: 'reduce', javaScriptEnabled: site !== null, viewport: { width: 1280, height: 777 } })
  try {
    if (site !== null) await context.addInitScript((choice) => localStorage.setItem('color-scheme', choice), site)
    // Added before the page parses, so an image is first drawn with it.
    if (css) await context.addInitScript((content) => {
      const add = () => document.documentElement.append(Object.assign(document.createElement('style'), { textContent: content }))
      if (document.documentElement) add()
      else new MutationObserver((_, observer) => { if (document.documentElement) { observer.disconnect(); add() } }).observe(document, { childList: true })
    }, css)
    const page = await context.newPage()
    if (replacement) await page.route('**/brand/languages/rs/icon.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: replacement }))
    await page.goto(url)
    const image = page.locator(icon)
    await image.waitFor({ state: 'visible' })
    await image.evaluate((element) => element.complete || new Promise((resolve) => element.addEventListener('load', resolve, { once: true })))
    assert.equal(await page.locator('html').getAttribute('data-theme-mode'), site, site ? `the page is on ${site}` : 'the page has not resolved a theme')
    return read(await image.screenshot())
  } finally {
    await context.close()
  }
}

/** The mark is dark on a light page and light on a dark page; one that matches the page is not seen. */
function assertMark({ ink, darkerThanPage, page }, { where, device, resolved }) {
  assert.equal(page > 0.5, resolved === 'light', `${where}: the page is ${resolved} (background ${page.toFixed(2)})`)
  const light = resolved === 'light'
  assert(ink >= 30 && darkerThanPage === light,
    `${where}: with the device on ${device} and the page on ${resolved}, the Rust mark is not ${light ? 'dark on a light page' : 'light on a dark page'} (${ink} pixels set apart from the page)`)
}

/** Under forced colors the mark sits dark on its own light plate. */
function assertPlated({ plate, dark }, { where, device, site }) {
  assert(plate > 0.75 && dark >= 30,
    `${where}: under forced colors with the device on ${device} and the site on ${site}, the Rust mark is not dark on its light plate (plate ${plate.toFixed(2)}, ${dark} dark pixels)`)
}

/** Dark on a light page and light on a dark page, whatever the device prefers. */
export async function checkLanguageIconScheme(browser, base) {
  const places = [
    ['the homepage language picker', `${base}/?port=rs`, '[data-home-launcher] [data-page-port-switcher] > summary img[data-home-language-icon="rs"]'],
    ['a Rust page', `${base}/rs/${SERVED_VERSION}/core/`, '.page-port-icon > img[data-language-icon="rs"]'],
  ]
  for (const [where, url, icon] of places) {
    for (const [images, css] of [['by the page', undefined], ['by the device', IMAGES_FOLLOW_THE_DEVICE]]) {
      for (const device of ['light', 'dark']) {
        for (const site of ['light', 'dark']) {
          assertMark(await readIcon(browser, url, icon, { device, site, css }), { where: `${where}, images scheme ${images}`, device, resolved: site })
        }
      }
    }
  }
  // The system palette decides the page under forced colors: Chromium follows the device, Firefox can
  // stay light on a dark theme, WebKit keeps the page's own colors. The plate holds in each engine.
  for (const [where, url, icon] of places) {
    for (const device of ['light', 'dark']) {
      for (const site of ['light', 'dark']) {
        assertPlated(await readIcon(browser, url, icon, { device, site, forced: true, read: readPlate }), { where, device, site })
      }
    }
  }
  // Without JavaScript the page follows the device, and so must the mark.
  const [rustPage, rustUrl, rustIcon] = places[1]
  for (const device of ['light', 'dark']) {
    assertMark(await readIcon(browser, rustUrl, rustIcon, { device, site: null }), { where: `${rustPage} without JavaScript`, device, resolved: device })
  }
  // Controls: the Rust file as it was, with a rule of its own, shows a white mark on a light
  // page for a device in dark mode, and a page that leaves the mark dark on a dark theme
  // shows a dark mark there. Both are reported.
  const old = await readIcon(browser, rustUrl, rustIcon, { device: 'dark', site: 'light', css: IMAGES_FOLLOW_THE_DEVICE, replacement: OWN_DEVICE_RULE })
  assert.throws(() => assertMark(old, { where: rustPage, device: 'dark', resolved: 'light' }), /dark on a light page/)
  const unlit = await readIcon(browser, rustUrl, rustIcon, { device: 'dark', site: 'dark', css: 'img { filter: none !important }' })
  assert.throws(() => assertMark(unlit, { where: rustPage, device: 'dark', resolved: 'dark' }), /light on a dark page/)
  // A dark plate hides the mark in every engine. Without a plate, Chromium's forced dark palette
  // leaves the dark mark on a black page; the other engines' emulation does not repaint it so.
  const dark = await readIcon(browser, rustUrl, rustIcon, { device: 'dark', site: 'light', forced: true, read: readPlate, css: 'img { background-color: #000 !important }' })
  assert.throws(() => assertPlated(dark, { where: rustPage, device: 'dark', site: 'light' }), /dark on its light plate/)
  if (browser.browserType().name() === 'chromium') {
    const bare = await readIcon(browser, rustUrl, rustIcon, { device: 'dark', site: 'light', forced: true, read: readPlate, css: 'img { background-color: transparent !important }' })
    assert.throws(() => assertPlated(bare, { where: rustPage, device: 'dark', site: 'light' }), /dark on its light plate/)
  }
  console.log(`Language icons (${browser.browserType().name()}): the Rust mark is dark on a light page and light on a dark page for every device and site scheme, with images following the page or the device, on its own plate under forced colors, and without JavaScript PASS`)
}
