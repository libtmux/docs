import assert from 'node:assert/strict'
import { PNG } from 'pngjs'

/**
 * The Rust mark is one dark shape that the page turns light on a dark theme.
 * An SVG shown through <img> evaluates any `prefers-color-scheme` rule it
 * carries against the device, not the site's Light, Dark or System choice, so
 * a phone in dark mode with the site on Light showed a white mark on a white
 * page. Desktop Chromium hides this while the page sets `color-scheme`, so the
 * check also runs with that property reset, which is how an image that follows
 * the device behaves. Every pairing of device and site scheme is read from
 * rendered pixels.
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

async function readIcon(browser, url, icon, { device, site, css, replacement }) {
  // A null site is a visit without JavaScript: no saved choice, so the page follows the device.
  const context = await browser.newContext({ colorScheme: device, reducedMotion: 'reduce', javaScriptEnabled: site !== null, viewport: { width: 1280, height: 777 } })
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
    return readMark(await image.screenshot())
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
  console.log('Language icons: the Rust mark is dark on a light page and light on a dark page for every device and site scheme, with images following the page or the device, and without JavaScript PASS')
}
