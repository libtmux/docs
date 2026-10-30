import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { experimental_AstroContainer } from 'astro/container'
import { API_MODELS } from '../src/lib/api-models'
import { loadAstroTemplate, withoutScope } from './astro-templates'

// A reference page asks the content collection for its sidebar; none of these checks reads one.
vi.mock('astro:content', () => ({ getCollection: async () => [] }))

type Port = 'rs' | 'go' | 'csharp'

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

describe('a type page with a table of fields', () => {
  // The table, the contents rail and the badges are the page's own; the type and prose cells draw plain text.
  const PAGE = ['components/api/ApiPageContents.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro', 'components/api/ApiScalarMembers.astro']
  async function page(port: Port, id: string) {
    const template = await loadAstroTemplate('components/api/ApiReference.astro', { real: PAGE })
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    const owner = API_MODELS[port].symbols.find((entry) => entry.id === id)!
    win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
      request: new Request(`https://libtmux.org/en/${port}/latest/reference/${owner.slug}/`), params: { slug: owner.slug }, props: { model: API_MODELS[port], owner },
    }))
    return win.document
  }
  const contents = (document: Window['document']) => [...document.querySelectorAll('nav[aria-label="On this page"] a')].map((link) => [link.getAttribute('href'), link.textContent])

  it.each([['csharp', 'LibTmux.TmuxCommand', 'Properties'], ['go', 'tmux.SessionFilter', 'Fields']] as const)(
    '%s %s names its table %s in the heading, its permalink, its caption and its contents entry', async (port, id, word) => {
      const document = await page(port, id)
      const heading = document.querySelector('h2#api-fields')!
      expect(heading.firstChild?.textContent).toBe(word)
      expect(heading.querySelector('a.api-heading-link')?.getAttribute('aria-label')).toBe(`Link to ${word}`)
      expect(heading.querySelector('a.api-heading-link')?.getAttribute('href')).toBe('#api-fields')
      expect(document.querySelector('.api-field-table caption')?.textContent).toContain(` ${word.toLowerCase()}`)
      expect(contents(document)).toContainEqual(['#api-fields', word])
      // The rest of the members keep their own heading and id.
      expect(document.querySelector('.api-members > h2#api-members')?.firstChild?.textContent).toBe('Members')
    }, 60_000)

  it('names the one heading of a C# type of only properties Properties, and keeps it the sticky Members bar', async () => {
    const document = await page('csharp', 'LibTmux.ClientAttachment')
    expect(document.querySelector('#api-fields')).toBeNull()
    const heading = document.querySelector('.api-members > h2#api-members')!
    expect(heading.firstChild?.textContent).toBe('Properties')
    expect(heading.querySelector('a.api-heading-link')?.getAttribute('aria-label')).toBe('Link to Properties')
    expect(contents(document)).toContainEqual(['#api-members', 'Properties'])
    expect(document.querySelector('.api-members caption')?.textContent).toContain(' properties')
  }, 60_000)
})

interface Rule { container?: string; layered: boolean; selectors: string[]; declarations: Record<string, string> }

/** The style rules of a stylesheet, each with the `@container` condition around it and whether a `@layer` holds it. */
function parseRules(source: string): Rule[] {
  const rules: Rule[] = []
  const walk = (text: string, container?: string, layered = false) => {
    for (let at = 0; at < text.length;) {
      const open = text.indexOf('{', at)
      if (open < 0) return
      let depth = 1
      let close = open + 1
      for (; close < text.length && depth; close++) depth += text[close] === '{' ? 1 : text[close] === '}' ? -1 : 0
      const prelude = text.slice(at, open).trim()
      const body = text.slice(open + 1, close - 1)
      if (prelude.startsWith('@container')) walk(body, prelude.slice('@container'.length).trim(), layered)
      else if (prelude.startsWith('@layer')) walk(body, container, true)
      else if (prelude.startsWith('@')) walk(body, container, layered)
      else rules.push({
        container, layered, selectors: prelude.split(/,(?![^(]*\))/).map((selector) => selector.replace(/\s+/g, ' ').trim()),
        declarations: Object.fromEntries(body.split(';').flatMap((declaration) => {
          const colon = declaration.indexOf(':')
          return colon > 0 ? [[declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]] : []
        })),
      })
      at = close
    }
  }
  walk(source.replace(/\/\*[\s\S]*?\*\//g, ''))
  return rules
}

/**
 * What a narrow Name, Type, Description table owes its reader: every column on screen, none clipped or broken inside a word.
 * The prose table rule of a docs page keeps a heading on one line and a cell at six rem, so the stacked layout has to beat it.
 */
function stackingViolations(css: string): string[] {
  const rules = parseRules(css)
  const found: string[] = []
  const box = rules.find((rule) => rule.selectors.includes('.api-scalar-box'))
  const name = /^(\S+) \/ inline-size$/.exec(box?.declarations.container ?? '')?.[1]
  if (!name) return ['the box that holds the table is not a container the query can measure']
  const narrow = rules.filter((rule) => rule.container?.startsWith(name))
  const width = Number(/^\S+ \(max-width: (\d+(?:\.\d+)?)rem\)$/.exec(narrow[0]?.container ?? '')?.[1])
  // A phone column is about 22rem and a tablet's about 40rem; below the first the table is cut, above the second it fits.
  if (!(width >= 30 && width <= 48)) found.push(`the table stacks at ${width}rem, not between a phone and a tablet column`)
  const declared = (selector: string) => Object.assign({}, ...narrow.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.declarations))
  const cells = declared('.api-scalar-members :is(th, td)')
  for (const selector of ['.api-scalar-members', '.api-scalar-members tbody']) {
    if (declared(selector).display !== 'block') found.push(`${selector} stays a table part, so its rows keep their columns`)
  }
  const row = declared('.api-scalar-members tr')
  if (row.display !== 'flex' || row['flex-wrap'] !== 'wrap') found.push('a row does not wrap its name, type and description over lines')
  if (cells['min-width'] !== '0') found.push('a cell keeps the minimum width of the prose rule, so a column is squeezed past its text')
  if (cells['white-space'] !== 'normal') found.push('a heading cell keeps white-space: nowrap from the prose rule')
  if (cells['overflow-wrap'] !== 'break-word') found.push('a cell breaks inside a word before its line is full')
  if (cells.padding !== '0') found.push('a cell keeps the padding of a column')
  if (!/(^|\s)100%$/.test(declared('.api-scalar-members td:last-child').flex ?? '')) found.push('the description does not take a line of its own')
  const head = declared('.api-scalar-members thead')
  if (head.display === 'none' || head.visibility === 'hidden') found.push('the header row leaves assistive technology')
  else if (head.position !== 'absolute' || head.overflow !== 'hidden') found.push('the header row stays on screen')
  if (narrow.some((rule) => rule.layered) || rules.filter((rule) => rule.selectors.includes('.api-scalar-box')).some((rule) => rule.layered)) {
    found.push('a layered rule loses to the prose table rule it overrides')
  }
  return found
}

describe('the narrow layout of a table of fields', () => {
  const css = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
  const prose = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')
  /** `css` with `from` replaced by `to`, from the narrow block on; the edit must land, or the control proves nothing. */
  const edit = (from: string | RegExp, to: string) => {
    const start = css.indexOf('@container api-scalar-members')
    expect(start, 'the narrow block is in the stylesheet').toBeGreaterThan(-1)
    const changed = css.slice(0, start) + css.slice(start).replace(from, to)
    expect(changed, `${from} is in the narrow block`).not.toBe(css)
    return changed
  }

  it('stacks each row in a narrow box and keeps the header for assistive technology', () => {
    expect(stackingViolations(css)).toEqual([])
  })

  it('answers the rules it overrides: the prose table keeps a heading on one line and a cell at six rem', () => {
    const rule = (selector: string) => Object.assign({}, ...parseRules(prose).filter((entry) => entry.selectors.includes(selector)).map((entry) => entry.declarations))
    expect(rule('.prose :where(th)')['white-space']).toBe('nowrap')
    expect(rule('.prose :where(td)')['min-width']).toBe('6rem')
    expect(rule('.prose :where(table)').display).toBe('block')
  })

  it.each([
    ['the container name does not reach the query', () => {
      const box = '.api-scalar-box { container: api-scalar-members / inline-size; }'
      expect(css).toContain(box)
      return css.replace(box, '.api-scalar-box { container-type: inline-size; }')
    }, 'not a container'],
    ['a phone column is outside the query', () => edit('(max-width: 34rem)', '(max-width: 20rem)'), 'not between a phone and a tablet column'],
    ['the rows keep their columns', () => edit('.api-scalar-members tbody { display: block; }', '.api-scalar-members tbody { display: table-row-group; }'), 'rows keep their columns'],
    ['a row stops wrapping', () => edit('flex-wrap: wrap;', ''), 'wrap its name'],
    ['a cell keeps the prose minimum width', () => edit('    min-width: 0;\n', ''), 'minimum width'],
    ['a heading keeps nowrap', () => edit('    white-space: normal;\n', ''), 'nowrap'],
    ['a word breaks early', () => edit('overflow-wrap: break-word;', 'overflow-wrap: anywhere;'), 'inside a word'],
    ['the description shares a line', () => edit('.api-scalar-members td:last-child { flex: 1 0 100%; }', '.api-scalar-members td:last-child { flex: 1 1 auto; }'), 'line of its own'],
    ['the header row is removed from assistive technology', () => edit('    position: absolute;\n', '    display: none;\n'), 'leaves assistive technology'],
    ['the header row is left on screen', () => edit('    overflow: hidden;\n    clip-path', '    clip-path'), 'stays on screen'],
    ['a layer holds the rules', () => `@layer components {\n${css}\n}`, 'layered rule'],
  ])('fails when %s', (_, sabotage, problem) => {
    expect(stackingViolations(sabotage()).join('\n')).toContain(problem)
  })
})
