import assert from 'node:assert/strict'
import { PORTS } from '../src/lib/ports.ts'

/** Exercise the real homepage, including the prompt controlled by its picker. */
export async function checkHomeLauncher(browser, base) {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const language = page.locator('[data-home-launcher] [data-page-port-switcher]')
  const solution = page.locator('.home-launcher-solution:not([hidden])')
  const prompt = page.locator('.lm-agent-prompt')
  const choose = async (port) => {
    await language.locator('summary').click()
    await language.locator(`a[data-port="${port}"]`).click()
    await page.waitForFunction((port) => document.querySelector('.lm-agent-prompt')?.dataset.activePort === port, port)
    assert(await page.locator(`.home-examples [data-home-language="${port}"]`).isVisible())
    assert.equal(await solution.getAttribute('data-home-language'), port)
    const cards = await page.locator(`.home-intro [data-home-language="${port}"] .home-solutions > a`).evaluateAll((links) => links.map((link) => ({
      display: getComputedStyle(link).display,
      border: getComputedStyle(link).borderTopWidth,
      label: getComputedStyle(link.querySelector('strong')).display,
      description: getComputedStyle(link.querySelector('small')).display,
    })))
    assert(cards.length > 0 && cards.every((card) => card.display === 'flex' && card.border === '1px'
      && card.label === 'block' && card.description === 'block'), `${port}: solution cards retain their layout and borders`)
  }
  try {
    await page.goto(`${base}/`)
    await page.locator('[data-home-launcher] [data-page-port-switcher][data-enhanced]').waitFor()
    assert.equal(await prompt.locator('[role="tablist"]').count(), 0, 'Homepage has one language picker')
    assert.equal(await page.getByRole('heading', { name: /^(Language libraries|Read the docs)$/ }).count(), 0)
    for (const { slug } of PORTS) {
      await choose(slug)
      const links = await solution.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
      assert(links.length > 0 && links.every((href) => href.startsWith(`${new URL(base).pathname}/${slug}/`)), `${slug}: owned solution destinations`)
      if (['kotlin', 'scala', 'fsharp'].includes(slug)) assert.equal(links.length, 1, `${slug}: core library only`)
      assert.match(await prompt.locator(`[data-port="${slug}"] [data-prompt-text]`).innerText(), new RegExp(`/en/${slug}/`))
    }
    await choose('ruby')
    const rubyLink = solution.locator('a[href$="/ruby/latest/mcp/"]')
    await solution.locator('summary').click()
    await rubyLink.click()
    await page.waitForURL('**/ruby/latest/mcp/')
    await page.goto(`${base}/`)
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'ruby')
    assert.equal(await solution.getAttribute('data-home-language'), 'ruby', 'Saved language restores both controls')
    await choose('py')
    const topic = prompt.locator('[data-select="topic"]')
    const original = await prompt.locator('[data-port="py"] [data-prompt-text]').innerText()
    const tasks = await topic.locator('option').evaluateAll((options) => options.map((option) => option.value))
    await topic.selectOption(tasks.find((value) => value !== 'setup'))
    const text = await prompt.locator('[data-port="py"] [data-prompt-text]').innerText()
    assert.notEqual(text, original, 'Task selection still recomposes the prompt')
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text) => { window.__homeCopiedPrompt = text },
    } }))
    await prompt.locator('[data-port="py"] [data-action="copy"]').click()
    assert.equal(await page.evaluate(() => window.__homeCopiedPrompt), text, 'Copy preserves all prompt bytes')
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => { document.documentElement.dataset.themeMode = theme }, theme)
      const colors = await page.evaluate(() => {
        const code = document.querySelector('.home-examples [data-home-language="py"] .expressive-code pre')
        const prompt = document.querySelector('.lm-agent-prompt__code')
        return [getComputedStyle(code).backgroundColor, getComputedStyle(prompt).backgroundColor]
      })
      assert.equal(colors[0], colors[1], `${theme}: code and prompt use the same background`)
      for (const width of [1920, 1440, 1135, 906, 390, 320]) {
        await page.setViewportSize({ width, height: 777 })
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme}/${width}: no page overflow`)
        assert(await language.isVisible() && await solution.isVisible(), `${theme}/${width}: both header pickers visible`)
      }
    }
    await choose('rs')
    const code = page.locator('.home-examples > [data-home-language="rs"] > .expressive-code pre code')
    const fontSizes = []
    for (const width of [906, 1135, 1920]) {
      await page.setViewportSize({ width, height: 777 })
      const layout = await page.evaluate(() => {
        const intro = document.querySelector('.home-intro').getBoundingClientRect()
        const examples = document.querySelector('.home-examples').getBoundingClientRect()
        const font = getComputedStyle(document.querySelector('.home-examples [data-home-language="rs"] pre code')).fontSize
        return { intro: intro.width, examples: examples.width, font: parseFloat(font) }
      })
      assert(layout.intro <= 320.5, `${width}: intro stops at 20rem`)
      assert(layout.examples > layout.intro, `${width}: code receives remaining width`)
      assert(layout.font >= 13 && layout.font <= 15, `${width}: readable font bounds`)
      fontSizes.push(layout.font)
    }
    assert(fontSizes[0] < fontSizes[2], 'Code grows with its container')
    await page.locator('.home-examples').evaluate((element) => { element.style.width = '360px' })
    assert.equal(await code.evaluate((element) => getComputedStyle(element).fontSize), '13px', 'Sizing follows the container at the same viewport')
    await code.locator('.ec-line').first().evaluate((line) => { line.textContent = 'unusuallyLongSymbol'.repeat(12) })
    assert(await code.locator('..').evaluate((pre) => pre.scrollWidth > pre.clientWidth), 'An indivisible symbol remains scrollable')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Long symbols do not widen the page')
    await page.reload()
    await language.locator('[data-port="rs"]').waitFor({ state: 'attached' })
    await page.setViewportSize({ width: 906, height: 777 })
    await language.locator('summary').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    assert.equal(await language.getAttribute('open'), null, 'Escape closes the picker')
    assert(await language.locator('summary').evaluate((element) => document.activeElement === element), 'Escape restores focus')
    assert.deepEqual(errors, [], 'Homepage has no runtime errors')
  } finally {
    await context.close()
  }
  const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 777 } })
  try {
    const page = await noScript.newPage()
    await page.goto(`${base}/`)
    const picker = page.locator('[data-home-launcher] [data-page-port-switcher]')
    await picker.locator('summary').click()
    assert.equal(await picker.locator('a:visible').count(), PORTS.length, 'No-JS still exposes real language links')
    assert(await page.locator('.lm-agent-prompt__panel[data-default] [data-prompt-text]').isVisible(), 'Default prompt remains readable without JavaScript')
    await picker.locator('a[data-port="ruby"]').click()
    await page.waitForURL('**/ruby/latest/')
  } finally {
    await noScript.close()
  }
  console.log('Homepage: 13 languages, owned solutions, saved selection, prompt tasks/copy, shared themes, container sizing, keyboard and no-JS PASS')
}
