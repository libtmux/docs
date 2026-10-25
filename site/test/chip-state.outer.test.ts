import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The usage table's chips darken their border on hover, keep their mark as it rests and focus with one outline. The
 * chips beside them (Related APIs, a command's related chips, In other ports) behave as they did on main, and this
 * says so by painting both stylesheets in a real browser. `fixtures/kind-marks.main.css` is `kind-marks.css` as main
 * served it when the usage table was added; every other sheet is the one in the tree, so only that file differs.
 */
const STYLES = fileURLToPath(new URL('../src/styles/', import.meta.url))
const MAIN = readFileSync(fileURLToPath(new URL('./fixtures/kind-marks.main.css', import.meta.url)), 'utf8')
const sheets = [...readdirSync(STYLES).filter((name) => name.endsWith('.css')), ...readdirSync(join(STYLES, 'vendor')).filter((name) => name.endsWith('.css')).map((name) => `vendor/${name}`)]
  .filter((name) => /api-nav__kind|api-badge|--mk-/.test(readFileSync(join(STYLES, name), 'utf8')))
const css = (marks: string): string[] => sheets.map((name) => (name === 'kind-marks.css' ? marks : readFileSync(join(STYLES, name), 'utf8')))
const CURRENT = readFileSync(join(STYLES, 'kind-marks.css'), 'utf8')

/** The usage rules as they were when they applied to every chip: the scope this change narrows. */
const SITEWIDE = CURRENT.replace(/^\.tmux-usage a:has\(> \.api-nav__kind\)/gm, ':is(.api-elsewhere-value, .api-command-related, .tmux-usage, nav.api-related) a:has(> .api-nav__kind)')
  .replace(/^ {2}\.tmux-usage a:has\(> \.api-nav__kind\)/gm, '  :is(.api-elsewhere-value, .api-command-related, .tmux-usage, nav.api-related) a:has(> .api-nav__kind)')

const mark = '<span class="api-nav__kind api-badge--kind-method" aria-hidden="true"><span class="api-badge__label" data-mark="cap">m</span></span>'
const chip = (id: string, wrap: (link: string) => string) => `<p>${wrap(`<a id="${id}" href="#${id}">${mark}<code>Server.panes</code></a>`)}</p>`
const CHIPS = {
  related: (link: string) => `<nav class="api-related"><ul><li>${link}</li></ul></nav>`,
  elsewhere: (link: string) => `<span class="api-elsewhere-value">${link}</span>`,
  command: (link: string) => `<div class="api-command-related">${link}</div>`,
  usage: (link: string) => `<div class="tmux-usage">${link}</div>`,
}
const body = Object.entries(CHIPS).map(([name, wrap]) => chip(name, wrap)).join('')

const CHIP_PROPERTIES = ['background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'box-shadow', 'outline-style', 'outline-width', 'outline-color', 'outline-offset', 'color']
const MARK_PROPERTIES = ['background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'box-shadow', 'color']

type Painted = Record<string, Record<string, string>>

/** The computed style of each chip and its mark at rest, hovered and focused by keyboard, in one load of `sheets`. */
async function painted(page: Page, marks: string): Promise<Painted> {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.setContent(`<!doctype html><html data-color-scheme="light"><head><style>:root { --color-foreground-primary: #202830; --background-color: #ffffff; --focus-ring-color: #1a5fb4; }
    * { transition: none !important; animation: none !important; }</style>${css(marks).map((sheet) => `<style>${sheet}</style>`).join('')}</head><body>${body}</body></html>`)
  const read = (id: string) => page.evaluate(({ id, chipProperties, markProperties }) => {
    const link = document.getElementById(id)!
    const style = (node: Element, names: string[]) => Object.fromEntries(names.map((name) => [name, getComputedStyle(node).getPropertyValue(name)]))
    return { ...Object.fromEntries(Object.entries(style(link, chipProperties)).map(([name, value]) => [`chip ${name}`, value])), ...Object.fromEntries(Object.entries(style(link.querySelector('.api-nav__kind')!, markProperties)).map(([name, value]) => [`mark ${name}`, value])) }
  }, { id, chipProperties: CHIP_PROPERTIES, markProperties: MARK_PROPERTIES })
  const result: Painted = {}
  for (const id of Object.keys(CHIPS)) {
    await page.mouse.move(0, 0)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    result[`${id} at rest`] = await read(id)
    await page.hover(`#${id}`)
    result[`${id} hovered`] = await read(id)
    await page.mouse.move(0, 0)
    // Tab to the chip, so the focus is the keyboard's and :focus-visible matches.
    for (let tries = 0; tries < 8 && (await page.evaluate(() => document.activeElement?.id)) !== id; tries++) await page.keyboard.press('Tab')
    expect(await page.evaluate((id) => document.getElementById(id)!.matches(':focus-visible'), id), `${id} is focused by keyboard`).toBe(true)
    result[`${id} focused`] = await read(id)
  }
  return result
}

/** The properties that differ between two loads, by state. */
const differences = (left: Painted, right: Painted, ids: string[]): string[] => Object.keys(left).filter((state) => ids.includes(state.split(' ')[0]!)).flatMap((state) =>
  Object.keys(left[state]!).filter((name) => left[state]![name] !== right[state]![name]).map((name) => `${state}: ${name} ${right[state]![name]} became ${left[state]![name]}`))

let browser: Browser
let page: Page
let main: Painted
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
  main = await painted(page, MAIN)
})
afterAll(async () => { await browser?.close() })

const OTHERS = ['related', 'elsewhere', 'command']

describe('the hover and focus of a chip, against main', () => {
  it('paints a Related APIs chip, a command\'s related chip and an In other ports chip, at rest, hovered and focused, as main does', async () => {
    const now = await painted(page, CURRENT)
    expect(differences(now, main, OTHERS)).toEqual([])
  })

  it('measures something: the states differ from rest, and the usage table\'s chip hovers and focuses differently from main\'s', async () => {
    const now = await painted(page, CURRENT)
    // A hovered related chip darkens its surface, and a keyboard focus is a state the browser paints.
    expect(now['related hovered']!['chip background-color']).not.toBe(now['related at rest']!['chip background-color'])
    // The usage table's chip darkens its border and rings the whole chip on focus; main never styled it.
    expect(now['usage hovered']!['chip border-top-color']).not.toBe(main['usage hovered']!['chip border-top-color'])
    expect(now['usage hovered']!['chip border-top-color']).not.toBe(now['usage at rest']!['chip border-top-color'])
    expect(now['usage focused']!['chip outline-style']).toBe('solid')
    expect(now['usage focused']!['chip outline-width']).toBe('2px')
    // Its mark keeps the fill and shadow it rests with.
    expect(now['usage hovered']!['mark background-color']).toBe(now['usage at rest']!['mark background-color'])
    expect(now['usage hovered']!['mark box-shadow']).toBe(now['usage at rest']!['mark box-shadow'])
  })

  it('notices the usage rules applied to every chip, which is how they once shipped', async () => {
    expect(SITEWIDE).not.toBe(CURRENT)
    const sitewide = await painted(page, SITEWIDE)
    const moved = differences(sitewide, main, OTHERS)
    expect(moved.some((line) => /related hovered: chip border-top-color/.test(line)), moved.join('\n')).toBe(true)
    expect(moved.some((line) => /related focused: chip outline-style/.test(line)), moved.join('\n')).toBe(true)
    expect(moved.some((line) => /related hovered: mark box-shadow/.test(line)), moved.join('\n')).toBe(true)
  })
})
