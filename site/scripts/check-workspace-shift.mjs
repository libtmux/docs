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
    window.__starts = []
    window.__samples = []
    // From navigation start, once a frame: widths, the article's children and the notice link. A line is kept only
    // when something in it changed, so the samples on both sides of a shift show what moved first.
    const round = (value) => Math.round(value ?? -1)
    const box = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect()
      return rect ? `${round(rect.width)}x${round(rect.height)}@${round(rect.top + scrollY)}` : 'none'
    }
    let last = ''
    const sample = () => {
      if (document.documentElement) {
        const link = document.querySelector('aside.lm-aside a')
        const children = [...(document.querySelector('article.prose')?.children ?? [])]
          .map((node) => `${node.localName}${node.id ? `#${node.id}` : ''}${[...node.classList].slice(0, 1).map((c) => `.${c}`).join('')}:${round(node.getBoundingClientRect().height)}`)
          .join(' ')
        const fonts = [...(document.fonts ?? [])].filter((face) => face.status === 'loaded').length
        const line = `main=${box('main')} notice=${box('aside.lm-aside')} p=${box('aside.lm-aside p.mb-0')} panel=${box('.ws-picker__panel')} `
          + `link=${link ? `${link.getClientRects().length}r h${round(link.getBoundingClientRect().height)}` : 'none'} `
          + `sheets=${document.styleSheets.length} fonts=${fonts} cls=[${[...document.documentElement.classList].join(' ')}] ready=${document.documentElement.dataset.pageReadiness} children[${children}]`
        if (line !== last) window.__samples.push({ t: Math.round(performance.now()), line })
        last = line
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    const name = (node) => {
      if (!node || node.nodeType !== 1) return String(node?.nodeName)
      const classes = [...node.classList].slice(0, 2).map((c) => `.${c}`).join('')
      return `${node.localName}${node.id ? `#${node.id}` : ''}${classes}`
    }
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue
        window.__shift += entry.value
        window.__starts.push(Math.round(entry.startTime))
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
        samples: window.__samples,
        starts: window.__starts,
        scrolls: window.__scrolls,
        selected: document.querySelector('libtmux-workspace-picker')?.getAttribute('data-selected'),
        top: document.getElementById('try-a-preset')?.getBoundingClientRect().top,
      }))
      if (state.shift >= 0.01) {
        // The changed samples within 400 ms either side of each shift, the first being what the page looked like just before.
        const near = state.samples.filter((sample, index) => state.starts.some((at) => sample.t >= at - 400 && sample.t <= at + 400)
          || (state.samples[index + 1] && state.starts.some((at) => state.samples[index + 1].t >= at - 400 && state.samples[index + 1].t <= at + 400)))
        console.error(`${query || 'default'}: shifts at ${state.starts.join(', ')} ms\n${state.sources.join('\n')}\n--- samples (ms, changed fields only)\n${near.map((sample) => `${sample.t} ${sample.line}`).join('\n')}`)
      }
      assert(state.shift < 0.01, `${query || 'default'}: cumulative layout shift ${state.shift} stays under 0.01 (${state.sources.join('; ')})`)
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

// node scripts/check-workspace-shift.mjs [http://127.0.0.1:53971/en]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    await checkWorkspaceShift(browser, (process.argv[2] ?? 'http://127.0.0.1:53971/en').replace(/\/$/, ''))
  } finally {
    await browser.close()
  }
}
