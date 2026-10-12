import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, sep } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BUCKET_ROOT, SITE_BUILT, SITE_PREFIX } from './site-root'

/**
 * A code block on a rendered page holds the 80 columns WRITING.md promises.
 *
 * The width check holds hand-written fences to 80 columns in the source. This
 * measures the other half in a real browser: how many characters of the code
 * font fit in the block's content box at 1024 and 1280 px viewports, once
 * the reader's sidebar, margins and the block's own padding are taken out. A
 * block that fits fewer scrolls sideways on a line the check passed.
 *
 * The measurement can fail: the control runs the same assertion at a phone
 * width and expects it to throw.
 */
const PAGE = `/${SITE_PREFIX}concepts/queries/`
const COLUMNS = 80
const DESKTOP = 1024
// The width where the page's contents column appears and narrows the article.
const LAPTOP = 1280
const PHONE = 390

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

/** Serve the assembled tree read-only on a loopback port the OS picks. */
function serve(root: string): Promise<Server> {
  const server = createServer((request, response) => {
    let path = normalize(join(root, decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)))
    if (path !== root && !path.startsWith(root + sep)) path = ''
    if (path && existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html')
    if (!path || !existsSync(path)) {
      response.statusCode = 404
      response.end()
      return
    }
    response.setHeader('content-type', TYPES[extname(path)] ?? 'application/octet-stream')
    response.end(readFileSync(path))
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const describeIfBuilt = SITE_BUILT && existsSync(join(BUCKET_ROOT, PAGE, 'index.html')) ? describe : describe.skip

describeIfBuilt('code block width', () => {
  let server: Server
  let browser: Browser

  beforeAll(async () => {
    server = await serve(BUCKET_ROOT)
    // Playwright's bundled Chromium draws the code font narrower than Chrome, Firefox and
    // WebKit, so it would pass a block readers see scroll; measure in Chrome by default.
    browser = await chromium.launch({ channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL ?? 'chrome' })
  })

  afterAll(async () => {
    await browser?.close()
    await new Promise((resolve) => server?.close(resolve))
  })

  /**
   * The fewest code-font characters any block on the page fits per line: the
   * scrolling element's width less the line's own padding, over the width of
   * one character measured from an 80-character run in the block's font.
   */
  async function columnsAt(
    width: number,
    blockFonts = false,
  ): Promise<{ blocks: number; fewest: number; where: string }> {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    if (blockFonts) await page.route('**/*.woff2', (route) => route.abort())
    try {
      const response = await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}${PAGE}`)
      expect(response?.ok(), `${PAGE}: HTTP ${response?.status()}`).toBe(true)
      // fonts.ready can settle before a lazily used face starts loading, which
      // measures the fallback font, so load the code font itself and refuse
      // to measure without it.
      const font = await page.evaluate(async () => {
        const line = document.querySelector<HTMLElement>('.expressive-code pre .ec-line .code')
        if (!line) return ''
        const style = getComputedStyle(line)
        const spec = `${style.fontSize} ${style.fontFamily.split(',')[0]}`
        const loaded = await document.fonts.load(spec).then(
          (faces) => faces.length > 0,
          () => false,
        )
        return loaded && document.fonts.check(spec) ? '' : spec
      })
      expect(font, `the code font did not load: ${font}`).toBe('')
      return await page.evaluate((columns) => {
        const fits: { columns: number; where: string }[] = []
        for (const pre of document.querySelectorAll('.expressive-code pre')) {
          const line = pre.querySelector<HTMLElement>('.ec-line .code')
          if (!line) continue
          const style = getComputedStyle(line)
          const run = document.createElement('span')
          run.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'
          run.textContent = '0'.repeat(columns)
          line.append(run)
          const character = run.getBoundingClientRect().width / columns
          run.remove()
          const content = pre.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          if (!(character > 0 && Number.isFinite(content))) continue
          // Name the block so a failure says which container narrows it.
          let heading = ''
          for (const h of document.querySelectorAll('h2, h3')) {
            if (h.compareDocumentPosition(pre) & Node.DOCUMENT_POSITION_FOLLOWING) heading = h.textContent ?? ''
          }
          const inside = ['[role=tabpanel]', 'li', 'aside', 'details', 'table']
            .filter((selector) => pre.closest(selector))
            .join(', ')
          const where =
            `under "${heading.trim()}"${inside ? ` inside ${inside}` : ''}, ` +
            `${content.toFixed(0)} px of ${character.toFixed(2)} px characters in ${style.fontFamily}`
          fits.push({ columns: content / character, where })
        }
        fits.sort((a, b) => a.columns - b.columns)
        return { blocks: fits.length, fewest: fits[0]?.columns ?? Number.NaN, where: fits[0]?.where ?? '' }
      }, COLUMNS)
    } finally {
      await page.close()
    }
  }

  const holdsEighty = async (width: number) => {
    const { blocks, fewest, where } = await columnsAt(width)
    expect(blocks, 'no code block was measured').toBeGreaterThan(0)
    expect(fewest, `a block fits ${fewest.toFixed(1)} columns at ${width}px (${where})`).toBeGreaterThanOrEqual(COLUMNS)
  }

  it('fits 80 columns in every code block at 1024 px', async () => {
    await holdsEighty(DESKTOP)
  }, 30_000)

  it('fits 80 columns in every code block at 1280 px', async () => {
    await holdsEighty(LAPTOP)
  }, 30_000)

  it('control: without the code font it refuses to measure', async () => {
    await expect(columnsAt(DESKTOP, true)).rejects.toThrow(/code font did not load/)
  }, 30_000)

  it('control: the same assertion fails at 390 px', async () => {
    await expect(holdsEighty(PHONE)).rejects.toThrow(/columns at 390px/)
  }, 30_000)
})
