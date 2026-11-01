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
    window.__sources = []
    window.__notice = []
    // The notice's link wraps with the styles it has; a change between snapshots names the late rule.
    const snapshot = (label) => {
      const link = document.querySelector('aside.lm-aside a')
      if (!link) return
      const code = link.querySelector('code') ?? link
      const style = getComputedStyle(code)
      window.__notice.push(`${label}@${Math.round(performance.now())}ms sheets=${document.styleSheets.length} h=${Math.round(link.getBoundingClientRect().height)} ws=${style.whiteSpace} wrap=${style.overflowWrap} fs=${style.fontSize} ff=${style.fontFamily.slice(0, 24)}`)
    }
    for (const type of ['DOMContentLoaded', 'load', 'libtmux:page-ready']) (type === 'DOMContentLoaded' || type === 'load' ? window : document).addEventListener(type, () => snapshot(type))
    const name = (node) => {
      if (!node || node.nodeType !== 1) return String(node?.nodeName)
      const classes = [...node.classList].slice(0, 2).map((c) => `.${c}`).join('')
      return `${node.localName}${node.id ? `#${node.id}` : ''}${classes}`
    }
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue
        window.__shift += entry.value
        // Name what moved, so a failure points at the element that grew.
        for (const source of entry.sources ?? []) {
          window.__sources.push(`${Math.round(entry.startTime)}ms ${name(source.node)} ${Math.round(source.previousRect.y)}->${Math.round(source.currentRect.y)} h ${Math.round(source.previousRect.height)}->${Math.round(source.currentRect.height)}`)
        }
      }
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
        sources: window.__sources,
        notice: window.__notice,
        scrolls: window.__scrolls,
        selected: document.querySelector('libtmux-workspace-picker')?.getAttribute('data-selected'),
        top: document.getElementById('try-a-preset')?.getBoundingClientRect().top,
      }))
      assert(state.shift < 0.01, `${query || 'default'}: cumulative layout shift ${state.shift} stays under 0.01 (${state.sources.join('; ')}; notice ${state.notice.join(' | ')})`)
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
