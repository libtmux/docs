import assert from 'node:assert/strict'
import { PORTS } from '../src/lib/ports.ts'

/** Real pointer events, with the clock advanced instead of sleeping per option. */
export async function checkHomeHover(browser, base) {
  const context = await browser.newContext({ viewport: { width: 914, height: 777 }, colorScheme: 'light', reducedMotion: 'no-preference' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const read = () => page.evaluate(() => ({
    port: document.documentElement.dataset.homeSelectedPort ?? null,
    savedPort: localStorage.getItem('libtmux-docs.package-install.port'),
    promptPort: document.querySelector('.lm-agent-prompt')?.dataset.activePort,
    scheme: document.documentElement.dataset.colorScheme,
    mode: document.documentElement.dataset.themeMode,
    savedScheme: localStorage.getItem('color-scheme'),
    checked: document.querySelector('[data-scheme-switch] input:checked')?.value,
  }))
  const language = page.locator('[data-home-launcher] [data-page-port-switcher]')
  const scheme = (value) => page.locator(`[data-scheme-switch] [data-scheme="${value}"]`)
  const leave = () => page.mouse.move(5, 400)
  try {
    await page.goto(`${base}/?port=py&prompt=session-switcher&from=hover#example`)
    await page.waitForFunction(() => document.querySelector('.lm-agent-prompt')?.dataset.activePort === 'py')
    const now = new Date()
    await page.clock.install({ time: now })
    await page.clock.pauseAt(new Date(now.getTime() + 1000))
    const url = page.url()
    await language.locator('summary .doc-picker-caret').click()
    for (const { slug } of PORTS) {
      await language.locator(`a[data-port="${slug}"]`).hover()
      await page.clock.fastForward(1100)
      assert.equal((await read()).port, 'py', `${slug}: a brief hover does not preview`)
      await page.clock.fastForward(100)
      const state = await read()
      assert.equal(state.port, slug)
      assert.equal(state.promptPort, slug, 'The current prompt follows the preview')
      assert.equal(state.savedPort, 'py', 'Hover does not save a language')
      assert.equal(page.url(), url, 'Hover does not change any URL state')
      assert.equal(await language.locator('[aria-current]').getAttribute('data-port'), 'py', 'Only the committed menu option is checked')
      assert(await page.locator(`.home-examples > [data-home-language="${slug}"]`).isVisible())
      assert.equal(await page.locator('.lm-agent-prompt [data-select="topic"]').inputValue(), 'session-switcher')
      assert.match(await page.locator(`.lm-agent-prompt__panel[data-port="${slug}"] [data-prompt-text]`).innerText(), /Then build a tmux session switcher/)
      await leave()
      assert.equal((await read()).port, 'py', 'Leaving restores the committed language')
    }
    await language.locator('a[data-port="ruby"]').hover()
    await page.clock.fastForward(1200)
    assert.equal((await read()).port, 'ruby')
    await page.keyboard.press('Escape')
    assert.equal((await read()).port, 'py', 'Escape dismisses the preview')
    await language.locator('summary .doc-picker-caret').click()
    await language.locator('a[data-port="swift"]').click()
    await page.clock.fastForward(2000)
    assert.equal((await read()).savedPort, 'swift', 'Click commits and cancels the pending hover')
    assert.equal(new URL(page.url()).searchParams.get('port'), 'swift')
    await page.locator('[data-home-launcher] .picker-clear[data-home-reset]').click()
    await language.locator('summary .doc-picker-caret').click()
    await language.locator('a[data-port="lua"]').hover()
    await page.clock.fastForward(1200)
    assert.equal((await read()).port, 'lua')
    await leave()
    assert.equal((await read()).port, null, 'An unset selection restores the default trigger')
    assert.equal((await read()).savedPort, null)
    assert.equal(new URL(page.url()).searchParams.has('port'), false)
    await page.keyboard.press('Escape')

    for (const value of ['dark', 'light', 'system']) {
      await scheme(value === 'dark' ? 'light' : 'dark').click()
      const before = await read()
      await scheme(value).hover()
      await page.clock.fastForward(1100)
      assert.equal((await read()).mode, before.mode)
      await page.clock.fastForward(100)
      const during = await read()
      assert.equal(during.mode, value === 'system' ? 'light' : value)
      assert.equal(during.savedScheme, before.savedScheme)
      assert.equal(during.scheme, before.scheme)
      assert.equal(during.checked, before.checked, 'A preview does not select a radio')
      assert.equal(await page.locator('body').evaluate((el) => getComputedStyle(el).transitionDuration), '0.18s, 0.18s, 0.18s')
      await leave()
      assert.equal((await read()).mode, before.mode)
    }
    await scheme('system').click()
    await scheme('dark').hover()
    await page.clock.fastForward(1200)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.emulateMedia({ colorScheme: 'light' })
    assert.equal((await read()).mode, 'dark', 'OS changes do not override an explicit preview')
    await leave()
    assert.equal((await read()).mode, 'light')
    await scheme('dark').hover()
    await page.clock.fastForward(1200)
    await scheme('dark').click()
    await leave()
    assert.equal((await read()).savedScheme, 'dark', 'Click keeps the previewed scheme')

    await scheme('light').hover()
    await page.clock.fastForward(1200)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await leave()
    await page.clock.fastForward(1000)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    assert.equal(await page.locator('html').getAttribute('data-home-scheme-fade'), null, 'Changing motion preference during a fade cleans up its styling')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await scheme('light').hover()
    await page.clock.fastForward(1200)
    assert.equal((await read()).mode, 'light')
    assert.equal(await page.locator('body').evaluate((el) => getComputedStyle(el).transitionDuration), '0s')
    await leave()
    await language.locator('summary .doc-picker-caret').click()
    await language.locator('a[data-port="ruby"]').hover()
    await page.clock.fastForward(1200)
    assert.equal(await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.matches('[data-home-language]')).length), 0)
    await page.keyboard.press('Escape')
    await language.locator('a[data-port="ruby"]').dispatchEvent('pointerenter', { pointerType: 'touch' })
    await page.clock.fastForward(1200)
    assert.equal((await read()).port, null, 'A touch event cannot start a preview')

    // A real client-side navigation unbinds homepage previews.
    await page.evaluate(() => {
      window.__homeNavigationComplete = false
      document.addEventListener('astro:page-load', () => { window.__homeNavigationComplete = true }, { once: true })
    })
    await page.locator('.site-header__mark').click()
    await page.waitForFunction(() => window.__homeNavigationComplete && document.querySelector('[data-home-launcher]'))
    await language.locator('summary .doc-picker-caret').click()
    await language.locator('.tmux-area a').click()
    await page.waitForURL(`${base}/tmux/`)
    await page.waitForFunction(() => !document.querySelector('[data-home-launcher]'))
    await scheme('light').hover()
    await page.clock.fastForward(1400)
    assert.equal((await read()).mode, 'dark', 'Documentation pages do not have hover previews')
    assert.equal(await page.locator('html').getAttribute('data-home-scheme-preview'), null)
    assert.deepEqual(errors, [])
  } finally {
    await context.close()
  }
  console.log('Homepage hover: all 13 languages, task sync, dwell, restore, commit, URL/storage, Auto/Light/Dark, reduced motion and documentation exclusion PASS')
}
