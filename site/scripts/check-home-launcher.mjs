import assert from 'node:assert/strict'
import { PORTS } from '../src/lib/ports.ts'
import HOME_PROOF from '../test/fixtures/home-examples.json' with { type: 'json' }
import { createHash } from 'node:crypto'

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
  const reset = page.locator('[data-home-launcher] > [data-home-reset]')
  const logo = page.locator('.site-header__mark img:visible')
  const choose = async (port) => {
    await language.locator('summary').click()
    await language.locator(`a[data-port="${port}"]`).click()
    await page.waitForFunction((port) => document.querySelector('.lm-agent-prompt')?.dataset.activePort === port, port)
    assert(await page.locator(`.home-examples [data-home-language="${port}"]`).isVisible())
    assert.equal(await solution.getAttribute('data-home-language'), port)
    assert.equal(new URL(page.url()).searchParams.get('port'), port, 'The address carries the chosen language')
    assert(await reset.isVisible(), 'A chosen language can be reset')
    assert.equal(await logo.getAttribute('src'), await language.locator(`a[data-port="${port}"] img`).getAttribute('src'), 'The header logo follows the selected language')
    assert(await logo.evaluate((img) => img.complete && img.naturalWidth > 0), 'The selected logo is already loaded')
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
    assert.equal(await reset.isVisible(), false, 'The default example is not a saved choice')
    const defaultLogo = await logo.getAttribute('src')
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
    await page.goto(`${base}/?port=fsharp&prompt=session-switcher&from=shared#example`)
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'fsharp')
    assert.equal(await language.locator('.page-port-name').textContent(), 'F#', 'The URL overrides the saved language')
    assert.equal(await prompt.locator('[data-select="topic"]').inputValue(), 'session-switcher')
    await choose('go')
    assert.equal(new URL(page.url()).searchParams.get('prompt'), 'session-switcher', 'Language changes preserve the task')
    assert.equal(new URL(page.url()).searchParams.get('from'), 'shared', 'Language changes preserve unrelated parameters')
    assert.equal(new URL(page.url()).hash, '#example')
    await prompt.locator('[data-action="reroll"]').click()
    const rerolled = await prompt.locator('[data-select="topic"]').inputValue()
    assert.notEqual(rerolled, 'session-switcher')
    assert.equal(new URL(page.url()).searchParams.get('port'), 'go', 'Task changes preserve the language')
    await page.reload()
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'go')
    assert.equal(await prompt.locator('[data-select="topic"]').inputValue(), rerolled, 'Reload restores the language and task')
    await language.locator('summary').click()
    const resetGap = await language.locator('.doc-picker-title-actions').evaluate((actions) => {
      const button = actions.querySelector('button').getBoundingClientRect()
      const count = actions.querySelector('.doc-picker-count').getBoundingClientRect()
      return count.left - button.right
    })
    assert(resetGap >= 11.5, 'Reset is separated from the language count')
    await language.locator('[data-home-reset]').click()
    assert.equal(new URL(page.url()).searchParams.has('port'), false, 'The picker reset removes the port parameter')
    assert.equal(new URL(page.url()).searchParams.get('prompt'), rerolled, 'Reset preserves the task')
    assert.equal(new URL(page.url()).searchParams.get('from'), 'shared')
    assert.equal(new URL(page.url()).hash, '#example')
    assert.equal(await page.evaluate(() => localStorage.getItem('libtmux-docs.package-install.port')), null)
    assert.equal(await reset.isVisible(), false)
    assert.equal(await logo.getAttribute('src'), defaultLogo, 'Reset restores the default header logo')
    assert.equal(await language.locator('[aria-current]').count(), 0, 'Reset leaves no selected language')
    assert(await language.locator('summary').evaluate((element) => document.activeElement === element), 'Reset keeps focus on the language picker')
    await page.reload()
    await page.waitForFunction(() => document.querySelector('[data-home-launcher] .page-port-name')?.textContent === 'Choose a language')
    assert.equal(await reset.isVisible(), false, 'The cleared choice stays cleared on reload')
    assert.equal(await prompt.getAttribute('data-active-port'), PORTS[0].slug)
    await choose('fsharp')
    await reset.click()
    assert.equal(new URL(page.url()).searchParams.has('port'), false, 'The header reset also removes the port parameter')
    await page.goto(`${base}/?port=constructor&prompt=setup`)
    await page.waitForFunction(() => document.querySelector('[data-home-launcher] .page-port-name')?.textContent === 'Choose a language')
    assert.equal(new URL(page.url()).searchParams.has('port'), false, 'Unknown languages do not become a selection')
    await page.goto(`${base}/?port=fsharp&prompt=setup#first`)
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'fsharp')
    await page.evaluate(() => { location.hash = 'second' })
    await choose('go')
    await prompt.locator('[data-select="topic"]').selectOption('session-switcher')
    await page.goBack()
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'fsharp'
      && document.querySelector('.lm-agent-prompt [data-select="topic"]')?.value === 'setup')
    assert.equal(new URL(page.url()).hash, '#first', 'Back restores the matching language and task')
    await page.goForward()
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'go'
      && document.querySelector('.lm-agent-prompt [data-select="topic"]')?.value === 'session-switcher')
    assert.equal(new URL(page.url()).hash, '#second', 'Forward restores the matching language and task')
    await choose('py')
    const topic = prompt.locator('[data-select="topic"]')
    await topic.selectOption('setup')
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
    await page.setViewportSize({ width: 1093, height: 777 })
    for (const proof of HOME_PROOF.examples) {
      await choose(proof.port)
      const panel = page.locator(`.home-examples > [data-home-language="${proof.port}"]`)
      const rendered = await panel.evaluate((element) => ({
        excerpt: element.querySelector(':scope > .expressive-code [data-code]').getAttribute('data-code').replaceAll('\x7f', '\n'),
        files: [...element.querySelectorAll('[data-home-file]')].map((file) => ({
          name: file.dataset.homeFile,
          code: file.querySelector('[data-code]').getAttribute('data-code').replaceAll('\x7f', '\n'),
        })),
        commands: [...element.querySelectorAll('[data-home-command] [data-code]')].map((button) => button.getAttribute('data-code').replaceAll('\x7f', '\n')),
      }))
      const hash = (text) => createHash('sha256').update(text).digest('hex')
      assert.equal(hash(rendered.excerpt), proof.excerptSha256, `${proof.port}: exact excerpt copy payload`)
      assert.deepEqual(rendered.files.map((file) => ({ name: file.name, sha256: hash(file.code) })), proof.files.map((file) => ({ name: file.name, sha256: file.clipboardSha256 })), `${proof.port}: complete native-verified file copy payloads`)
      assert.deepEqual(rendered.commands, proof.shellRecipe, `${proof.port}: exact setup and run copy payloads`)

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
  const blockedStorage = await browser.newContext()
  try {
    // Astro's development toolbar reads storage unguarded; it is absent from published pages.
    await blockedStorage.route('**/astro/runtime/client/dev-toolbar/entrypoint.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export {}' }))
    await blockedStorage.addInitScript(() => Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage blocked', 'SecurityError') },
    }))
    const page = await blockedStorage.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/?port=fsharp&prompt=session-switcher`)
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'fsharp')
    const launcher = page.locator('[data-home-launcher]')
    assert.equal(await launcher.locator('.page-port-name').textContent(), 'F#', 'Shared language works without storage')
    assert.equal(await page.locator('.lm-agent-prompt [data-select="topic"]').inputValue(), 'session-switcher')
    await launcher.locator(':scope > [data-home-reset]').click()
    assert.equal(new URL(page.url()).searchParams.has('port'), false)
    await page.reload()
    await page.waitForFunction(() => document.querySelector('[data-home-launcher] .page-port-name')?.textContent === 'Choose a language')
    assert.deepEqual(errors, [], 'Shared links and reset work without storage')
  } finally {
    await blockedStorage.close()
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
  console.log('Homepage: 13 languages, owned solutions, shared URLs, reset, blocked storage, prompt tasks/copy, shared themes, container sizing, keyboard and no-JS PASS')
}
