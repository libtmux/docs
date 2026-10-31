import { readFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { siteCss } from './site-css'

/**
 * Badges in a prose page, in a real browser with the site's compiled stylesheet and no server. A README puts its badges
 * in one paragraph, one link and image to each, and Tailwind's preflight makes every image a block, so they stack.
 */
const SHEET = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
const RULE = /\n {2}\.prose :where\(p:not\([^\n]*\) img:not\(:where\(\.not-prose, \.not-prose \*\)\) \{[^}]*\}\n/

const swatch = (width: number) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${width}' height='20'%3E%3Crect width='${width}' height='20' fill='%23888'/%3E%3C/svg%3E`
const image = (name: string, width: number) => `<img alt="${name}" width="${width}" height="20" src="${swatch(width)}">`
const badge = (name: string, width: number) => `<a href="https://example.test/${name}">${image(name, width)}</a>`
const BADGES = [['build', 90], ['tmux matrix', 120], ['license', 80], ['docs', 100]] as const

const PAGE = `<main style="width: 760px"><article class="prose max-w-none">
  <p id="badges">${BADGES.map(([name, width]) => badge(name, width)).join('\n')}</p>
  <p id="lone">${image('Screenshot', 400)}</p>
  <p id="lone-link">${badge('release', 90)}</p>
  <p id="text">See ${image('first', 90)} and ${image('second', 90)} for the status.</p>
  <ul><li id="item">Released ${badge('release', 90)} today</li></ul>
  <table><thead><tr><th id="head">${badge('head', 90)}</th></tr></thead><tbody><tr><td id="cell">${badge('cell', 90)}</td></tr></tbody></table>
  <div class="not-prose"><p id="plain">${badge('first', 90)}\n${badge('second', 90)}</p></div>
  <figure id="figure">${image('Screenshot', 400)}</figure>
</article></main>`

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

async function measure(css: string) {
  const target = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    await target.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${PAGE}</body></html>`)
    return await target.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
      const display = (selector: string) => [...document.querySelectorAll(`${selector} img`)].map((element) => getComputedStyle(element).display)
      const badges = [...document.querySelectorAll('#badges img')]
      return {
        badges: display('#badges'),
        tops: badges.map((element) => element.getBoundingClientRect().top),
        paragraph: box('#badges').height,
        item: box('#item').height,
        cell: box('#cell').height,
        lone: display('#lone'),
        loneMargin: parseFloat(getComputedStyle(document.querySelector('#lone img')!).marginTop),
        loneLink: display('#lone-link'),
        text: display('#text'),
        inList: display('#item'),
        inCell: display('#cell'),
        inHead: display('#head'),
        notProse: display('#plain'),
        figure: display('#figure'),
      }
    })
  } finally { await target.close() }
}

describe('images in a line of prose, at desktop width', () => {
  it('keeps a paragraph of badges on one line and an image inside text, a list item or a cell in its line', { timeout: 30_000 }, async () => {
    const seen = await measure(await siteCss(['prose', 'max-w-none', 'not-prose']))
    expect(seen.badges).toEqual(['inline', 'inline', 'inline', 'inline'])
    expect(Math.max(...seen.tops) - Math.min(...seen.tops), 'the badges share a line').toBeLessThan(1)
    // One badge is 20 px tall: a paragraph that holds a single line is under two of them, and the margins of a stacked
    // image would have made it several.
    expect(seen.paragraph).toBeLessThan(40)
    expect(seen.item).toBeLessThan(40)
    // A cell adds its padding to the line.
    expect(seen.cell).toBeLessThan(50)
    expect(seen.text).toEqual(['inline', 'inline'])
    expect(seen.inList).toEqual(['inline'])
    expect(seen.inCell).toEqual(['inline'])
    expect(seen.inHead).toEqual(['inline'])
  })

  it('keeps a lone image, a figure and the images of a not-prose block as blocks', { timeout: 30_000 }, async () => {
    const seen = await measure(await siteCss(['prose', 'max-w-none', 'not-prose']))
    expect(seen.lone).toEqual(['block'])
    expect(seen.loneMargin, 'the margin of a lone image').toBeGreaterThan(0)
    expect(seen.loneLink).toEqual(['block'])
    expect(seen.figure).toEqual(['block'])
    expect(seen.notProse).toEqual(['block', 'block'])
  })

  it('stacks the badges without the rule, so that the checks above can fail', { timeout: 30_000 }, async () => {
    expect(SHEET).toMatch(RULE)
    const seen = await measure(await siteCss(['prose', 'max-w-none', 'not-prose'], (source) => source.replace(RULE, '\n')))
    expect(seen.badges).toEqual(['block', 'block', 'block', 'block'])
    expect(Math.max(...seen.tops) - Math.min(...seen.tops)).toBeGreaterThan(60)
    expect(seen.paragraph).toBeGreaterThan(80)
    expect(seen.inList).toEqual(['block'])
  })
})
