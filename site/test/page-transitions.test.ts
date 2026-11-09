import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { SITE_BUILT, SITE_ROOT } from './site-root'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('shell sources', () => {
  it('hides only the API tree while the readiness gate runs', () => {
    const style = /<style is:inline>([\s\S]*?)<\/style>/.exec(read('../src/components/ShellHead.astro'))![1]!
    const hiding = [...style.matchAll(/([^{}]+)\{[^{}]*visibility:\s*hidden[^{}]*\}/g)]
      .flatMap(([, selectors]) => selectors!.split(',').map((selector) => selector.trim()))
    expect(hiding.length).toBeGreaterThan(0)
    for (const selector of hiding) expect(selector).toMatch(/^html\.(?:fonts|link-hints)-pending \.api-nav \[role="tree"\]$/)
  })

  it('enables the client router in the head of every shell page', () => {
    const layout = read('../src/layouts/BaseLayout.astro')
    expect(layout).toMatch(/import \{ ClientRouter \} from 'astro:transitions'/)
    expect(/<head>([\s\S]*?)<\/head>/.exec(layout)![1]).toContain('<ClientRouter fallback="swap" />')
  })

  it('guards navigation between independently built trees', () => {
    expect(read('../src/components/docs/DocumentationScript.astro')).toMatch(/guardTreeNavigation\(\)/)
  })

  it('guards navigation within a page before the router listens for history', () => {
    const head = /<head>([\s\S]*?)<\/head>/.exec(read('../src/layouts/BaseLayout.astro'))![1]!
    const guard = head.indexOf('guardPageNavigation()')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(head.indexOf('<ClientRouter'))
  })
})

/** The first and last bytes of a file; the head and the end of a page are all these checks read. */
function ends(path: string, size = 16_384) {
  const fd = openSync(path, 'r')
  try {
    const length = statSync(path).size
    const head = Buffer.alloc(Math.min(size, length))
    readSync(fd, head, 0, head.length, 0)
    const tail = Buffer.alloc(Math.min(size, length))
    readSync(fd, tail, 0, tail.length, length - tail.length)
    return { head: head.toString('utf8'), tail: tail.toString('utf8') }
  } finally { closeSync(fd) }
}

/**
 * One pass over every page the Astro shell built, native Sphinx and generated
 * pages excluded, keeping only what the checks report: how many pages there
 * are, the first few that fail each check, and every fortieth page's path as a
 * sample. A full assembly has tens of thousands of pages; holding each page's
 * head and tail took a test worker past its heap.
 */
function scanShellPages() {
  const scan = { count: 0, noRouter: [] as string[], late: [] as string[], bodyHidden: [] as string[], treeHidden: 0, sample: [] as string[] }
  const note = (list: string[], path: string) => { if (list.length < 5) list.push(path) }
  for (const file of readdirSync(SITE_ROOT, { recursive: true }) as string[]) {
    if (!file.endsWith('.html')) continue
    const path = join(SITE_ROOT, file)
    const { head, tail } = ends(path)
    if (!/<html\b[^>]*\bdata-shell-base=/.test(head) || /<html\b[^>]*\bdata-native-shell-export/.test(head)) continue
    if (scan.count % 40 === 0) scan.sample.push(path)
    scan.count++
    if (!head.includes('<meta name="astro-view-transitions-enabled" content="true"')
      || !/<meta name="astro-view-transitions-fallback" content="swap"/.test(head)) note(scan.noRouter, path)
    if (!/<\/body>\s*<\/html>\s*$/.test(tail)) note(scan.late, path)
    if (/html\.fonts-pending body|html\.link-hints-pending body/.test(head)) note(scan.bodyHidden, path)
    if (head.includes('html.fonts-pending .api-nav [role="tree"]')) scan.treeHidden++
  }
  return scan
}

let scanned: ReturnType<typeof scanShellPages> | undefined
/** The scan, made once, by the first check that needs it. */
const shellScan = () => (scanned ??= scanShellPages())
/** A full assembly takes longer to scan than one test may run, so each suite scans before its tests. */
const SCAN_TIMEOUT_MS = 180_000

describe.skipIf(!SITE_BUILT)('built shell pages', () => {
  beforeAll(() => { shellScan() }, SCAN_TIMEOUT_MS)

  it('are found', () => { expect(shellScan().count).toBeGreaterThan(0) })

  it('enable the client router so a link swaps the page in place', () => {
    expect(shellScan().noRouter).toEqual([])
  })

  it('end at </body> and </html>, so the zone-injected beacon follows every required module', () => {
    expect(shellScan().late).toEqual([])
  })

  it('hide only the API tree while the gate runs', () => {
    expect(shellScan().bodyHidden).toEqual([])
    expect(shellScan().treeHidden).toBe(shellScan().count)
  })
})

describe.skipIf(!SITE_BUILT)('built pages with code frames', () => {
  beforeAll(() => { shellScan() }, SCAN_TIMEOUT_MS)

  const stylesheet = /<link rel="stylesheet" href="[^"]*\/ec\.[A-Za-z0-9_-]+\.css"\s*\/?>/g

  // Reading every page body is slow on a full assembly, so the scan's sample stands for them, read one page at a time.
  it('load the code stylesheet from the head, where the router preloads it before a swap', () => {
    let framed = 0
    for (const path of shellScan().sample) {
      const html = readFileSync(path, 'utf8')
      if (!html.includes('class="expressive-code"')) continue
      framed++
      const body = html.indexOf('<body')
      expect(html.slice(0, body).match(stylesheet) ?? [], `${path}: one link in the head`).toHaveLength(1)
      expect(html.slice(body).match(/<link\b[^>]*rel="stylesheet"/g) ?? [], `${path}: no stylesheet link in the body`).toEqual([])
    }
    expect(framed, 'the sample holds pages with code frames').toBeGreaterThan(0)
  })
})
