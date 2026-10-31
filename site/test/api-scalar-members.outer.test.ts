import { readFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
// A reference page asks the content collection for its sidebar; the tables here are drawn without one.
vi.mock('astro:content', () => ({ getCollection: async () => [] }))
import { SymbolIndex } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { LONG_CELL_CHARACTERS, memberTable, scalarCellCharacters, variantPayloads } from '../src/lib/api-sections'
import { wordBreak } from '../src/lib/word-break'
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
const TABLE_RULES = /\/\* In the table, a name and a type are read whole[\s\S]*?(?=\/\* A variant with no recorded shape)/
const HINT_RULE = /\.api-scalar-members :where\(th\[scope="row"\], td:nth-child\(2\)\) wbr \{ display: none; \}\n/
const LONG_RULES = /\/\* A table whose cells need more room[\s\S]*?\n\}\n(?=\.api-member-group \{)/

/** Screens from a small phone to a wide desktop, and boxes around the two widths where the rows stop stacking. */
const WIDTHS = [320, 360, 390, 640, 768, 1024, 1180, 1440]
const BOXES = [560, 580, 600, 700, 760, 770, 800]

type Pick = readonly [port: 'go' | 'csharp' | 'rs', id: string]
/** The tables the page names, then the widest table the narrow width serves, and the narrowest and the widest the wide width is for. */
function picks(): Pick[] {
  const named: Pick[] = [['go', 'tmux.ServerOptions'], ['csharp', 'LibTmux.Workspace.WorkspacePlan'], ['csharp', 'LibTmux.Workspace.WorkspaceResult'], ['rs', 'control.Event']]
  const sized: { pick: Pick; characters: number }[] = []
  for (const port of ['go', 'csharp', 'rs'] as const) {
    const model = API_MODELS[port]
    for (const owner of model.symbols) {
      const table = memberTable(owner, model.symbols.filter((symbol) => symbol.parent === owner.id), port)
      if (!table) continue
      const payloads = table.columns === 'variants' ? variantPayloads(model.symbols, table.rows) : undefined
      sized.push({ pick: [port, owner.id], characters: scalarCellCharacters(table.rows, table.columns, payloads) })
    }
  }
  const short = sized.filter(({ characters }) => characters <= LONG_CELL_CHARACTERS).sort((a, b) => b.characters - a.characters)[0]!
  const long = sized.filter(({ characters }) => characters > LONG_CELL_CHARACTERS).sort((a, b) => a.characters - b.characters)
  return [...named, short.pick, long[0]!.pick, long.at(-1)!.pick]
}
const TABLES = picks()
const GO = 0
const RESULT = 2
// The widest table the narrow width serves, then the narrowest and the widest table the wide width is for.
const SHORTEST_EDGE = TABLES.length - 3
const LONGEST_EDGE = TABLES.length - 1

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
/** The same content in a box of a given width, to land just above or below a width where the rows stack. */
const box = (html: string[], width: number) => `<div class="api-reference-content" style="width: ${width}px">${html.map((table) => `<div class="api-field-table">${table}</div>`).join('')}</div>`

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

interface Seen {
  /** Name, Type and heading words that a line break cut, by table and screen. */
  broken: string[]
  /** Words of a stacked row that were wider than the card, or were cut at a break hint of their names. */
  wrapped: string[]
  /** Screens where the page scrolls sideways, and tables that scroll inside their box. */
  scrolls: string[]
  /** Per table that is not stacked: the Name, Type and Description columns of its first row. */
  columns: { table: number; screen: string; name: number; type: number; description: number }[]
  /** Stacked rows whose name and type are not on one line though they fit there, or whose description is not below. */
  cards: string[]
  /** Tables that stacked, by table index and screen label. */
  stacked: { table: number; screen: string }[]
}

type Screen = { label: string; viewport: number; box?: number }

async function measure(css: string, html: string[], screens: Screen[]): Promise<Seen> {
  const seen: Seen = { broken: [], wrapped: [], scrolls: [], columns: [], cards: [], stacked: [] }
  const target = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    for (const screen of screens) {
      await target.setViewportSize({ width: screen.viewport, height: 900 })
      await target.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body>${screen.box ? box(html, screen.box) : page(html)}</body></html>`)
      const found = await target.evaluate(() => {
        /** The words of `cell` that sit on more than one line, with where each line starts and how wide the word is. */
        const cut = (cell: Element) => {
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
          const nodes: { node: Text; start: number }[] = []
          let text = ''
          for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) { nodes.push({ node, start: text.length }); text += node.data }
          const holding = (offset: number) => nodes.find(({ node, start }) => offset >= start && offset < start + node.length)
          const words: { word: string; width: number; breaks: number[] }[] = []
          for (const match of text.matchAll(/\S+/g)) {
            const breaks: number[] = []
            let width = 0, bottom = -Infinity
            for (let offset = 0; offset < match[0].length; offset++) {
              const at = holding(match.index + offset)
              if (!at) continue
              const range = document.createRange()
              range.setStart(at.node, match.index + offset - at.start)
              range.setEnd(at.node, match.index + offset - at.start + 1)
              const rect = [...range.getClientRects()].find((candidate) => candidate.width > 0)
              if (!rect) continue
              width += rect.width
              if (bottom !== -Infinity && rect.top >= bottom - 1) breaks.push(offset)
              bottom = bottom === -Infinity || rect.top >= bottom - 1 ? rect.bottom : Math.max(bottom, rect.bottom)
            }
            if (breaks.length) words.push({ word: match[0], width, breaks })
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
            const row = table.querySelector('tbody tr')!
            const [name, type, description] = [...row.children].map(rect)
            const rowStyle = getComputedStyle(row)
            const line = stacked ? row.clientWidth - parseFloat(rowStyle.paddingLeft) - parseFloat(rowStyle.paddingRight) : 0
            const boxed = table.closest('.api-scalar-box')!
            const cards = stacked ? [...table.querySelectorAll('tbody tr')].flatMap((card) => {
              const [nameCell, typeCell, descriptionCell] = [...card.children] as HTMLElement[]
              if (!typeCell || getComputedStyle(typeCell).display === 'none') return []
              const sameLine = Math.abs(rect(nameCell!).top - rect(typeCell).top) < 4
              // The width the type takes on one line, which it needs beside the name it would share the row with.
              const kept = typeCell.getAttribute('style')
              typeCell.style.cssText = 'flex: none; max-width: none; width: max-content;'
              const natural = rect(typeCell).width
              if (kept === null) typeCell.removeAttribute('style'); else typeCell.setAttribute('style', kept)
              const style = getComputedStyle(card)
              const inner = card.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
              const fits = rect(nameCell!).width + parseFloat(style.columnGap) + natural <= inner + 0.5
              const problems = []
              if (fits !== sameLine) problems.push(fits ? 'the type fits beside the name and sits under it' : 'the type does not fit beside the name and squeezes in beside it')
              if (rect(descriptionCell!).top < Math.max(rect(nameCell!).bottom, rect(typeCell).bottom) - 1) problems.push('the description is not below')
              return problems.map((problem) => `${nameCell!.textContent}: ${problem}`)
            }) : []
            return {
              index, stacked, cards, line,
              cut: [...heads, ...cells].flatMap((cell) => cut(cell)),
              layout: { name: name!.width, type: type!.width, description: description!.width },
              scrolls: boxed.scrollWidth > boxed.clientWidth + 1,
            }
          }),
        }
      })
      if (found.scrolls) seen.scrolls.push(`the page at ${screen.label}`)
      for (const table of found.tables) {
        const where = `${TABLES[table.index]![1]} at ${screen.label}`
        for (const { word, width, breaks } of table.cut) {
          // A stacked word may break when it is wider than the card, and then, or while wrapping, at a break hint of its names.
          // The browser also breaks after a question mark, as it does after the nullable mark of a C# type.
          const hints = new Set([...wordBreak(word).slice(0, -1).map((_, part, parts) => parts.slice(0, part + 1).join('').length),
            ...[...word].flatMap((character, offset) => character === '?' && offset + 1 < word.length ? [offset + 1] : [])])
          if (table.stacked && breaks.every((offset) => hints.has(offset))) seen.wrapped.push(`${where}: ${word}`)
          else if (!table.stacked || width <= table.line + 0.5) seen.broken.push(`${where}: ${word}`)
        }
        if (table.scrolls) seen.scrolls.push(where)
        for (const problem of table.cards) seen.cards.push(`${where}: ${problem}`)
        if (table.stacked) seen.stacked.push({ table: table.index, screen: screen.label })
        else seen.columns.push({ table: table.index, screen: screen.label, ...table.layout })
      }
    }
    return seen
  } finally { await target.close() }
}

const SCREENS: Screen[] = [...WIDTHS.map((width) => ({ label: `${width}px`, viewport: width })), ...BOXES.map((width) => ({ label: `a ${width}px box`, viewport: 1440, box: width }))]
const stackedAt = (seen: Seen, table: number) => seen.stacked.filter((entry) => entry.table === table).map((entry) => entry.screen)
const tableAt = (seen: Seen, table: number) => seen.columns.filter((entry) => entry.table === table).map((entry) => entry.screen)

describe('the Name, Type and Description table', () => {
  it('keeps every name, type and heading word whole, from 320 to 1440 pixels and around the widths where rows stack', { timeout: 180_000 }, async () => {
    const seen = await measure(`${await siteCss(CANDIDATES)}\n${API}`, await tables(), SCREENS)
    expect(seen.broken).toEqual([])
    expect(seen.scrolls, 'something scrolls sideways').toEqual([])
    // Wherever a table is a table, its Description keeps 12rem and the Go fields give it the widest column.
    expect(seen.columns.length).toBeGreaterThan(0)
    for (const column of seen.columns) {
      expect(column.description, `${TABLES[column.table]![1]} at ${column.screen}: ${JSON.stringify(column)}`).toBeGreaterThanOrEqual(192)
      if (column.table === GO) expect(column.description, JSON.stringify(column)).toBeGreaterThan(Math.max(column.name, column.type))
    }
    // A card breaks a word that is wider than itself at a hint of the names in it, not between letters.
    expect(seen.wrapped).toContain('LibTmux.Workspace.WorkspaceResult at 320px: IReadOnlyList<WorkspaceActionOutcome>')
  })

  it('stacks each row of a narrow box as a card: the name and the type on one line when they fit, the description below', { timeout: 180_000 }, async () => {
    const seen = await measure(`${await siteCss(CANDIDATES)}\n${API}`, await tables(), SCREENS)
    expect(seen.cards).toEqual([])
    for (const width of [320, 360, 390, 560]) for (const [index] of TABLES.entries()) expect(stackedAt(seen, index), `table ${index}`).toContain(width === 560 ? 'a 560px box' : `${width}px`)
    for (const [index] of TABLES.entries()) expect(tableAt(seen, index), `table ${index}`).toContain('1440px')
  })

  it('keeps the Go fields a table on a tablet and stacks the long-celled tables there until their description has room', { timeout: 180_000 }, async () => {
    const seen = await measure(`${await siteCss(CANDIDATES)}\n${API}`, await tables(), SCREENS)
    // Go ServerOptions: a table at 640, 768, 1024 and 1180 pixels, and in a box as narrow as the narrow stacking width.
    for (const screen of ['640px', '768px', '1024px', '1180px', 'a 580px box', 'a 600px box', 'a 700px box']) expect(tableAt(seen, GO), screen).toContain(screen)
    // C# WorkspaceResult: cards until the wide stacking width, a table above it.
    for (const screen of ['640px', '768px', '1024px', 'a 600px box', 'a 700px box', 'a 760px box']) expect(stackedAt(seen, RESULT), screen).toContain(screen)
    for (const screen of ['1180px', '1440px', 'a 770px box', 'a 800px box']) expect(tableAt(seen, RESULT), screen).toContain(screen)
    // The widest table the narrow width serves is a table just above it, the narrowest long-celled one is not.
    expect(tableAt(seen, SHORTEST_EDGE)).toContain('a 580px box')
    expect(stackedAt(seen, TABLES.length - 2)).toContain('a 760px box')
    expect(tableAt(seen, TABLES.length - 2)).toContain('a 770px box')
    // The widest table over the limit is stacked up to the wide width and is a table, with its description, just above it.
    expect(stackedAt(seen, LONGEST_EDGE)).toContain('a 760px box')
    expect(tableAt(seen, LONGEST_EDGE)).toContain('a 770px box')
    const widest = seen.columns.find((column) => column.table === LONGEST_EDGE && column.screen === 'a 770px box')!
    expect(widest.description, JSON.stringify(widest)).toBeGreaterThanOrEqual(192)
  })

  it('cuts a name between letters without the table rules, so that the checks above can fail', { timeout: 180_000 }, async () => {
    expect(API).toMatch(TABLE_RULES)
    const seen = await measure(`${await siteCss(CANDIDATES)}\n${API.replace(TABLE_RULES, '')}`, await tables(), SCREENS)
    expect(seen.broken).toContain('tmux.ServerOptions at 1180px: ConfigFile')
    expect(seen.broken.some((word) => word.endsWith(': Name'))).toBe(true)
  })

  it('cuts a linked type at the hints of its names without the rule that hides them, so that the checks above can fail', { timeout: 180_000 }, async () => {
    expect(API).toMatch(HINT_RULE)
    const seen = await measure(`${await siteCss(CANDIDATES)}\n${API.replace(HINT_RULE, '')}`, await tables(), SCREENS)
    // A name such as `WorkspaceAction` is drawn `Workspace<wbr>Action`, and a narrow column breaks it there.
    const cut = seen.broken.filter((word) => / at (1180px|1440px|a \d+px box): [^:\s]*[a-z][A-Z]/.test(word))
    expect(cut.length, seen.broken.join('\n')).toBeGreaterThan(0)
  })

  it('leaves a long-celled table a table with a short description when its class is ignored, so that the checks above can fail', { timeout: 180_000 }, async () => {
    expect(API).toMatch(LONG_RULES)
    const seen = await measure(`${await siteCss(CANDIDATES)}\n${API.replace(LONG_RULES, '')}`, await tables(), SCREENS)
    const narrow = seen.columns.filter((column) => column.table === RESULT && column.description < 192)
    expect(narrow.length, JSON.stringify(seen.columns.filter((column) => column.table === RESULT))).toBeGreaterThan(0)
    expect(tableAt(seen, RESULT)).toContain('a 700px box')
  })
})
