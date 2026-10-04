import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { chromium, type Browser, type Page } from 'playwright'
import { createRenderer } from 'astro-expressive-code'
import { toHtml } from 'astro-expressive-code/hast'
import ecConfig from '../ec.config.mjs'

const command = 'ruby -e \'\n# quoted program\nputs "ready"\n\''
let browser: Browser
let server: Server
let origin: string
let releaseScript: () => void
let scriptReleased: Promise<void>
let body: string
let script: string

async function copiedText(page: Page, expected: string) {
  let actual = ''
  const deadline = performance.now() + 3000
  do {
    actual = await page.evaluate(() => navigator.clipboard.readText())
    if (actual === expected) return actual
    await new Promise((resolve) => setTimeout(resolve, 20))
  } while (performance.now() < deadline)
  return actual
}

beforeAll(async () => {
  const renderer = await createRenderer(ecConfig)
  const rendered = await renderer.ec.render({ code: `$ ${command}\nready`, language: 'console' })
  body = toHtml(rendered.renderedGroupAst)
  script = renderer.jsModules.join('\n')
  const styles = [renderer.baseStyles, renderer.themeStyles, ...rendered.styles].join('\n')
  server = createServer(async (request, response) => {
    if (request.url === '/copy.js') {
      await scriptReleased
      response.setHeader('Content-Type', 'text/javascript')
      response.end(script)
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end(
      `<!doctype html><html data-theme-mode="light"><head><style>${styles}</style></head><body>${body}<script type="module" src="/copy.js"></script></body></html>`,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected local test server')
  origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => {
  releaseScript?.()
  await browser?.close()
  await new Promise<void>((resolve) => server?.close(() => resolve()))
})

describe('code copy readiness', () => {
  it('enables Copy after its delayed script and copies later inserted blocks', async () => {
    scriptReleased = new Promise((resolve) => {
      releaseScript = resolve
    })
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    try {
      const page = await context.newPage()
      await page.goto(origin, { waitUntil: 'commit' })
      const button = page.getByRole('button', { name: 'Copy to clipboard', exact: true })
      await button.waitFor({ state: 'visible' })
      expect(await button.isDisabled()).toBe(true)
      releaseScript()
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.copy button')?.disabled)
      await page.evaluate(() => navigator.clipboard.writeText('unchanged'))
      await button.click()
      expect(await copiedText(page, command)).toBe(command)

      await page.evaluate((markup) => {
        document.querySelector('.expressive-code')?.remove()
        document.body.insertAdjacentHTML('afterbegin', markup)
        document.dispatchEvent(new Event('astro:page-load'))
      }, body)
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.copy button')?.disabled)
      await page.evaluate(() => navigator.clipboard.writeText('unchanged'))
      await button.click()
      expect(await copiedText(page, command)).toBe(command)
    } finally {
      releaseScript()
      await context.close()
    }
  })

  it('keeps unavailable Copy hidden without JavaScript while showing the code', async () => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    try {
      const page = await context.newPage()
      await page.goto(origin, { waitUntil: 'commit' })
      const button = page.locator('.copy button')
      await button.waitFor({ state: 'attached' })
      expect(await button.isDisabled()).toBe(true)
      expect(await button.isVisible()).toBe(false)
      expect(await page.locator('pre').innerText()).toContain('puts "ready"')
    } finally {
      await context.close()
    }
  })
})
