#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

/** Exercise the installed widget scripts with accepted and refused clipboard writes. */
export async function checkClipboard(page, base) {
  const widgets = [
    // `ts/` (bare, no version) is now a noindex redirect to the default
    // version (site/src/pages/[port]/index.astro), so the per-port install
    // widget it used to carry is gone from the root build; the quickstart
    // widget on the site root (`''`) uses the same markup.
    ['', '.lm-pkg-install__copy', 'code'],
    ['ts/latest/mcp/', '.lm-mcp-install__copy', 'code'],
    ['prompts/', '.lm-agent-prompt__copy', '[data-prompt-text]'],
  ]
  for (const [path, selector, textSelector] of widgets) {
    const response = await page.goto(`${base}/${path}`, { waitUntil: 'domcontentloaded' })
    assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
    const widget = page.locator(`${selector.split('__')[0]}:visible`).first()
    const button = widget.locator(`${selector}:visible`).first()
    const status = widget.locator('[data-copy-status]')
    // Vite may reload after the first response while optimizing dependencies.
    await status.waitFor({ state: 'attached' })
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

  await page.goto(`${base}/examples/attach-and-send-keys/`, { waitUntil: 'load' })
  const actions = page.locator('[data-page-actions]')
  await actions.locator('summary').click()
  const edit = actions.getByRole('link', { name: 'Edit this page on GitHub' })
  assert.match(await edit.getAttribute('href'), /\/edit\/main\/site\/src\/content\/docs\/examples\/attach-and-send-keys\.md$/)
  assert.equal(await page.locator('article').getByRole('link', { name: 'Edit this page on GitHub' }).count(), 0)
  const markdownHref = await page.locator('link[rel="alternate"][type="text/markdown"]').getAttribute('href')
  const markdown = await (await page.request.get(new URL(markdownHref, page.url()).href)).text()
  for (const mode of ['accepted', 'refused']) {
    await page.evaluate((mode) => {
      window.__markdownCopied = undefined
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        write: async (items) => {
          if (mode === 'refused') throw new Error('Clipboard denied')
          window.__markdownCopied = await (await items[0].getType('text/plain')).text()
        },
      } })
    }, mode)
    await actions.getByRole('button', { name: 'Copy Markdown' }).click()
    await page.waitForFunction(() => /Markdown copied|Could not copy/.test(document.querySelector('[data-page-actions] [role="status"]').textContent))
    if (mode === 'accepted') assert.equal(await page.evaluate(() => window.__markdownCopied), markdown)
    else assert.equal(await actions.getByRole('link', { name: 'Open Markdown' }).getAttribute('href'), new URL(markdownHref, page.url()).href)
  }
  await page.evaluate(() => { window.print = () => { window.__pagePrinted = true } })
  await actions.getByRole('button', { name: 'Print', exact: true }).click()
  assert(await page.evaluate(() => window.__pagePrinted), 'Print invokes the browser print dialog')
  assert.equal(await actions.getAttribute('open'), null)
  await actions.locator('summary').click()
  await page.keyboard.press('Escape')
  assert.equal(await actions.getAttribute('open'), null)
  assert(await actions.locator('summary').evaluate((element) => document.activeElement === element), 'Escape returns focus to Page actions')
  console.log('Page actions: Markdown bytes, clipboard refusal, Edit, Print and Escape pass')

  const examples = JSON.parse(readFileSync(new URL('../test/fixtures/product-examples.json', import.meta.url), 'utf8')).examples
  const example = examples.find((entry) => entry.page === 'ports/go/workspace/internals/examples')
  assert(example, 'The Go workspace example has a native execution receipt')
  const response = await page.goto(`${base}/go/latest/workspace/internals/examples/`, { waitUntil: 'load' })
  assert(response?.ok(), `Go workspace: HTTP ${response?.status()}`)
  const digest = (text) => createHash('sha256').update(text).digest('hex')
  for (const file of example.files) {
    const figure = page.getByRole('figure', { name: file.name, exact: true })
    const displayed = await figure.locator('.ec-line .code').allTextContents()
    assert.equal(digest(displayed.map((line) => line === '\n' ? '' : line).join('\n') + '\n'),
      file.sha256, `${file.name}: rendering preserves executed bytes, including tabs`)
    await page.evaluate(() => {
      window.__programCopied = undefined
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (text) => { window.__programCopied = text },
      } })
    })
    await figure.getByRole('button', { name: 'Copy to clipboard', exact: true }).click()
    await page.waitForFunction(() => window.__programCopied !== undefined)
    assert.equal(digest(await page.evaluate(() => window.__programCopied) + '\n'), file.sha256,
      `${file.name}: the copy button preserves executed bytes`)
  }
  assert.equal(await page.locator('.expressive-code .code').first().evaluate((element) =>
    getComputedStyle(element).tabSize), '2', 'Literal tabs use two-column tab stops')
  console.log('Complete Go example: rendered and copied files match the native receipt, including tabs')
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
