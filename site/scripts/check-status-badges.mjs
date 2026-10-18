import assert from 'node:assert/strict'
import { PORT_BY_SLUG, PRODUCT_STATUS_GUIDE, PRODUCT_STATUS_SUMMARY, productAvailable, productStatus } from '../src/lib/ports.ts'
import registry from '../src/data/registry.json' with { type: 'json' }

/**
 * The documentation picker gives every product (Core Library, MCP, Workspace
 * Manager) a status badge: `concept` for a working example, else its release
 * stage. A badge is a toggletip that explains itself and links to the guide.
 * It opens on hover, on keyboard focus and on a tap, closes on Escape, and
 * sits beside a row's control instead of inside it.
 */
const PORTS_CHECKED = ['go', 'py', 'java']
const INTERACTIVE = 'a[href], button, summary, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]'
const PRODUCTS = [['core', 'Core Library'], ['mcp', 'MCP'], ['workspace', 'Workspace Manager']]

const expectedRows = (slug) => PRODUCTS.flatMap(([product, label]) => {
  const port = PORT_BY_SLUG[slug]
  const status = product === 'core' || productAvailable(port, product) ? productStatus(port, product, registry) : undefined
  return status ? [{ product, label, status }] : []
})

const nestedInteractive = (root, selector) => [...root.querySelectorAll(selector)]
  .filter((element) => element.parentElement?.closest(selector))
  .map((element) => `${element.tagName.toLowerCase()} inside ${element.parentElement.closest(selector).tagName.toLowerCase()}`)

const cardOf = (badge) => badge.locator('xpath=following-sibling::*[@popover]')
const isOpen = (card) => card.evaluate((element) => element.matches(':popover-open'))
const closed = async (card, message) => {
  await card.waitFor({ state: 'hidden' })
  assert.equal(await isOpen(card), false, message)
}

/** origin/main's picker: no badge on the library, a concept badge inside each companion's summary, and the footer line. */
const originMainMarkup = () => {
  const element = (tag, props) => Object.assign(document.createElement(tag), props)
  for (const badge of document.querySelectorAll('.surface-entry__badge')) badge.remove()
  for (const label of [...document.querySelectorAll('.surface-group > summary .surface-label')].slice(1)) {
    label.after(element('span', { className: 'concept-badge', title: 'Maintained as a working example of core library usage and deployment.', textContent: 'concept' }))
  }
  const key = element('p', { className: 'surface-status-key' })
  key.append(element('a', { href: '/tmux/guides/concept-examples/', textContent: 'Concept and alpha' }), ': example support scope and release maturity.')
  document.querySelector('.surface-picker-footer').before(key)
}

async function checkStructure(page, picker, slug, where) {
  const rows = expectedRows(slug)
  const entries = picker.locator('[data-surface-entry]')
  assert.equal(await entries.count(), rows.length, `${where}: one entry per product`)
  const badges = picker.locator('[data-surface-entry] .status-toggletip > .status-badge')
  assert.equal(await badges.count(), rows.length, `${where}: every product row has a badge`)
  for (const [index, { label, status }] of rows.entries()) {
    const badge = badges.nth(index)
    assert.equal(await badge.getAttribute('data-status'), status, `${where}: ${label} states ${status}`)
    assert.equal((await badge.evaluate((element) => element.firstChild.textContent)), status, `${where}: ${label} badge reads ${status}`)
    assert.equal(await picker.getByRole('button', { name: `${status} status of ${label}`, exact: true }).count(), 1, `${where}: ${label} badge is named for its product`)
    const card = cardOf(badge)
    assert.equal(await badge.getAttribute('aria-controls'), await card.getAttribute('id'), `${where}: ${label} badge controls its card`)
    assert.equal(await badge.getAttribute('aria-expanded'), 'false', `${where}: ${label} card starts closed`)
    assert.equal(await isOpen(card), false, `${where}: ${label} card starts closed`)
  }
  assert.equal(await picker.locator('.surface-status-key').count(), 0, `${where}: the footer status line is gone`)
  assert.equal(await picker.getByText('example support scope and release maturity').count(), 0, `${where}: the footer status text is gone`)
  assert.deepEqual(await picker.evaluate(nestedInteractive, INTERACTIVE), [], `${where}: no interactive element sits inside another`)
  // The trigger carries the same word as a plain label: it is a control, so it cannot hold a second one.
  const trigger = picker.locator(':scope > summary')
  const current = trigger.locator('.status-badge')
  assert.equal(await current.count(), rows.length ? 1 : 0, `${where}: the trigger shows its product's badge`)
  assert.equal(await current.evaluate((element) => element.tagName), 'SPAN', `${where}: the trigger's badge is a label`)
  assert.equal(await current.getAttribute('tabindex'), null, `${where}: the trigger's badge takes no focus`)
}

async function checkToggletip(page, picker, badge, status, label, where) {
  const card = cardOf(badge)
  const link = card.locator('a')
  // Keyboard focus opens it.
  await badge.focus()
  await card.waitFor({ state: 'visible' })
  assert.equal(await badge.getAttribute('aria-expanded'), 'true', `${where}: focus opens the ${status} card`)
  assert.equal((await card.locator(':scope > span').innerText()).trim(), PRODUCT_STATUS_SUMMARY[status], `${where}: the card says one plain sentence`)
  assert.equal((await card.locator(':scope > span').innerText()).split(/[.!?]\s/).length, 1, `${where}: the explanation is one sentence`)
  assert.equal(await card.getAttribute('role'), 'group', `${where}: the card is a named group`)
  assert.equal(await card.getAttribute('aria-label'), `${status}: ${label}`, `${where}: the card names its product`)
  const box = await card.boundingBox()
  const viewport = page.viewportSize()
  assert(box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height, `${where}: the card stays inside the viewport`)
  // The link is reachable by keyboard, keeps the card open, and goes to the guide's section.
  assert.equal(await link.count(), 1, `${where}: the card has one link`)
  await page.keyboard.press('Tab')
  assert(await link.evaluate((element) => element === document.activeElement), `${where}: Tab moves from the badge into the card's link`)
  assert.equal(await isOpen(card), true, `${where}: the card stays open while its link has focus`)
  const href = new URL(await link.getAttribute('href'), page.url())
  assert.equal(`${href.pathname}${href.hash}`.replace(/^\/(?:pr-\d+\/)?(?:en\/)?/, '/'), PRODUCT_STATUS_GUIDE, `${where}: the link goes to the concept and alpha section`)
  const guide = await page.request.get(`${href.origin}${href.pathname}`)
  assert(guide.ok(), `${where}: the guide responds (HTTP ${guide.status()})`)
  assert((await guide.text()).includes(`id="${href.hash.slice(1)}"`), `${where}: the guide has the ${href.hash} section`)
  assert.equal(await link.innerText(), `What ${status} means`, `${where}: the link says what it opens`)
  // Escape closes the card, returns focus to the badge and leaves the menu open.
  await page.keyboard.press('Escape')
  await closed(card, `${where}: Escape closes the card`)
  assert.equal(await badge.getAttribute('aria-expanded'), 'false', `${where}: Escape collapses the badge`)
  assert(await badge.evaluate((element) => element === document.activeElement), `${where}: Escape returns focus to the badge`)
  assert.equal(await picker.evaluate((element) => element.open), true, `${where}: Escape closes the card before the menu`)
  // Moving focus away closes it.
  await picker.locator('[data-picker-search]').focus()
  await closed(card, `${where}: leaving the badge closes the card`)
  // Hover opens it, stays open over the card, and Escape closes it without moving the pointer.
  await page.mouse.move(2, 2)
  await badge.hover()
  await card.waitFor({ state: 'visible' })
  await link.hover()
  await page.waitForTimeout(400)
  assert.equal(await isOpen(card), true, `${where}: the card stays open under the pointer`)
  await page.keyboard.press('Escape')
  await closed(card, `${where}: Escape closes a card opened by hover`)
  assert.equal(await picker.evaluate((element) => element.open), true, `${where}: the menu stays open`)
  await page.mouse.move(2, 2)
  await badge.hover()
  await card.waitFor({ state: 'visible' })
  await page.mouse.move(2, 2)
  await closed(card, `${where}: moving the pointer away closes the card`)
}

async function openPicker(page, picker) {
  await picker.locator(':scope > summary').click()
  await picker.locator('[data-picker-panel]').waitFor({ state: 'visible' })
  await picker.locator('[data-surface-search]').waitFor({ state: 'visible' })
}

/**
 * Check the status badges of the documentation picker on Go, Python and Java,
 * the homepage solution list, and a touch tap on a phone.
 */
export async function checkStatusBadges(browser, base, options = {}) {
  const { ports = PORTS_CHECKED, widths = [1440, 390], schemes = ['light', 'dark'], touch = true, home = true, timeout, sabotage } = options
  let rows = 0
  for (const scheme of schemes) {
    const context = await browser.newContext({ colorScheme: scheme, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(timeout ?? (process.env.CI ? 20000 : 10000))
    page.setDefaultNavigationTimeout(60000)
    try {
      for (const slug of ports) {
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 })
          await page.goto(`${base}/${slug}/latest/`, { waitUntil: 'load' })
          await page.waitForFunction(() => document.fonts.status === 'loaded')
          await page.waitForSelector('[data-documentation-context] [data-surface-picker][data-enhanced]', { state: 'attached' })
          if (sabotage?.css) await page.addStyleTag({ content: sabotage.css })
          if (sabotage?.script) await page.evaluate(sabotage.script)
          if (sabotage?.window) await page.evaluate(sabotage.window)
          const picker = page.locator('[data-documentation-context] [data-surface-picker]')
          const where = `${slug} at ${width}px (${scheme})`
          await openPicker(page, picker)
          await checkStructure(page, picker, slug, where)
          // Reveal each group so the label and badge can be compared in place.
          const expected = expectedRows(slug)
          for (const [index, { label, status }] of expected.entries()) {
            const badge = picker.locator('[data-surface-entry] .status-toggletip > .status-badge').nth(index)
            const labelBox = await picker.locator('[data-surface-entry]').nth(index).locator('.surface-label').boundingBox()
            const badgeBox = await badge.boundingBox()
            assert(badgeBox.x >= labelBox.x + labelBox.width + 2, `${where}: the ${label} badge clears its name`)
            if (scheme === 'light' && width === 1440 || width === 390 && index === 0) {
              await checkToggletip(page, picker, badge, status, label, `${where} ${label}`)
            }
            rows += 1
          }
          await page.keyboard.press('Escape')
        }
      }
      if (home && !sabotage) {
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto(`${base}/`, { waitUntil: 'load' })
        await page.waitForSelector('[data-home-launcher] .home-launcher-solution:not([hidden]) [data-surface-picker][data-enhanced]', { state: 'attached' })
        const picker = page.locator('[data-home-launcher] .home-launcher-solution:not([hidden]) [data-surface-picker]')
        await picker.locator(':scope > summary').click()
        await picker.locator('[data-picker-panel]').waitFor({ state: 'visible' })
        const destinations = await picker.locator('.surface-destination').count()
        assert(destinations > 0, 'the homepage lists solutions')
        assert.equal(await picker.locator('[data-surface-entry] .status-toggletip > .status-badge').count(), destinations, 'every homepage solution has a badge')
        assert.deepEqual(await picker.evaluate(nestedInteractive, INTERACTIVE), [], 'no homepage solution link holds a badge button')
        assert.equal(await picker.locator('.surface-destination .status-badge').count(), 0, 'a solution link holds no badge')
        rows += destinations
      }
    } finally {
      await context.close()
    }
  }
  if (touch && !sabotage) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
    page.setDefaultNavigationTimeout(60000)
    try {
      await page.goto(`${base}/go/latest/`, { waitUntil: 'load' })
      await page.waitForSelector('[data-documentation-context] [data-surface-picker][data-enhanced]', { state: 'attached' })
      const picker = page.locator('[data-documentation-context] [data-surface-picker]')
      await picker.locator(':scope > summary').tap()
      await picker.locator('[data-picker-panel]').waitFor({ state: 'visible' })
      const badge = picker.locator('[data-surface-entry] .status-toggletip > .status-badge').first()
      const card = cardOf(badge)
      await badge.tap()
      await card.waitFor({ state: 'visible' })
      assert.equal(await badge.getAttribute('aria-expanded'), 'true', 'a tap opens the card')
      await page.waitForTimeout(500)
      assert.equal(await isOpen(card), true, 'a tapped card stays open')
      assert.equal(await picker.evaluate((element) => element.open), true, 'a tap leaves the menu open')
      await badge.tap()
      await closed(card, 'a second tap closes the card')
    } finally {
      await context.close()
    }
  }
  console.log(`Status badges: ${rows} product rows on ${ports.join(', ')} carry a toggletip badge that opens on focus and hover${touch ? ' and tap' : ''}, links to the guide, closes on Escape and nests no control`)
}

/** The check must fail on origin/main's picker and on each way a badge could stop explaining itself. */
export async function checkStatusBadgesFail(browser, base) {
  const only = { ports: ['go'], widths: [1440], schemes: ['light'], timeout: 3000 }
  const controls = [
    ['origin/main markup', { script: originMainMarkup }, /every product row has a badge/],
    ['a badge inside its row control', {
      script: () => document.querySelectorAll('.surface-entry__badge').forEach((badge) => badge.closest('.surface-entry').querySelector('summary').append(badge)),
    }, /no interactive element sits inside another/],
    ['the footer status line', {
      script: () => {
        const key = document.createElement('p')
        key.className = 'surface-status-key'
        key.textContent = 'Concept and alpha: example support scope and release maturity.'
        document.querySelector('.surface-picker-footer').before(key)
      },
    }, /footer status line is gone/],
    ['a card that never shows', { css: '.status-toggletip__card { display: none !important }' }, /(?:Timeout|focus opens)/],
    ['hover opening', {
      window: () => window.addEventListener('pointerover', (event) => { if (event.target.closest?.('[data-status-toggletip]')) event.stopImmediatePropagation() }, true),
    }, /(?:Timeout|stays open under the pointer)/],
    ['Escape closing the card', {
      window: () => window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && event.target.closest?.('[data-status-toggletip]')) event.stopImmediatePropagation() }, true),
    }, /(?:Timeout|Escape closes the card)/],
    ['a link out of the tab order', {
      script: () => document.querySelectorAll('.status-toggletip__card a').forEach((link) => link.setAttribute('tabindex', '-1')),
    }, /Tab moves from the badge into the card's link/],
    ['a link to a missing section', {
      script: () => document.querySelectorAll('.status-toggletip__card a').forEach((link) => link.setAttribute('href', '/tmux/guides/concept-examples/#no-such-section')),
    }, /the guide has the #no-such-section section|goes to the concept and alpha section/],
  ]
  for (const [name, sabotage, failure] of controls) {
    await assert.rejects(() => checkStatusBadges(browser, base, { ...only, sabotage }), failure, `the check fails with ${name}`)
  }
  console.log('Status badges: the check fails on origin/main markup, nested controls, the footer line, a card that never shows, no hover, no Escape, an unreachable link and a broken section link')
}
