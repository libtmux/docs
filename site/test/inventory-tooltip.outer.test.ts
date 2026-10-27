import { readFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The footer's inventory help in a real browser, with the component's own styles and no server. Tab from the help
 * link reaches the tooltip's link at once, before any transition has run.
 */
const source = readFileSync(new URL('../src/components/SiteFooter.astro', import.meta.url), 'utf8')
const styles = source.match(/<style>([\s\S]*?)<\/style>/)![1]!
// The show rule as it was: visibility transitioned, so it starts from hidden for a frame.
const transitionedShow = '.inventory-help:focus-within .inventory-tooltip { transition: opacity .1s, visibility .1s; transition-delay: 0s; }'

const page = (css: string) => `<!doctype html><html><head><style>${css}</style></head><body>
<a href="#objects">objects-full.inv</a>
<span class="inventory-help"><a class="inventory-help-link" href="#help" aria-label="About Sphinx inventories" aria-describedby="inventory-tooltip">?</a>
<span class="inventory-tooltip" id="inventory-tooltip">Sphinx inventories. <a id="learn" href="#help">Learn how to link to this documentation.</a></span></span>
<a id="after" href="#github">GitHub</a></body></html>`

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

/** The element Tab reaches when pressed the moment the help link takes focus: transitions are frozen at their start. */
async function tabFromHelp(css: string) {
  const target = await browser.newPage()
  await target.setContent(page(css))
  const cdp = await target.context().newCDPSession(target)
  await cdp.send('Animation.enable')
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 })
  await target.locator('.inventory-help-link').focus()
  await target.keyboard.press('Tab')
  const reached = await target.evaluate(() => document.activeElement?.id)
  await target.close()
  return reached
}

describe('inventory help tooltip', () => {
  it('lets Tab reach the tooltip link the moment the help link has focus', async () => {
    expect(await tabFromHelp(styles)).toBe('learn')
  })

  it('skips the tooltip link when visibility transitions in, so the check above can fail', async () => {
    expect(await tabFromHelp(`${styles}\n${transitionedShow}`)).toBe('after')
  })
})
