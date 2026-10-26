import assert from 'node:assert/strict'
import { CONCEPT_DESCRIPTION, PICKER_GROUP_SUMMARY, PORT_BY_SLUG, PRODUCT_STATUS_GUIDE, PRODUCT_STATUS_LINK, productStatusLine, productAvailable, productStatus } from '../src/lib/ports.ts'
import registry from '../src/data/registry.json' with { type: 'json' }
import { HOVER_OPEN } from '../src/lib/status-toggletip.ts'

/**
 * Every product (Core Library, MCP, Workspace Manager) in the documentation
 * picker and the homepage solution menu has one status badge beside its name:
 * `concept` for a working example, else its release stage. The badge is a
 * toggletip with one short line and a link to the guide. It opens on hover,
 * keyboard focus and a tap, closes on Escape, and sits beside a row's control
 * rather than inside it. A row shows its label and one summary line, nothing more.
 */
const PORTS_CHECKED = ['rs', 'go', 'py', 'julia', 'java']
const INTERACTIVE = 'a[href], button, summary, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]'
const PRODUCTS = [['core', 'Core Library'], ['mcp', 'MCP'], ['workspace', 'Workspace Manager']]
// A summary line is about as long as "Repeatable development environments"; a toggletip line is about eight words.
const SUMMARY_BUDGET = 48
const TOGGLETIP_BUDGET = 60

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

/** The text blocks of a menu: every paragraph and small line, with the lines a row shows under its label. */
const readText = (panel) => {
  const lines = (element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
  }
  const long = [...panel.querySelectorAll('p, small')].filter((element) => !element.hasAttribute('data-picker-status'))
    .map((element) => ({ tag: element.tagName.toLowerCase(), cls: element.className, text: element.textContent.replace(/\s+/g, ' ').trim() }))
  const rows = [...panel.querySelectorAll('[data-surface-entry]')].map((entry) => ({
    label: entry.querySelector('.surface-label')?.textContent.trim(),
    paragraphs: entry.querySelectorAll('p').length,
    summaries: [...entry.querySelectorAll(':scope > details > summary small, :scope > a small')]
      .map((small) => ({ text: small.textContent.replace(/\s+/g, ' ').trim(), lines: lines(small) })),
  }))
  return { long, rows }
}

/** The pre-badge picker and solution menu: no badge on the library, a concept chip inside each companion's control, a paragraph and a footer line. */
const originMainMarkup = (concept) => {
  const element = (tag, props) => Object.assign(document.createElement(tag), props)
  for (const badge of document.querySelectorAll('.surface-entry__badge')) badge.remove()
  for (const label of [...document.querySelectorAll('.surface-entry .surface-label')].slice(1)) {
    label.after(element('span', { className: 'concept-badge', textContent: 'concept' }))
  }
  for (const small of [...document.querySelectorAll('.surface-entry summary small, .surface-entry a small')].slice(1)) small.textContent = concept
  for (const group of [...document.querySelectorAll('.surface-entry .surface-group')].slice(1)) {
    group.querySelector('.surface-options')?.before(element('p', { className: 'surface-concept-description', textContent: concept }))
  }
  const key = element('p', { className: 'surface-status-key' })
  key.append(element('a', { href: '/meta/support/', textContent: 'Concept and alpha' }), ': example support scope and release maturity.')
  document.querySelector('.surface-picker-footer')?.before(key)
}

async function checkRows(page, picker, slug, where, kind) {
  const rows = expectedRows(slug)
  const entries = picker.locator('[data-surface-entry]')
  assert.deepEqual(await entries.locator('.surface-label').allTextContents(), rows.map(({ label }) => label), `${where}: one entry per product, in order`)
  const anchored = await page.evaluate(() => CSS.supports('anchor-name', '--a'))
  for (const [index, { label, status }] of rows.entries()) {
    const badges = entries.nth(index).locator('.status-badge')
    assert.equal(await badges.count(), 1, `${where}: ${label} has exactly one status badge`)
    assert.equal(await badges.first().getAttribute('data-status'), status, `${where}: ${label} states ${status}`)
    assert.equal(await badges.first().evaluate((element) => element.firstChild.textContent), status, `${where}: ${label} badge reads ${status}`)
  }
  assert.deepEqual(await picker.evaluate(nestedInteractive, INTERACTIVE), [], `${where}: no interactive element sits inside another`)
  assert.equal(await picker.locator('.surface-status-key').count(), 0, `${where}: the footer status line is gone`)
  let listGap
  for (const [index, { label, status }] of rows.entries()) {
    const entry = entries.nth(index)
    const badge = entry.locator('.status-badge').first()
    // Beside its name, on the same line, and clear of it.
    const labelBox = await entry.locator('.surface-label').boundingBox()
    const badgeBox = await badge.boundingBox()
    assert(badgeBox.x >= labelBox.x + labelBox.width + 2, `${where}: the ${label} badge clears its name`)
    if (anchored) {
      listGap ??= badgeBox.x - (labelBox.x + labelBox.width)
      assert(badgeBox.x - (labelBox.x + labelBox.width) <= 16, `${where}: the ${label} badge sits beside its name (${Math.round(badgeBox.x - labelBox.x - labelBox.width)}px away)`)
      assert(Math.abs(badgeBox.y + badgeBox.height / 2 - labelBox.y - labelBox.height / 2) <= 4, `${where}: the ${label} badge shares its name's line`)
    }
    assert.equal(await entry.getByRole('button', { name: `${status} status of ${label}`, exact: true }).count(), 1, `${where}: ${label} badge is named for its product`)
    const card = cardOf(badge)
    assert.equal(await badge.getAttribute('aria-controls'), await card.getAttribute('id'), `${where}: ${label} badge controls its card`)
    assert.equal(await badge.getAttribute('aria-expanded'), 'false', `${where}: ${label} card starts closed`)
    assert.equal(await isOpen(card), false, `${where}: ${label} card starts closed`)
  }
  const text = await picker.locator('[data-picker-panel]').evaluate(readText)
  for (const row of text.rows) {
    assert.equal(row.paragraphs, 0, `${where}: ${row.label} shows no paragraph`)
    assert.equal(row.summaries.length, 1, `${where}: ${row.label} shows one summary line under its label`)
    const [summary] = row.summaries
    assert(summary.text.length <= SUMMARY_BUDGET && summary.lines <= 1,
      `${where}: ${row.label} summary line stays short and on one line (${summary.text.length} characters, ${summary.lines} lines: "${summary.text}")`)
    const product = PRODUCTS.find(([, label]) => label === row.label)[0]
    assert.equal(summary.text, PICKER_GROUP_SUMMARY[product], `${where}: ${row.label} says what the product does, the same on every port`)
  }
  for (const block of text.long) {
    assert(block.text.length <= SUMMARY_BUDGET, `${where}: a ${block.tag}.${block.cls} block in the menu holds ${block.text.length} characters: "${block.text.slice(0, 60)}"`)
  }
  if (kind === 'picker') {
    // The trigger carries the same word as a plain label: it is a control, so it cannot hold a second one.
    const current = picker.locator(':scope > summary .status-badge')
    assert.equal(await current.count(), 1, `${where}: the trigger shows its product's badge`)
    assert.equal(await current.getAttribute('data-status'), rows[0].status, `${where}: the trigger states ${rows[0].status}`)
    assert.equal(await current.evaluate((element) => element.tagName), 'SPAN', `${where}: the trigger's badge is a label`)
    assert.equal(await current.getAttribute('tabindex'), null, `${where}: the trigger's badge takes no focus`)
    // The trigger repeats the list's row, so its name and badge sit the same distance apart.
    if (listGap !== undefined) {
      const name = await picker.locator(':scope > summary .surface-label').boundingBox()
      const gap = (await current.boundingBox()).x - (name.x + name.width)
      assert(Math.abs(gap - listGap) <= 1, `${where}: the trigger's badge sits ${gap.toFixed(1)}px from its name, the list's ${listGap.toFixed(1)}px`)
    }
    const description = await picker.locator(':scope > summary').getAttribute('aria-description')
    assert.equal(description, productStatusLine(rows[0].status), `${where}: the trigger is described by the short line`)
  }
}

async function checkToggletip(page, picker, badge, status, label, where) {
  const card = cardOf(badge)
  const link = card.locator('a')
  // Keyboard focus opens it.
  await badge.focus()
  await card.waitFor({ state: 'visible' })
  assert.equal(await badge.getAttribute('aria-expanded'), 'true', `${where}: focus opens the ${status} card`)
  assert.equal((await card.locator('.status-toggletip__title').innerText()).trim(), status, `${where}: the card is titled with the stage`)
  const line = (await card.locator('.status-toggletip__line').innerText()).trim()
  assert(line.length <= TOGGLETIP_BUDGET, `${where}: the card's line is ${line.length} characters, over the ${TOGGLETIP_BUDGET} budget: "${line}"`)
  assert.equal(line, productStatusLine(status), `${where}: the card holds the ${status} line`)
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
  assert.equal((await link.innerText()).trim(), PRODUCT_STATUS_LINK, `${where}: the link says Read more`)
  // Escape closes the card, returns focus to the badge and leaves the menu open.
  await page.keyboard.press('Escape')
  await closed(card, `${where}: Escape closes the card`)
  assert.equal(await badge.getAttribute('aria-expanded'), 'false', `${where}: Escape collapses the badge`)
  assert(await badge.evaluate((element) => element === document.activeElement), `${where}: Escape returns focus to the badge`)
  assert.equal(await picker.evaluate((element) => element.open), true, `${where}: Escape closes the card before the menu`)
  // Moving focus away closes it.
  await picker.locator('[data-picker-search]').focus()
  await closed(card, `${where}: leaving the badge closes the card`)
  // Hover opens it only after the pointer rests, stays open over the card, and Escape closes it without moving the pointer.
  await page.mouse.move(2, 2)
  await badge.hover()
  await page.waitForTimeout(HOVER_OPEN / 2)
  assert.equal(await isOpen(card), false, `${where}: a passing pointer leaves the card closed for ${HOVER_OPEN}ms`)
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

async function openPicker(picker) {
  await picker.locator(':scope > summary').click()
  await picker.locator('[data-picker-panel]').waitFor({ state: 'visible' })
  await picker.locator('[data-surface-search]').waitFor({ state: 'visible' })
}

async function applySabotage(page, sabotage) {
  if (sabotage?.css) await page.addStyleTag({ content: sabotage.css })
  if (sabotage?.script) await page.evaluate(sabotage.script, sabotage.arg)
  if (sabotage?.window) await page.evaluate(sabotage.window)
}

/**
 * Check the status badges of the documentation picker and the homepage solution
 * menu on Rust, Go, Python, Julia and Java, and a touch tap on a phone.
 */
export async function checkStatusBadges(browser, base, options = {}) {
  const { ports = PORTS_CHECKED, menus = ['picker', 'solutions'], widths = [1440, 390], schemes = ['light', 'dark'],
    touch = true, timeout, sabotage } = options
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
          for (const menu of menus) {
            const solutions = menu === 'solutions'
            // The homepage opens on its default language and switches to ?port= once its script runs, so wait for this port's menu.
            const root = solutions ? `[data-home-launcher] .home-launcher-solution[data-home-language="${slug}"]:not([hidden])` : '[data-documentation-context]'
            // The development server can replace a page while it optimizes dependencies; load it again once.
            for (const attempt of [1, 2]) {
              try {
                await page.goto(solutions ? `${base}/?port=${slug}` : `${base}/${slug}/latest/`, { waitUntil: 'load' })
                await page.waitForFunction(() => document.fonts.status === 'loaded')
                await page.waitForSelector(`${root} [data-surface-picker][data-enhanced]`, { state: 'attached' })
                break
              } catch (error) {
                if (attempt === 2) throw error
              }
            }
            await applySabotage(page, sabotage)
            const picker = page.locator(`${root} [data-surface-picker]`)
            const where = `${solutions ? 'solution menu' : 'picker'} ${slug} at ${width}px (${scheme})`
            await openPicker(picker)
            await checkRows(page, picker, slug, where, solutions ? 'solutions' : 'picker')
            const expected = expectedRows(slug)
            for (const [index, { label, status }] of expected.entries()) {
              // Behavior once per page on a wide screen, and the first row on a phone.
              if ((scheme === 'light' && width === 1440) || (width === 390 && index === 0)) {
                await checkToggletip(page, picker, picker.locator('[data-surface-entry] .status-toggletip > .status-badge').nth(index), status, label, `${where} ${label}`)
              }
              rows += 1
            }
            await page.keyboard.press('Escape')
          }
        }
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
  console.log(`Status badges: ${rows} product rows in the picker and solution menu on ${ports.join(', ')} each carry one badge beside the name with its stage, a toggletip of one short line that opens on focus and hover${touch ? ' and tap' : ''}, links to the guide, closes on Escape, and no row shows more than a summary line`)
}

/** The check must fail on the pre-badge markup and on each way a badge or a row could regress. */
export async function checkStatusBadgesFail(browser, base) {
  const only = { ports: ['go'], widths: [1440], schemes: ['light'], timeout: 3000 }
  const picker = { ...only, menus: ['picker'] }
  const solutions = { ...only, menus: ['solutions'] }
  const longText = (scope) => {
    for (const small of [...document.querySelectorAll(`${scope} small`)].slice(1)) small.textContent = 'Maintained as a working example of core library usage and deployment. Example APIs may change.'
  }
  const controls = [
    ['the pre-badge picker markup', picker, { script: originMainMarkup, arg: CONCEPT_DESCRIPTION }, /Core Library has exactly one status badge/],
    ['the pre-badge solution menu markup', solutions, { script: originMainMarkup, arg: CONCEPT_DESCRIPTION }, /Core Library has exactly one status badge/],
    ['a second badge on a row', picker, {
      script: () => document.querySelectorAll('.surface-entry').forEach((entry) => entry.querySelector('.surface-label').after(Object.assign(document.createElement('span'), { className: 'status-badge', textContent: 'alpha' }))),
    }, /has exactly one status badge/],
    ['a wrong stage', picker, {
      script: () => document.querySelector('.status-toggletip > .status-badge').setAttribute('data-status', 'concept'),
    }, /Core Library states (?!concept\b)\S+/],
    ['a badge far from its name', picker, {
      css: '.surface-entry > .surface-entry__badge { left: auto !important; right: 2.1rem !important; top: 1.15rem !important; translate: none !important }',
    }, /badge sits beside its name/],
    ['a trigger badge pressed against its name', picker, {
      css: '.surface-current .surface-current__badge { margin-inline-start: 0 !important }',
    }, /trigger's badge sits .*px from its name/],
    ['the concept paragraph in the picker', picker, {
      script: () => document.querySelectorAll('.surface-entry .surface-group').forEach((group, index) => {
        if (index > 0) group.querySelector('.surface-options').before(Object.assign(document.createElement('p'), { className: 'surface-concept-description', textContent: 'Maintained as a working example of core library usage and deployment. Example APIs, tools and configuration may change without a compatibility or product support commitment.' }))
      }),
    }, /shows no paragraph/],
    ['a long summary in the solution menu', solutions, { script: longText, arg: '.surface-destination' }, /summary line stays short and on one line/],
    ['the concept summary as a row summary', picker, {
      script: () => document.querySelectorAll('.surface-group > summary small').forEach((small, index) => { if (index > 0) small.textContent = 'Working example of the core library' }),
    }, /says what the product does/],
    ['a long summary in the picker', picker, { script: longText, arg: '.surface-group > summary' }, /summary line stays short and on one line/],
    ['a long toggletip sentence', picker, {
      script: () => document.querySelectorAll('.status-toggletip__line').forEach((line) => { line.textContent = 'Maintained as a working example of core library usage and deployment. Example APIs, tools and configuration may change.' }),
    }, /over the 60 budget/],
    ['the footer status line', picker, {
      script: () => {
        const key = document.createElement('p')
        key.className = 'surface-status-key'
        key.textContent = 'Concept and alpha: example support scope and release maturity.'
        document.querySelector('.surface-picker-footer').before(key)
      },
    }, /footer status line is gone|block in the menu holds/],
    ['a badge inside its row control', picker, {
      script: () => document.querySelectorAll('.surface-entry__badge').forEach((badge) => badge.closest('.surface-entry').querySelector('summary').append(badge)),
    }, /no interactive element sits inside another/],
    ['a card that never shows', picker, { css: '.status-toggletip__card { display: none !important }' }, /(?:Timeout|focus opens)/],
    ['a card that opens the moment the pointer arrives', picker, {
      window: () => window.addEventListener('pointerover', (event) => {
        const card = event.target.closest?.('[data-status-toggletip]')?.querySelector(':scope > [popover]')
        if (card && !card.matches(':popover-open')) card.showPopover()
      }, true),
    }, /a passing pointer leaves the card closed/],
    ['hover opening', picker, {
      window: () => window.addEventListener('pointerover', (event) => { if (event.target.closest?.('[data-status-toggletip]')) event.stopImmediatePropagation() }, true),
    }, /(?:Timeout|stays open under the pointer)/],
    ['Escape closing the card', picker, {
      window: () => window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && event.target.closest?.('[data-status-toggletip]')) event.stopImmediatePropagation() }, true),
    }, /(?:Timeout|Escape closes the card)/],
    ['a link out of the tab order', picker, {
      script: () => document.querySelectorAll('.status-toggletip__card a').forEach((link) => link.setAttribute('tabindex', '-1')),
    }, /Tab moves from the badge into the card's link/],
    ['a link to a missing section', picker, {
      script: () => document.querySelectorAll('.status-toggletip__card a').forEach((link) => link.setAttribute('href', '/meta/support/#no-such-section')),
    }, /the guide has the #no-such-section section|goes to the concept and alpha section/],
  ]
  for (const [name, scope, sabotage, failure] of controls) {
    await assert.rejects(() => checkStatusBadges(browser, base, { ...scope, sabotage }), failure, `the check fails with ${name}`)
  }
  console.log('Status badges: the check fails on the pre-badge picker and solution menu (no badge on Core Library), a second or wrong badge, a distant badge, a trigger badge closer to its name than in the list, a paragraph or long summary in a row, a long toggletip line, the footer line, a nested badge, a card that never shows, a card that opens without the hover delay, no hover, no Escape, an unreachable link and a broken section link')
}
