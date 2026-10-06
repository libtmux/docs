import assert from 'node:assert/strict'

async function bounds(page, panel) {
  const box = await panel.boundingBox()
  const viewport = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: innerHeight }))
  assert(box && box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.width - 7
    && box.y + box.height <= viewport.height - 7, `Picker stays within the viewport: ${JSON.stringify({ box, viewport })}`)
}

async function exercise(page, selector, query, count) {
  const picker = page.locator(selector)
  const trigger = picker.locator(':scope > summary')
  await trigger.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  await trigger.click()
  const search = picker.locator('[data-picker-search]')
  await search.waitFor({ state: 'visible' })
  assert(await search.evaluate((node) => node === document.activeElement), 'Opening focuses search')
  const panel = picker.locator('[data-picker-panel]')
  await bounds(page, panel)
  const dimensions = await panel.evaluate((node) => ({ height: node.clientHeight, scroll: node.scrollHeight }))
  assert(dimensions.scroll > dimensions.height, 'The fixture requires actual scrolling')
  const before = await page.evaluate(() => scrollY)
  await panel.hover()
  await page.mouse.wheel(0, 400)
  await page.waitForFunction((selector) => document.querySelector(selector).querySelector('[data-picker-panel]').scrollTop > 0, selector)
  assert.equal(await page.evaluate(() => scrollY), before, 'Scrolling stays inside the menu')
  await search.fill(query)
  assert.equal(await picker.locator('[data-picker-option]:visible').count(), 1, 'Search filters the options')
  await bounds(page, panel)
  await search.fill('no-such-entry-xyz')
  assert.equal(await picker.locator('[data-picker-option]:visible').count(), 0)
  assert(await picker.locator('[data-picker-empty]').isVisible(), 'Unknown queries show an empty state')
  await search.fill('')
  assert.equal(await picker.locator('[data-picker-option]:visible').count(), count, 'Clearing restores every option')
  await search.press('ArrowDown')
  const options = picker.locator('[data-picker-option]:visible')
  assert(await options.first().evaluate((node) => node === document.activeElement))
  await page.keyboard.press('End')
  assert(await options.last().evaluate((node) => node === document.activeElement), 'End reaches the final option')
  const last = await options.last().boundingBox()
  const box = await panel.boundingBox()
  assert(last.y >= box.y && last.y + last.height <= box.y + box.height, 'Keyboard navigation scrolls the final option into view')
  await page.keyboard.press('Escape')
  assert.equal(await picker.getAttribute('open'), null)
  assert(await trigger.evaluate((node) => node === document.activeElement), 'Escape returns focus')
  const documentScroll = await page.evaluate(() => scrollY)
  await trigger.click()
  await search.waitFor({ state: 'visible' })
  const input = await search.boundingBox()
  const reopened = await panel.boundingBox()
  assert(input && reopened && input.y >= reopened.y && input.y + input.height <= reopened.y + reopened.height,
    'Reopening brings the focused search back into the menu viewport')
  assert(await search.evaluate((node) => node === document.activeElement), 'Reopening focuses search')
  assert.equal(await page.evaluate(() => scrollY), documentScroll, 'Reopening preserves document scroll')
  await page.keyboard.press('Escape')
  assert(await picker.locator('a[href^="#"]').evaluateAll((links) => links.every((link) =>
    document.getElementById(decodeURIComponent(link.hash.slice(1))))), 'Every sample link has an existing destination')
}

/** Real widgets, dense lists, and delayed manifest updates share filtering. */
export async function checkPickerFilters(browser, base, complete = false) {
  const sizes = complete ? [{ width: 853, height: 789 }, { width: 320, height: 360 }, { width: 280, height: 320 }] : [{ width: 320, height: 360 }]
  for (const colorScheme of complete ? ['light', 'dark'] : ['light']) {
    const context = await browser.newContext({ colorScheme, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    try {
      for (const viewport of sizes) {
        console.log(`Picker filters: ${colorScheme}, ${viewport.width}×${viewport.height}`)
        await page.setViewportSize(viewport)
        await page.goto(`${base}/demo/widgets/pickers/`)
        await page.locator('[data-demo-add-locales]').click()
        await exercise(page, '[data-demo-versions] [data-version-picker]', '1.12.0', 41)
        await exercise(page, '[data-demo-locales] [data-locale-picker]', 'sample language 12', 43)
      }
    } finally { await context.close() }
  }
  if (!complete) return

  const context = await browser.newContext({ viewport: { width: 853, height: 789 }, reducedMotion: 'reduce' })
  let release
  const pending = new Promise((resolve) => { release = resolve })
  await context.route('**/versions.json', async (route) => {
    await pending
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema: 1, ports: { kotlin: [
      { slug: 'latest', label: 'latest', kind: 'trunk', supported: true },
      { slug: 'v1.12.0', label: 'v1.12.0', kind: 'release', supported: true },
      { slug: 'v1.13.0-alpha.1', label: 'v1.13.0-alpha.1', kind: 'release', supported: true },
    ] } }) })
  })
  try {
    const page = await context.newPage()
    await page.goto(`${base}/demo/widgets/pickers/`)
    const picker = page.locator('[data-demo-published] [data-version-picker]')
    await picker.locator(':scope > summary').click()
    const search = picker.locator('[data-picker-search]')
    await search.fill('1.12')
    assert(await picker.locator('[data-picker-empty]').isVisible())
    release()
    await picker.getByRole('link', { name: 'v1.12.0', exact: true }).waitFor()
    assert.equal(await picker.locator('[data-picker-option]:visible').count(), 1, 'A delayed manifest respects the active query')
    assert.deepEqual(await picker.locator('[data-picker-group]:visible .doc-picker-title').allTextContents(), ['Releases'])
    await search.fill('prereleases')
    assert.equal(await picker.locator('[data-picker-option]:visible').count(), 1)
    assert.deepEqual(await picker.locator('[data-picker-group]:visible .doc-picker-title').allTextContents(), ['Prereleases'])
    await search.fill('')
    assert.equal(await picker.locator('[data-picker-option]:visible').count(), 3)
    await bounds(page, picker.locator('[data-picker-panel]'))
    await page.keyboard.press('Escape')
    await page.locator('[data-demo-add-locales]').click()
    const locales = page.locator('[data-demo-locales] [data-locale-picker]')
    await locales.locator(':scope > summary').click()
    await locales.locator('[data-picker-search]').fill('sample language 12')
    await locales.getByRole('link', { name: 'Sample language 12', exact: true }).click()
    assert.equal(new URL(page.url()).hash, '#demo-locales')
    const versions = page.locator('[data-demo-versions] [data-version-picker]')
    await versions.locator(':scope > summary').click()
    await versions.locator('[data-picker-search]').fill('1.12.0')
    await versions.getByRole('link', { name: 'v1.12.0', exact: true }).click()
    assert.equal(new URL(page.url()).hash, '#demo-versions', 'Sample versions use their own destination after choosing a sample language')
  } finally { release(); await context.unrouteAll({ behavior: 'wait' }); await context.close() }

  const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 853, height: 789 } })
  try {
    const page = await noScript.newPage()
    await page.goto(`${base}/demo/widgets/pickers/`)
    const picker = page.locator('[data-demo-versions] [data-version-picker]')
    await picker.locator(':scope > summary').click()
    assert(!await picker.locator('[data-picker-search]').isVisible(), 'No inactive search is exposed without JavaScript')
    assert.equal(await picker.locator('a').count(), 41)
    const panel = picker.locator('[data-picker-panel]')
    assert(await panel.evaluate((node) => node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY === 'auto'))
    await picker.locator('a').last().click()
    assert.equal(new URL(page.url()).hash, '#demo-versions', 'No-JavaScript version links remain usable')
    assert.equal(await page.locator(new URL(page.url()).hash).count(), 1, 'The sample destination exists')
  } finally { await noScript.close() }
  console.log('Picker filters: both themes, 280–853px, short viewports, wheel/keyboard scrolling, reopening, delayed versions, and no JavaScript PASS')
}
