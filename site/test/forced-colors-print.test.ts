import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseRules, type Rule } from './css-rules'

/**
 * Windows high contrast and print (design system, 08-responsive-and-accessible.md "Windows high contrast" and "Print").
 *
 * In forced-colours mode every colour becomes a system colour, so a row marked only by a tint is no longer marked.
 * The surfaces that carry a current row are read from the stylesheets and components that draw them, so a new one
 * that tints a row without a forced-colours rule fails here instead of passing by omission. Print hides the page's
 * chrome, shows every line of code, opens collapsed sections and writes out the target of an external link.
 */
const SRC = new URL('../src/', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, SRC), 'utf8')
const A11Y = 'styles/a11y-print.css'
/** The text of an Astro component's `<style>` blocks. */
const styleOf = (source: string) => [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')

/** Every stylesheet and component style that draws the page, apart from the file under test and the token definitions. */
function drawingRules(): Rule[] {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((path) => !path.startsWith('content/') && !path.startsWith('data/'))
  return files.flatMap((path) => {
    if (path === A11Y || path === 'styles/tokens.css') return []
    if (path.endsWith('.css')) return parseRules(read(path))
    if (path.endsWith('.astro')) return parseRules(styleOf(read(path)))
    return []
  })
}

const important = (value: string | undefined) => value?.replace(/\s*!important$/, '')
const inMedia = (rule: Rule, query: string) => rule.media.some((media) => media.includes(query))

/** The selectors that mark a row with the current-row tint: where a reader is, drawn in a background and nothing else. */
const currentRowSelectors = (rules: Rule[]) => [...new Set(rules
  .filter((rule) => /--current-row-bg/.test(rule.declarations.background ?? ''))
  .flatMap((rule) => rule.selectors))]

/** What forced colours owes each current row: the system highlight on the row, its text and everything inside it. */
function forcedRowViolations(rows: string[], a11y: string): string[] {
  const forced = parseRules(a11y).filter((rule) => inMedia(rule, '(forced-colors: active)'))
  const found: string[] = []
  for (const row of rows) {
    const own = forced.find((rule) => rule.selectors.includes(row))
    if (!own) { found.push(`${row}: no forced-colours rule`); continue }
    if (important(own.declarations.background) !== 'Highlight') found.push(`${row}: the row does not take Highlight`)
    if (important(own.declarations.color) !== 'HighlightText') found.push(`${row}: its text does not take HighlightText`)
    if (!own.declarations.background?.endsWith('!important')) found.push(`${row}: a scoped component rule outranks it without !important`)
    if (own.declarations['forced-color-adjust'] !== 'none') found.push(`${row}: Chromium puts a Canvas backplate under its text unless it opts out of the forced palette`)
    const inside = forced.find((rule) => rule.selectors.includes(`${row} *`))
    if (important(inside?.declarations.color) !== 'HighlightText') found.push(`${row}: what it holds keeps a colour that Highlight hides`)
  }
  return found
}

describe('the stylesheet', () => {
  it('is imported by the global stylesheet after the component rules it overrides', () => {
    const imports = [...read('styles/global.css').matchAll(/^@import "\.\/([^"]+)"/gm)].map((match) => match[1])
    expect(imports).toContain('a11y-print.css')
    expect(imports.indexOf('a11y-print.css')).toBeGreaterThan(imports.indexOf('kind-marks.css'))
  })
})

describe('forced colours', () => {
  const rules = drawingRules()
  const a11y = read(A11Y)
  const rows = currentRowSelectors(rules)

  it('finds the current rows of the API tree, the docs and MCP sidebar and the catalog tree', () => {
    // The docs sidebar column also lists the MCP tools and the tmux catalog's pages; the API tree draws every inventory, catalog included.
    expect(rows).toEqual(expect.arrayContaining([
      ".api-nav__leaf[aria-current='page']",
      ".api-nav__row:has(> [aria-current='page'])",
      '.sidebar-link.active',
      ".sidebar-section:not([open]):has([aria-current='page']) > summary",
    ]))
  })

  it('marks every current row with the system highlight, not a tint', () => {
    expect(forcedRowViolations(rows, a11y)).toEqual([])
  })

  it('fails for a current row that has no forced-colours rule', () => {
    const without = a11y.replace(/\.sidebar-link\.active,\s*\n/g, '')
    expect(forcedRowViolations(rows, without).length).toBeGreaterThan(0)
    expect(forcedRowViolations([...rows, '.a-new-row[aria-current]'], a11y)).toEqual(['.a-new-row[aria-current]: no forced-colours rule'])
    expect(forcedRowViolations(rows, a11y.replace(/background: Highlight !important/g, 'background: Canvas !important')).length).toBeGreaterThan(0)
    expect(forcedRowViolations(rows, a11y.replace(/forced-color-adjust: none;\n/g, '')).length).toBeGreaterThan(0)
  })

  it('draws the kind mark of a current row as an inverse chip with a border, so it stays visible on the highlight', () => {
    const forced = parseRules(a11y).filter((rule) => inMedia(rule, '(forced-colors: active)'))
    for (const row of [".api-nav__leaf[aria-current='page']", ".api-nav__row:has(> [aria-current='page'])", '.sidebar-link.active']) {
      const mark = forced.find((rule) => rule.selectors.includes(`${row} > .api-nav__kind`))
      expect(mark, row).toBeDefined()
      expect(important(mark!.declarations.background), row).toBe('HighlightText')
      expect(important(mark!.declarations.color), row).toBe('Highlight')
      expect(important(mark!.declarations['border-color']), row).toBe('HighlightText')
      // The glyph is a child of the mark: the row's "what it holds" rule would draw it in the mark's own fill.
      const glyph = forced.find((rule) => rule.selectors.includes(`${row} > .api-nav__kind *`))
      expect(important(glyph?.declarations.color), `${row} glyph`).toBe('Highlight')
    }
  })

  it('keeps a border in a system colour on kind marks and badges, and Highlight on a pressed chip', () => {
    const all = parseRules([read('styles/kind-marks.css'), a11y].join('\n')).filter((rule) => inMedia(rule, '(forced-colors: active)'))
    const bordered = all.filter((rule) => rule.selectors.some((selector) => /\.api-nav__kind|\.api-badge/.test(selector)) && rule.declarations['border-color'] === 'CanvasText')
    expect(bordered.length).toBeGreaterThan(0)
    const pressed = all.find((rule) => rule.selectors.includes("[aria-pressed='true']"))
    expect(important(pressed?.declarations.background)).toBe('Highlight')
    expect(important(pressed?.declarations.color)).toBe('HighlightText')
    expect(pressed?.declarations['forced-color-adjust']).toBe('none')
  })

  it('draws every focus ring in Highlight', () => {
    const ring = parseRules(a11y).find((rule) => inMedia(rule, '(forced-colors: active)') && rule.selectors.includes(':focus-visible'))
    expect(important(ring?.declarations['outline-color'])).toBe('Highlight')
    expect(ring?.declarations['outline-color']).toMatch(/!important$/)
  })
})

/** What print owes a reader: no chrome, every line, every section and every address. */
function printViolations(a11y: string, chrome: string[]): string[] {
  const print = parseRules(a11y).filter((rule) => inMedia(rule, 'print'))
  const found: string[] = []
  const hidden = new Set(print.filter((rule) => important(rule.declarations.display) === 'none').flatMap((rule) => rule.selectors))
  for (const selector of chrome) if (!hidden.has(selector)) found.push(`${selector} is not hidden`)
  const code = print.find((rule) => rule.selectors.includes('.expressive-code pre'))
  if (important(code?.declarations['max-height']) !== 'none' || important(code?.declarations.overflow) !== 'visible') found.push('a code block keeps its height cap')
  if (important(code?.declarations.height) !== 'auto') found.push('a player keeps the fixed height of its program')
  if (important(code?.declarations['white-space']) !== 'pre-wrap') found.push('a long code line scrolls instead of wrapping')
  const details = print.find((rule) => rule.selectors.includes('details:not([open])::details-content'))
  if (important(details?.declarations['content-visibility']) !== 'visible') found.push('a collapsed section stays collapsed')
  const external = print.find((rule) => rule.selectors.some((selector) => /a\[href\^='http'\]/.test(selector) && selector.endsWith('::after')))
  if (!/attr\(href\)/.test(external?.declarations.content ?? '')) found.push('an external link prints no address')
  // The shell's own glyph is a masked box with a width: it has to give way to text.
  else if (important(external?.declarations.mask) !== 'none' || important(external?.declarations['inline-size']) !== 'auto') found.push('an external link keeps its glyph over the address')
  return found
}

describe('print', () => {
  const a11y = read(A11Y)
  // The page's chrome by the class, id or attribute its markup carries.
  const CHROME: [string, string][] = [
    ['components/SiteHeader.astro', '.site-header'],
    ['components/PrereleaseNotice.astro', '.prerelease-notice'],
    ['components/docs/DocumentationContext.astro', '.documentation-context'],
    ['layouts/DocsLayout.astro', '.docs-shell > aside'],
    ['layouts/DocsLayout.astro', '#mobile-sidebar'],
    ['layouts/DocsLayout.astro', '.mobile-toolbar'],
    ['components/api/ApiTree.astro', '.api-nav-column'],
    ['components/VersionSwitcher.astro', '.doc-picker'],
    ['components/HomeLauncher.astro', '.home-launcher'],
    ['components/replay/ReplayControls.astro', '.mcp-replay__controls'],
    ['components/HomeExample.astro', '.home-example-options'],
    ['components/docs/PageEnd.astro', '.page-end'],
    ['components/BackToTop.astro', '#back-to-top'],
  ]
  const chrome = CHROME.map(([, selector]) => selector)

  it('names chrome that the markup has: a selector no component carries would hide nothing', () => {
    for (const [file, selector] of CHROME) {
      const token = selector.split(/[\s>]+/).at(-1)!.replace(/^[.#]/, '')
      expect(read(file), `${selector} in ${file}`).toContain(token)
    }
  })

  it('hides the chrome, shows every line of code wrapped, opens collapsed sections and writes out external addresses', () => {
    expect(printViolations(a11y, chrome)).toEqual([])
  })

  it('fails for a page that keeps its chrome, caps its code, collapses a section or hides an address', () => {
    expect(printViolations(a11y.replace(/\.site-header,\s*\n/, ''), chrome)).toEqual(['.site-header is not hidden'])
    expect(printViolations(a11y.replace('max-height: none !important', 'max-height: 20rem'), chrome)).toEqual(['a code block keeps its height cap'])
    expect(printViolations(a11y.replace('height: auto !important;\n    max-height', 'max-height'), chrome)).toEqual(['a player keeps the fixed height of its program'])
    expect(printViolations(a11y.replace('content-visibility: visible', 'content-visibility: hidden'), chrome)).toEqual(['a collapsed section stays collapsed'])
    expect(printViolations(a11y.replace("attr(href)", "''"), chrome)).toEqual(['an external link prints no address'])
    expect(printViolations(a11y.replace('mask: none !important', 'mask: url(glyph.svg)'), chrome)).toEqual(['an external link keeps its glyph over the address'])
  })

  it('prints every line of a capped code frame: the frame\'s own print rule lifts its cap', () => {
    const frame = read('plugins/ec-code-frame.mjs')
    expect(frame).toMatch(/@media print \{[^}]*\.frame\[data-cap\] pre \{ max-height: none !important; overflow: visible !important; \}/)
  })
})
