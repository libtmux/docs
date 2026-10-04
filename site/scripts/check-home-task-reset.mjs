import assert from 'node:assert/strict'

export async function checkHomeTaskReset(browser, base) {
  for (const blocked of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 914, height: 777 }, reducedMotion: 'reduce' })
    try {
      if (blocked) {
        await context.route('**/astro/runtime/client/dev-toolbar/entrypoint.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export {}' }))
        await context.addInitScript(() => Object.defineProperty(window, 'localStorage', {
          get() { throw new DOMException('Storage blocked', 'SecurityError') },
        }))
      }
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${base}/?port=ruby&from=a&from=b#prompt`)
      const widget = page.locator('.lm-agent-prompt')
      const select = widget.locator('[data-select="topic"]')
      const reset = widget.locator('[data-action="reset-topic"]')
      await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'ruby')
      assert.equal(await reset.isVisible(), false, 'The default task is not an explicit selection')
      await select.selectOption('session-switcher')
      assert(await reset.isVisible())
      assert.equal(new URL(page.url()).searchParams.get('prompt'), 'session-switcher')
      await page.reload()
      await page.waitForFunction(() => document.querySelector('.lm-agent-prompt [data-select="topic"]')?.value === 'session-switcher')
      assert(await reset.isVisible(), 'A shared task offers Reset after reload')
      await reset.click()
      assert.equal(await select.inputValue(), 'setup')
      assert.equal(new URL(page.url()).searchParams.has('prompt'), false)
      assert.equal(new URL(page.url()).searchParams.get('port'), 'ruby')
      assert.deepEqual(new URL(page.url()).searchParams.getAll('from'), ['a', 'b'])
      assert.equal(new URL(page.url()).hash, '#prompt')
      assert.equal(await reset.isVisible(), false)
      assert(await select.evaluate((element) => element === document.activeElement), 'Reset moves focus to the task selector')
      if (!blocked) assert.equal(await page.evaluate(() => localStorage.getItem('libtmux-docs.agent-prompt.topic')), null)
      assert.match(await widget.locator('[data-port="ruby"] [data-prompt-text]').innerText(), /^Set up libtmux/)
      await page.reload()
      await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'ruby')
      assert.equal(await select.inputValue(), 'setup')
      assert.equal(await reset.isVisible(), false, 'A cleared task stays cleared after reload')

      // Choosing the default explicitly and rerolling also expose Reset.
      await widget.locator('[data-action="reroll"]').click()
      assert(await reset.isVisible())
      await select.selectOption('setup')
      assert(await reset.isVisible())
      assert.equal(new URL(page.url()).searchParams.get('prompt'), 'setup')
      if (!blocked) {
        await page.goto(`${base}/?port=ruby`)
        await page.waitForFunction(() => !document.querySelector('.lm-agent-prompt [data-action="reset-topic"]')?.hidden)
        assert.equal(await select.inputValue(), 'setup', 'A saved explicit default can be reset')
      }
      for (const width of [914, 640, 390, 320, 280]) {
        await page.setViewportSize({ width, height: 777 })
        await select.selectOption('session-supervisor')
        const geometry = await widget.locator('.lm-agent-prompt__controls').evaluate((bar) => {
          const bounds = (selector) => {
            const { x, y, width, height } = bar.querySelector(selector).getBoundingClientRect()
            return { x, y, width, height, center: y + height / 2 }
          }
          return { client: bar.clientWidth, scroll: bar.scrollWidth, bar: bar.getBoundingClientRect().toJSON(),
            select: bounds('[data-select="topic"]'), reroll: bounds('[data-action="reroll"]'), reset: bounds('[data-action="reset-topic"]') }
        })
        assert(geometry.scroll <= geometry.client + 1, `${width}: task bar does not overflow ${JSON.stringify(geometry)}`)
        assert(Math.abs(geometry.select.center - geometry.reset.center) < 1, `${width}: Reset stays on the task row`)
        assert(Math.abs(geometry.select.center - geometry.reroll.center) < 1, `${width}: reroll stays on the task row`)
        assert(geometry.select.width >= 100, `${width}: the selector remains usable`)
        assert(await select.getAttribute('title'), 'The full task description remains available when abbreviated')
        await reset.click()
      }
      assert.deepEqual(errors, [])
    } finally {
      await context.close()
    }
  }
  console.log('Task reset: selection, reroll, URL/storage, reload, focus and single-row controls at 280–914px, with and without storage PASS')
}
