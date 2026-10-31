import { readFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
// A reference page asks the content collection for its sidebar; the tables here are drawn without one.
vi.mock('astro:content', () => ({ getCollection: async () => [] }))
import { SymbolIndex } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { memberTable, variantPayloads } from '../src/lib/api-sections'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { siteCss } from './site-css'

/**
 * The Name, Type and Description table of a type page, in a real browser with the site's compiled stylesheet and no
 * server: the Go fields, the C# properties and the Rust variants that one component draws, with the type cell as the
 * page draws it (linked names, each broken only where `SymbolName` allows). The reference column lets any word break,
 * so a description with long lines used to squeeze the first two columns until a name broke between letters. Each table
 * sits in the page's own grid, so its box is the width a reader has at that screen.
 */
const API = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
const HINTS = /\.api-scalar-members :is\(th\[scope="row"\], td:nth-child\(2\)\) wbr \{ display: none; \}\n/
const RULES = /\/\* In the table, a name and a type are read whole[\s\S]*?\n\}\n(?=\.api-member-group \{)/

/** Screens from a small phone to a wide desktop, and the boxes just above the width where the rows stop stacking. */
const WIDTHS = [320, 360, 390, 640, 768, 1024, 1180, 1440]
const BOXES = [740, 760, 800]
const TABLES = [['go', 'tmux.ServerOptions'], ['csharp', 'LibTmux.Workspace.WorkspacePlan'], ['csharp', 'LibTmux.Workspace.WorkspaceResult'], ['rs', 'control.Event']] as const

/** The real component and the real type cell, with the prose cells drawn as plain text. */
async function tables() {
  const template = await loadAstroTemplate('components/api/ApiScalarMembers.astro', {
    real: ['components/api/ApiType.astro', 'components/api/SymbolName.astro'],
    stubs: { 'components/api/ApiDoc.astro': '---\nconst { text } = Astro.props\n---\n<span data-doc>{text}</span>' },
  })
  const html: string[] = []
  for (const [port, id] of TABLES) {
    const model = API_MODELS[port]
    const owner = model.symbols.find((symbol) => symbol.id === id)!
    const table = memberTable(owner, model.symbols.filter((symbol) => symbol.parent === owner.id), port)!
    const hrefFor = (symbol: { slug?: string }) => `/en/${port}/latest/reference/${symbol.slug}/`
    html.push(await renderAstroTemplate(template, { props: {
      owner, members: table.rows, index: new SymbolIndex(model.symbols, hrefFor, port), hrefFor, columns: table.columns, label: table.label,
      payloads: table.columns === 'variants' ? variantPayloads(model.symbols, table.rows) : undefined,
    } }))
  }
  return html
}

const CANDIDATES = ['grid', 'min-w-0', 'px-4', 'py-6', 'lg:px-6', 'mt-8', 'table', 'sr-only']
/** The page as ApiReference lays it out: the sidebar column, the content and the contents rail, around the tables. */
const page = (html: string[]) => `<main class="api-reference-layout api-reference-layout--symbol grid"><nav class="api-nav-column"></nav>
  <div class="api-reference-content min-w-0 px-4 py-6 lg:px-6">${html.map((table) => `<div class="api-field-table mt-8">${table}</div>`).join('')}</div>
  <div class="api-page-contents"></div></main>`
/** The same content in a box of a given width, to land just above or below the width where the rows stack. */
const box = (html: string[], width: number) => `<div class="api-reference-content" style="width: ${width}px">${html.map((table) => `<div class="api-field-table">${table}</div>`).join('')}</div>`

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

interface Seen {
  /** Name, Type and heading words that a line break cut, by table and screen. */
  broken: string[]
  /** Screens where the page scrolls sideways, and tables that scroll inside their box. */
  scrolls: string[]
  /** Per table that is not stacked: the Name, Type and Description columns of its first row. */
  columns: { table: number; screen: string; name: number; type: number; description: number }[]
  /** Stacked rows whose name and type are not on one line though they fit there, or whose description is not below. */
  cards: string[]
  /** Tables that stacked, by table and screen. */
  stacked: string[]
}

type Screen = { label: string; viewport: number; box?: number }

async function measure(css: string, html: string[], screens: Screen[]): Promise<Seen> {
  const seen: Seen = { broken: [], scrolls: [], columns: [], cards: [], stacked: [] }
  const target = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    for (const screen of screens) {
      await target.setViewportSize({ width: screen.viewport, height: 900 })
      await target.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body>${screen.box ? box(html, screen.box) : page(html)}</body></html>`)
      const found = await target.evaluate(() => {
        /** The words of `cell` that sit on more than one line. */
        const cut = (cell: Element) => {
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
          const nodes: { node: Text; start: number }[] = []
          let text = ''
          for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) { nodes.push({ node, start: text.length }); text += node.data }
          const holding = (offset: number, end: boolean) => nodes.find(({ node, start }) => end ? offset > start && offset <= start + node.length : offset >= start && offset < start + node.length)
          const words: { word: string; width: number }[] = []
          for (const match of text.matchAll(/\S+/g)) {
            const from = holding(match.index, false), to = holding(match.index + match[0].length, true)
            if (!from || !to) continue
            const range = document.createRange()
            range.setStart(from.node, match.index - from.start)
            range.setEnd(to.node, match.index + match[0].length - to.start)
            let lines = 0, bottom = -Infinity, width = 0
            for (const rect of [...range.getClientRects()].filter((rectangle) => rectangle.width > 0).sort((a, b) => a.top - b.top)) {
              if (rect.top >= bottom - 1) lines++
              bottom = Math.max(bottom, rect.bottom)
              width += rect.width
            }
            if (lines > 1) words.push({ word: match[0], width })
          }
          return words
        }
        const rect = (element: Element) => element.getBoundingClientRect()
        return {
          scrolls: document.documentElement.scrollWidth > innerWidth + 1,
          tables: [...document.querySelectorAll('table.api-scalar-members')].map((table, index) => {
            const stacked = getComputedStyle(table).display === 'block'
            const heads = [...table.querySelectorAll('thead th')].filter((cell) => rect(cell).width > 2)
            const cells = [...table.querySelectorAll('tbody th, tbody td:nth-child(2)')]
            const [name, type, description] = [...table.querySelector('tbody tr')!.children].map(rect)
            const boxed = table.closest('.api-scalar-box')!
            const cards = stacked ? [...table.querySelectorAll('tbody tr')].flatMap((row) => {
              const [nameCell, typeCell, descriptionCell] = [...row.children] as HTMLElement[]
              if (!typeCell || getComputedStyle(typeCell).display === 'none') return []
              const sameLine = Math.abs(rect(nameCell!).top - rect(typeCell).top) < 4
              // The width the type takes on one line, which it needs beside the name it would share the row with.
              const kept = typeCell.getAttribute('style')
              typeCell.style.cssText = 'flex: none; max-width: none; width: max-content;'
              const natural = rect(typeCell).width
              if (kept === null) typeCell.removeAttribute('style'); else typeCell.setAttribute('style', kept)
              const style = getComputedStyle(row)
              const inner = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
              const fits = rect(nameCell!).width + parseFloat(style.columnGap) + natural <= inner + 0.5
              const problems = []
              if (fits !== sameLine) problems.push(fits ? 'the type fits beside the name and sits under it' : 'the type does not fit beside the name and squeezes in beside it')
              if (rect(descriptionCell!).top < Math.max(rect(nameCell!).bottom, rect(typeCell).bottom) - 1) problems.push('the description is not below')
              return problems.map((problem) => `${nameCell!.textContent}: ${problem}`)
            }) : []
            // A word wider than the card has to break somewhere; any other word is cut for want of care.
            const row = table.querySelector('tbody tr')!
            const rowStyle = getComputedStyle(row)
            const line = stacked ? row.clientWidth - parseFloat(rowStyle.paddingLeft) - parseFloat(rowStyle.paddingRight) : 0
            return {
              index, stacked, cards,
              broken: [...heads, ...cells].flatMap((cell) => cut(cell)).filter(({ width }) => !stacked || width <= line + 0.5).map(({ word }) => word),
              layout: { name: name!.width, type: type!.width, description: description!.width },
              scrolls: boxed.scrollWidth > boxed.clientWidth + 1,
            }
          }),
        }
      })
      if (found.scrolls) seen.scrolls.push(`the page at ${screen.label}`)
      for (const table of found.tables) {
        const where = `${TABLES[table.index]![1]} at ${screen.label}`
        for (const word of new Set(table.broken)) seen.broken.push(`${where}: ${word}`)
        if (table.scrolls) seen.scrolls.push(where)
        for (const problem of table.cards) seen.cards.push(`${where}: ${problem}`)
        if (table.stacked) seen.stacked.push(where)
        else seen.columns.push({ table: table.index, screen: screen.label, ...table.layout })
      }
    }
    return seen
  } finally { await target.close() }
}

const SCREENS: Screen[] = [...WIDTHS.map((width) => ({ label: `${width}px`, viewport: width })), ...BOXES.map((width) => ({ label: `a ${width}px box`, viewport: 1440, box: width }))]

describe('the Name, Type and Description table', () => {
  it('keeps every name, type and heading word whole, from 320 to 1440 pixels and just above the width where rows stack', { timeout: 180_000 }, async () => {
    const seen = await measure(`${await siteCss(CANDIDATES)}\n${API}`, await tables(), SCREENS)
    expect(seen.broken).toEqual([])
    expect(seen.scrolls, 'something scrolls sideways').toEqual([])
    // Wide enough to be a table, the Description gets what the Name and Type do not need: the widest column of the Go
    // fields, and never under 12rem beside the long generic types of the C# properties.
    expect(seen.columns.length).toBeGreaterThan(0)
    for (const column of seen.columns) {
      expect(column.description, JSON.stringify(column)).toBeGreaterThanOrEqual(192)
      if (column.table === 0) expect(column.description, JSON.stringify(column)).toBeGreaterThan(Math.max(column.name, column.type))
    }
  })

  it('stacks each row of a narrow box as a card: the name and the type on one line when they fit, the description below', { timeout: 180_000 }, async () => {
    const seen = await measure(`${await siteCss(CANDIDATES)}\n${API}`, await tables(), SCREENS)
    expect(seen.cards).toEqual([])
    // Every table stacks on a phone and none does on a desktop.
    for (const width of [320, 360, 390]) expect(seen.stacked.filter((where) => where.endsWith(`at ${width}px`))).toHaveLength(TABLES.length)
    expect(seen.stacked.filter((where) => where.endsWith('at 1180px') || where.endsWith('at 1440px'))).toEqual([])
    expect(seen.stacked.filter((where) => where.includes('box'))).toEqual([])
  })

  it('cuts a linked type at the hints of its names without the rule that hides them, so that the checks above can fail', { timeout: 180_000 }, async () => {
    expect(API).toMatch(HINTS)
    const seen = await measure(`${await siteCss(CANDIDATES)}\n${API.replace(HINTS, '')}`, await tables(), SCREENS)
    // A name such as `WorkspaceAction` is drawn `Workspace<wbr>Action`, and a narrow column breaks it there.
    const cut = seen.broken.filter((word) => / at (1180px|1440px|a \d+px box): [^:\s]*[a-z][A-Z]/.test(word))
    expect(cut.length, seen.broken.join('\n')).toBeGreaterThan(0)
  })

  it('cuts a name between letters without the table rules, so that the checks above can fail', { timeout: 180_000 }, async () => {
    expect(API).toMatch(RULES)
    const seen = await measure(`${await siteCss(CANDIDATES)}\n${API.replace(RULES, '')}`, await tables(), SCREENS)
    expect(seen.broken).toContain('tmux.ServerOptions at 1180px: ConfigFile')
    expect(seen.broken.some((word) => word.endsWith(': Name'))).toBe(true)
  })
})
