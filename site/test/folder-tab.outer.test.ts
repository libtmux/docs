import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkFolderTab } from '../scripts/check-native-layout.mjs'

/**
 * `checkFolderTab` holds that a declaration's badges stand on the card's top edge and meet nothing of the header (record 0082).
 * It runs in a real browser on a card built from the live geometry: a 1px border, a header with .5rem of padding, a block 25px
 * above, and a tab of 18px chips. The old placement (flush in the header's bottom-right corner) and each other fault are the
 * negative controls: the check must be able to fail.
 */
let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

const chips = '<span style="display:block;box-sizing:border-box;height:18px;width:70px;background:#ddd"></span><span style="display:block;box-sizing:border-box;height:18px;width:70px;background:#ccc"></span>'
const tab = (position: string) => `<div class="api-corner" style="position:absolute;display:flex;gap:4px;${position}">${chips}</div>`
/** The folder tab: right .75rem, on the card's top border. The old tab: flush in the header's bottom-right corner. */
const FOLDER = 'right:.75rem;bottom:calc(100% + 1px)'
const OLD = 'right:0;bottom:0'

const card = (signature: string, position = FOLDER, extra = '', gap = 25) => `<!doctype html><html><body style="margin:0;padding:40px 16px">
  <p style="margin:0;height:20px">Source and package</p>
  <dl style="margin:${gap}px 0 0;width:343px;border:1px solid #888;border-radius:.5rem">
    <dt style="position:relative;padding:.5rem .75rem .5rem 1rem;font:14px/1.6 monospace;${extra}">
      <div class="gp-sphinx-api-layout"><div class="gp-sphinx-api-layout-left"><span style="display:block;white-space:pre">${signature}</span></div>
        ${tab(position)}</div></dt></dl></body></html>`

async function measure(html: string) {
  const page = await browser.newPage()
  try {
    await page.setContent(html)
    return await checkFolderTab(page.locator('dt'), 'fixture')
  } finally { await page.close() }
}

describe('checkFolderTab', () => {
  it('passes when the tab stands on the card\'s top edge, whatever the signature does below it', async () => {
    expect(await measure(card('func (p Pane) Capture(\n) error'))).toMatchObject({ covered: 0 })
    // A last line as long as the tab is wide, which ran under the old corner tab, is nothing to a tab above the card.
    expect(await measure(card('func (p Pane) Capture(\n) (lines []string, err error, extra int)'))).toMatchObject({ covered: 0 })
  })

  it('fails on the old placement, flush in the header\'s bottom-right corner (negative control)', async () => {
    await expect(measure(card('func (p Pane) Capture(\n) error', OLD))).rejects.toThrow(/not above it/)
    await expect(measure(card('func (p Pane) Capture(\n) (lines []string, err error, extra int)', OLD))).rejects.toThrow(/covers \d+ text box/)
  })

  it('fails on a tab over the signature, a tab floating above the card, and a card with no gap above it', async () => {
    await expect(measure(card('func (p Pane) Capture(\n) error', 'left:1rem;top:0'))).rejects.toThrow(/covers \d+ text box/)
    await expect(measure(card('func (p Pane) Capture(\n) error', 'right:.75rem;bottom:calc(100% + 11px)'))).rejects.toThrow(/floats .* above the card/)
    await expect(measure(card('func (p Pane) Capture(\n) error', FOLDER, '', 10))).rejects.toThrow(/clears the block above by/)
  })

  it('skips a header with no tab', async () => {
    const page = await browser.newPage()
    try {
      await page.setContent('<dl><dt><div class="gp-sphinx-api-layout-left">x</div></dt></dl>')
      expect(await checkFolderTab(page.locator('dt'), 'no tab')).toBeNull()
    } finally { await page.close() }
  })
})
