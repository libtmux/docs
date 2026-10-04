import assert from 'node:assert/strict'
import { PORTS } from '../src/lib/ports.ts'
import { chooseHomeTask } from './check-home-task-reset.mjs'

export async function checkHomeExampleOptions(browser, base) {
  for (const blocked of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 944, height: 777 }, reducedMotion: 'reduce' })
    try {
      if (blocked) {
        await context.route('**/astro/runtime/client/dev-toolbar/entrypoint.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export {}' }))
        await context.addInitScript(() => Object.defineProperty(window, 'localStorage', {
          get() { throw new DOMException('Storage blocked', 'SecurityError') },
        }))
      }
      const page = await context.newPage()
      const runtimeErrors = []
      page.on('pageerror', (error) => runtimeErrors.push(error.message))
      const active = page.locator('.home-examples > [data-home-language]:not([hidden])')
      const errors = active.locator('[data-example-errors]')
      const cleanup = active.locator('[data-example-cleanup]')
      const check = async (handling, cleaning) => {
        const actual = await page.locator('[data-home-example]').evaluateAll((examples) => examples.map((example) => ({
          handling: example.querySelector('[data-example-errors]').checked,
          cleaning: example.querySelector('[data-example-cleanup]').checked,
        })))
        assert.deepEqual(actual, PORTS.map(() => ({ handling, cleaning })), 'Every language shares both choices')
        const view = handling ? (cleaning ? 'full' : 'errors') : (cleaning ? 'cleanup' : 'concise')
        assert.equal(await active.locator('[data-home-view]:visible').getAttribute('data-home-view'), view)
      }
      await page.goto(`${base}/?port=rs&prompt=eval-sweep&from=a&from=b#program`)
      await page.waitForSelector('[data-task-enhanced]:not([hidden])')
      await check(false, false)
      await errors.check()
      await check(true, false)
      assert.equal(new URL(page.url()).searchParams.get('errors'), '1')
      await cleanup.check()
      await check(true, true)
      for (const { slug } of PORTS) {
        const picker = page.locator('[data-home-launcher] [data-page-port-switcher]')
        await picker.locator('summary .doc-picker-caret').click()
        await picker.locator(`[data-port="${slug}"]`).click()
        await check(true, true)
      }
      await chooseHomeTask(page, 'agent-orchestrator')
      const selectedUrl = new URL(page.url())
      assert.equal(selectedUrl.searchParams.get('errors'), '1')
      assert.equal(selectedUrl.searchParams.get('cleanup'), '1')
      assert.deepEqual(selectedUrl.searchParams.getAll('from'), ['a', 'b'])
      assert.equal(selectedUrl.hash, '#program')
      await page.reload()
      await page.waitForSelector('[data-task-enhanced]:not([hidden])')
      await check(true, true)
      if (!blocked) {
        assert.equal(await page.evaluate(() => localStorage.getItem('libtmux-docs.home-example.errors')), '1')
        assert.equal(await page.evaluate(() => localStorage.getItem('libtmux-docs.home-example.cleanup')), '1')
        await page.goto(`${base}/?port=py`)
        await page.waitForSelector('[data-task-enhanced]:not([hidden])')
        await check(true, true)
        assert.equal(new URL(page.url()).searchParams.get('errors'), '1', 'Stored choices are reflected in shareable URLs')
      }
      await page.goto(`${base}/?port=rs&errors=0&cleanup=0`)
      await page.waitForSelector('[data-task-enhanced]:not([hidden])')
      await check(false, false)
      assert.equal(new URL(page.url()).searchParams.get('errors'), '0', 'An explicit off URL overrides saved choices')
      await errors.check()
      await cleanup.check()
      await errors.uncheck()
      await cleanup.uncheck()
      assert.equal(new URL(page.url()).searchParams.has('errors'), false)
      assert.equal(new URL(page.url()).searchParams.has('cleanup'), false)
      if (!blocked) assert.deepEqual(await page.evaluate(() => [
        localStorage.getItem('libtmux-docs.home-example.errors'),
        localStorage.getItem('libtmux-docs.home-example.cleanup'),
      ]), [null, null])
      await page.reload()
      await page.waitForSelector('[data-task-enhanced]:not([hidden])')
      await check(false, false)

      const transition = async (navigate) => {
        await page.evaluate(() => {
          window.__homeOptionsPageLoaded = false
          document.addEventListener('astro:page-load', () => {
            window.__homeOptionsPageLoaded = true
          }, { once: true })
        })
        await navigate()
        await page.waitForFunction(() => window.__homeOptionsPageLoaded)
      }
      await page.goto(`${base}/?port=rs&errors=1&cleanup=0#first`)
      await page.waitForSelector('[data-task-enhanced]:not([hidden])')
      await page.evaluate(() => { location.hash = 'second' })
      await errors.uncheck()
      await cleanup.check()
      await check(false, true)
      await page.goBack()
      await page.waitForFunction(() => location.hash === '#first')
      await check(true, false)
      // Query restoration is synchronous; the router's page swap is not.
      await transition(() => page.goForward())
      await page.waitForFunction(() => location.hash === '#second')
      await check(false, true)

      const documentation = `${base}/tmux/?from=doc#start`
      await page.goto(documentation)
      // The incoming default panel is visible before scripts restore the port.
      await transition(() => page.locator('.site-header__mark').click())
      await page.waitForSelector('[data-task-enhanced]:not([hidden])')
      await errors.check()
      await cleanup.check()
      await transition(() => page.goBack())
      assert.equal(await page.locator('[data-home-example]').count(), 0)
      assert.equal(page.url(), documentation, 'Back from home never adds homepage preferences to a documentation URL')
      assert.equal(await page.evaluate(() => history.state?.libtmuxHomeExamples), undefined)
      await transition(() => page.goForward())
      await page.waitForSelector('[data-task-enhanced]:not([hidden])')
      await check(true, true)
      assert.deepEqual(runtimeErrors, [])
    } finally {
      await context.close()
    }
  }
  console.log('Example options: shared across 13 ports, independent defaults, URL/storage/reload/history, explicit zero, uncheck removal, task and URL preservation, blocked storage PASS')
}
