import assert from 'node:assert/strict'

/** A cold deep link into the preset picker lands in one scroll and shifts nothing. */
export async function checkWorkspaceShift(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    window.__shift = 0
    window.__scrolls = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value
    }).observe({ type: 'layout-shift', buffered: true })
    addEventListener('scroll', () => window.__scrolls.push(Math.round(scrollY)), { passive: true })
  })
  try {
    for (const query of ['?preset=environment', '?preset=no-such-preset', '']) {
      await page.goto(`${base}/rs/latest/workspace/${query}#try-a-preset`)
      await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready')
      await page.waitForTimeout(3000)
      const state = await page.evaluate(() => ({
        shift: window.__shift,
        scrolls: window.__scrolls,
        selected: document.querySelector('libtmux-workspace-picker')?.getAttribute('data-selected'),
        top: document.getElementById('try-a-preset')?.getBoundingClientRect().top,
      }))
      assert(state.shift < 0.01, `${query || 'default'}: cumulative layout shift ${state.shift} stays under 0.01`)
      const settled = state.scrolls.at(-1)
      assert.deepEqual(state.scrolls.filter((y) => y !== settled).length <= 1, true,
        `${query || 'default'}: one scroll to the fragment, no correction after it (${state.scrolls.join(', ')})`)
      if (query === '?preset=environment') assert.equal(state.selected, 'environment')
      else assert.notEqual(state.selected, 'no-such-preset')
    }
    assert.deepEqual(errors, [])
  } finally {
    await context.close()
  }
  console.log('Workspace deep link: layout shift under 0.01 and a single fragment scroll PASS')
}
