#!/usr/bin/env node
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

/** Exercise the installed widget scripts with accepted and refused clipboard writes. */
export async function checkClipboard(page, base) {
  const widgets = [
    ['ts/', '.lm-pkg-install__copy', 'code'],
    ['ts/latest/mcp/', '.lm-mcp-install__copy', 'code'],
    ['prompts/', '.lm-agent-prompt__copy', '[data-prompt-text]'],
  ]
  for (const [path, selector, textSelector] of widgets) {
    const response = await page.goto(`${base}/${path}`, { waitUntil: 'networkidle' })
    assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
    const widget = page.locator(`${selector.split('__')[0]}:visible`).first()
    const button = widget.locator(`${selector}:visible`).first()
    const status = widget.locator('[data-copy-status]')
    assert.equal(await status.count(), 1, `${path}: persistent copy status`)
    assert.equal(await status.getAttribute('role'), 'status', `${path}: copy result is announced`)
    assert.equal(await status.getAttribute('aria-live'), 'polite', `${path}: polite copy announcement`)
    assert.equal(await status.getAttribute('aria-atomic'), 'true', `${path}: complete copy announcement`)
    const buttonLabel = await button.getAttribute('aria-label')
    const text = await button.evaluate((element, selector) => {
      const container = element.parentElement
      const text = container.querySelector(selector).textContent
      return container.dataset.language === 'console' ? text.replace(/^\$ /gm, '') : text
    }, textSelector)
    const textareas = await page.locator('textarea').count()
    for (const mode of ['api', 'rejected', 'fallback', 'false', 'throw']) {
      await page.evaluate((mode) => {
        window.__clipboardProbe = { api: [], fallback: [] }
        Object.defineProperty(navigator, 'clipboard', { configurable: true,
          value: ['api', 'rejected'].includes(mode) ? {
            writeText: async (text) => {
              window.__clipboardProbe.api.push(text)
              if (mode === 'rejected') throw new Error('Clipboard denied')
            },
          } : undefined,
        })
        Object.defineProperty(document, 'execCommand', { configurable: true, value: () => {
          window.__clipboardProbe.fallback.push(document.activeElement.value)
          if (mode === 'throw') throw new Error('Clipboard denied')
          return mode !== 'false'
        } })
      }, mode)
      await button.evaluate((element) => { element.textContent = 'Copy' })
      await button.click()
      const copied = !['false', 'throw'].includes(mode)
      await page.waitForFunction(([selector, label]) => [...document.querySelectorAll(selector)]
        .some((element) => element.textContent === label), [selector, copied ? 'Copied' : 'Copy failed'])
      assert.equal(await button.textContent(), copied ? 'Copied' : 'Copy failed', `${path}: ${mode}`)
      const announcement = copied ? 'Copied to clipboard.' : 'Copy failed. Select and copy the text manually.'
      assert.equal(await status.textContent(), announcement, `${path}: ${mode} accessible result`)
      assert.match(await status.ariaSnapshot(), /status/, `${path}: ${mode} status remains accessible`)
      assert.equal(await button.getAttribute('aria-label'), buttonLabel, `${path}: ${mode} keeps the copy action label`)
      assert(await button.evaluate((element) => document.activeElement === element), `${path}: ${mode} preserves focus`)
      assert.equal(await page.locator('textarea').count(), textareas, `${path}: ${mode} removes temporary textareas`)
      const calls = await page.evaluate(() => window.__clipboardProbe)
      assert.deepEqual(calls.api, ['api', 'rejected'].includes(mode) ? [text] : [], `${path}: ${mode} API text`)
      assert.deepEqual(calls.fallback, mode === 'api' ? [] : [text], `${path}: ${mode} fallback text`)
    }
  }
  console.log('Clipboard: 15 widget cases pass, including refusal, literal text and focus restoration')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(1000)
    await checkClipboard(page, (process.argv[2] ?? 'http://localhost:8080/en').replace(/\/$/, ''))
  } finally {
    await browser.close()
  }
}
