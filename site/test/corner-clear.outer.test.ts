import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkCornerClear } from '../scripts/check-native-layout.mjs'

/**
 * `checkCornerClear` holds that a declaration's corner tab never covers its signature. It runs in a real browser on a header
 * built from the card's own geometry: a .5rem bottom padding, a 15px tab flush in the corner, and a signature whose last line
 * either stops short of the tab or runs under it. The second case is the negative control: the check must be able to fail.
 */
let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

const header = (signature: string, extra = '') => `<!doctype html><html><body style="margin:0">
  <dl><dt style="position:relative;width:360px;padding:.5rem .75rem .5rem 1rem;font:14px/1.6 monospace;${extra}">
    <div class="gp-sphinx-api-layout"><div class="gp-sphinx-api-layout-left"><span style="display:block;white-space:pre">${signature}</span></div>
      <div class="api-corner" style="position:absolute;right:0;bottom:0;display:flex;height:15px;width:140px;background:#ddd"></div></div></dt></dl></body></html>`

async function measure(html: string) {
  const page = await browser.newPage()
  try {
    await page.setContent(html)
    return await checkCornerClear(page.locator('dt'), 'fixture')
  } finally { await page.close() }
}

describe('checkCornerClear', () => {
  it('passes when the last line stops short of the tab', async () => {
    expect(await measure(header('func (p Pane) Capture(\n) error'))).toBeLessThanOrEqual(2)
  })

  it('fails when the last line runs under the tab', async () => {
    await expect(measure(header('func (p Pane) Capture(\n) (lines []string, err error, extra int)'))).rejects.toThrow(/covers .* of the signature/)
  })

  it('skips a header with no tab', async () => {
    const page = await browser.newPage()
    try {
      await page.setContent('<dt><div class="gp-sphinx-api-layout-left">x</div></dt>')
      expect(await checkCornerClear(page.locator('dt'), 'no tab')).toBeNull()
    } finally { await page.close() }
  })
})
