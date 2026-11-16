import { readFileSync } from 'node:fs'
import { memberSignals, type ApiSymbol } from '@libtmux/api-model/reference'
import { Window } from 'happy-dom'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import mentionsData from '../src/data/mentions.json'
import { apiMemberGroups } from '../src/lib/api-sections'
import { closeWindows, css, go, goIndex, options, page, symbolOf, windows } from './api-page-fixtures'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))
afterEach(closeWindows)
// The first test of a cold run compiles the real templates and loads the API models.
vi.setConfig({ testTimeout: 60_000 })

/**
 * A type's member list against the design system (MemberCollection, record 0034).
 */
describe('the member list (MemberCollection, record 0034)', () => {
  it('keeps a long list in the page inside its own scroll box, with the count as muted text', async () => {
    const document = await page(symbolOf(go, 'tmux.Pane'))
    const box = document.querySelector('.api-members .api-member-budget')!
    expect(box, 'Pane has 175 methods').not.toBeNull()
    expect(box.getAttribute('tabindex')).toBe('0')
    expect(box.getAttribute('role')).toBe('region')
    expect(box.getAttribute('aria-label')).toMatch(/^Members of /)
    expect(box.querySelectorAll('li').length).toBeGreaterThan(14)
    expect(document.querySelector('.api-members > h2 .api-section-count')?.textContent).toMatch(/^\d+ members$/)
    // The heading and its count stay outside the box, so they are always in view.
    expect(box.querySelector('h2')).toBeNull()
  }, 60_000)

  it('puts the search and group chips above that box, on every page that draws one', async () => {
    const document = await page(symbolOf(go, 'tmux.Pane'))
    expect(document.querySelector('.api-members > [data-member-tools] [data-member-q]')).not.toBeNull()
    expect([...document.querySelectorAll('.api-members [data-member-groups] button')].map((chip) => chip.childNodes[0]!.textContent!.trim()).slice(0, 2)).toEqual(['All', 'Parent objects'])
    // The product pages draw the same box through the same component.
    for (const file of ['ApiReference', 'ProductApiPage']) {
      const source = readFileSync(new URL(`../src/components/api/${file}.astro`, import.meta.url), 'utf8')
      expect(source, file).toMatch(/<ApiMemberList[^>]*budget=\{/)
      expect(source, `${file} no longer wraps the list in the box itself`).not.toMatch(/<div class="api-member-budget"/)
    }
  }, 60_000)

  it('names a member by its own text colour and shows the kind word only where kinds are mixed', async () => {
    const document = await page(symbolOf(go, 'tmux.Pane'))
    expect(document.querySelector('.api-member-list .api-kind-word'), 'every Pane member is a method, so the mark says it').toBeNull()
    expect(css).toMatch(/\.api-member-link \{[^}]*color: var\(--text-color/)
    expect(css).toMatch(/\.api-member-link:is\(:hover, :focus-visible\) \{[^}]*color: var\(--color-link\)/)
  }, 60_000)

  it('sizes the box by the list budget token, with its fallback named', () => {
    expect(css).toMatch(/\.api-member-budget \{[^}]*max-block-size: var\(--list-budget, 28rem\)[^}]*overflow: auto/)
  })

  it('leaves a short list flat', async () => {
    const small = go.symbols.find((symbol) => symbol.kind === 'struct' && !symbol.parent &&
      go.symbols.filter((member) => member.parent === symbol.id && member.kind === 'method').length >= 2 &&
      go.symbols.filter((member) => member.parent === symbol.id && member.kind === 'method').length <= 8)!
    const document = await page(small)
    expect(document.querySelectorAll('.api-member-list li').length).toBeGreaterThan(0)
    expect(document.querySelector('.api-member-budget')).toBeNull()
  }, 60_000)
})


/**
 * A search field and group chips over the member list (MemberCollection, record 0056): the list is complete without script, and the
 * controls appear with it.
 */
describe('the member search and group filter (MemberCollection, record 0056)', () => {
  const pane = symbolOf(go, 'tmux.Pane')
  const members = go.symbols.filter((symbol) => symbol.parent === pane.id)
  const groupsOf = (list: ApiSymbol[]) => apiMemberGroups(list, memberSignals('go', mentionsData.mentions))
  const searchHref = '/en/go/latest/search/'
  const budget = { region: 'Members of Pane', owner: 'Pane', searchHref }

  const template = loadAstroTemplate('components/api/ApiMemberList.astro', options)
  const commonjs = (source: string) => transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText
  const component = readFileSync(new URL('../src/components/api/ApiMemberList.astro', import.meta.url), 'utf8')
  const script = `var exports = {};\nvar libExports = {};\n(function (exports) {\n${commonjs(readFileSync(new URL('../src/lib/member-filter.ts', import.meta.url), 'utf8'))}\n})(libExports);\nvar require = function (name) { if (/member-filter$/.test(name)) return libExports; throw new Error('unexpected import ' + name) };\n${commonjs(/<script>([\s\S]*?)<\/script>/.exec(component)?.[1] ?? '')}`

  /** The list under the heading the page draws it beneath. */
  async function list(props: Record<string, unknown> = {}, owned = members) {
    const win = new Window({ url: 'https://libtmux.org/en/go/latest/reference/tmux-pane/' })
    windows.push(win)
    const html = await renderAstroTemplate(await template, { props: { groups: groupsOf(owned), showGroups: true, index: goIndex, language: 'go', mixed: false,
      hrefFor: (symbol: ApiSymbol) => `/en/go/latest/reference/${symbol.slug}/`, budget, ...props } })
    win.document.body.innerHTML = `<div class="api-members"><h2 id="api-members">Members<span class="api-section-count">${owned.length} members</span></h2>${withoutScope(html)}</div>`
    return { win, document: win.document as unknown as Document }
  }
  const bind = (win: Window) => win.eval(`(function() {\n${script}\n})()`)
  const type = (win: Window, document: Document, text: string) => {
    const input = document.querySelector<HTMLInputElement>('[data-member-q]')!
    input.value = text
    input.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event)
  }
  const rows = (document: Document) => [...document.querySelectorAll<HTMLElement>('.api-member-list > li')]
  const shown = (document: Document) => rows(document).filter((row) => !row.hidden)
  const chips = (document: Document, group: string) => [...document.querySelectorAll<HTMLButtonElement>(`[data-member-${group}] button`)]
    .map((chip) => [chip.childNodes[0]!.textContent!.trim(), chip.querySelector('span')!.textContent, chip.disabled, chip.getAttribute('aria-pressed')])
  const text = (row: Element) => `${row.querySelector('.api-member-link')!.textContent} ${row.querySelector('.api-member-summary')?.textContent ?? ''}`.toLowerCase()
  const count = (document: Document) => document.querySelector('.api-members > h2 .api-section-count')!.textContent

  it('draws every member without script, with the controls shown only to a page that has script, from its first paint', async () => {
    const { document } = await list()
    expect(rows(document)).toHaveLength(members.length)
    expect(rows(document).filter((row) => row.hidden)).toHaveLength(0)
    const tools = document.querySelector<HTMLElement>('.api-members > [data-member-tools]')!
    expect(css, 'a page without script has no dead controls').toMatch(/\.api-member-tools \{[^}]*display: none/)
    expect(css, 'ThemeScript sets data-js before the first paint, so showing them later shifts nothing').toMatch(/html\[data-js\] \.api-member-tools \{ display: flex; \}/)
    expect(tools.nextElementSibling, 'above the box that scrolls, so it stays in view').toBe(document.querySelector('.api-member-budget'))
    expect(tools.hasAttribute('data-pagefind-ignore'), 'search skips the controls').toBe(true)
  })

  it('offers the search and one chip per tier, counting each tier\'s members, whenever the collection has more than one tier', async () => {
    const { document } = await list()
    expect(document.querySelector('[data-member-q]')!.getAttribute('type')).toBe('search')
    expect(document.querySelector('[data-member-q]')!.closest('label')!.textContent).toContain('Filter members of Pane')
    const tiers = chips(document, 'groups')
    expect(tiers.map(([label]) => label)).toEqual(['All', ...groupsOf(members).map((group) => group.label)])
    expect(tiers.slice(1).map(([, figure]) => Number(figure))).toEqual(groupsOf(members).map((group) => group.members.length))
    expect(tiers[0]![1]).toBe(String(members.length))
    expect(tiers.map(([, , disabled]) => disabled)).not.toContain(true)
    expect(tiers[0]![3], 'All is pressed').toBe('true')
    expect(document.querySelector('[data-member-status]')!.getAttribute('role')).toBe('status')
    expect([...document.querySelectorAll('.api-member-group')].map((group) => group.getAttribute('data-member-group'))).toEqual(groupsOf(members).map((group) => group.id))
  })

  it('offers no group chips for a collection of one tier, and no controls for a list that is not in a box', async () => {
    const one = members.filter((member) => groupsOf(members).find((group) => group.members.includes(member))!.id === groupsOf(members)[0]!.id)
    const single = await list({ groups: groupsOf(one).slice(0, 1), showGroups: false }, one)
    expect(single.document.querySelector('[data-member-groups]')).toBeNull()
    expect(single.document.querySelector('[data-member-q]'), 'the search stays').not.toBeNull()
    const flat = await list({ budget: undefined })
    expect(flat.document.querySelector('[data-member-tools], .api-member-budget')).toBeNull()
    expect(rows(flat.document)).toHaveLength(members.length)
  })

  it('offers kind chips only when the collection mixes kinds (record 0034 stands)', async () => {
    const { document: one } = await list()
    expect(one.querySelector('[data-member-kinds]'), 'every Pane member is a method').toBeNull()
    const mixed = members.map((member, position) => (position % 5 === 0 ? { ...member, kind: 'property' } as ApiSymbol : member))
    const { document } = await list({ mixed: true }, mixed)
    const kinds = chips(document, 'kinds')
    expect(kinds.map(([label]) => String(label)).sort((a, b) => a.localeCompare(b))).toEqual(['All', 'Methods', 'Properties'])
    expect(kinds.slice(1).reduce((sum, [, figure]) => sum + Number(figure), 0)).toBe(members.length)
  })

  it('shows the controls once script runs, and narrows by every word of the query over names and summaries', async () => {
    const { win, document } = await list()
    bind(win)
    const everything = rows(document)
    type(win, document, 'capture')
    const expected = everything.filter((row) => text(row).includes('capture'))
    expect(expected.length, 'Pane has Capture members').toBeGreaterThan(1)
    expect(shown(document)).toEqual(expected)
    expect(count(document)).toBe(`${expected.length} of ${members.length} members`)
    type(win, document, 'capture pane')
    expect(shown(document)).toEqual(everything.filter((row) => ['capture', 'pane'].every((word) => text(row).includes(word))))
    type(win, document, 'capture zzzz')
    expect(shown(document)).toHaveLength(0)
    type(win, document, '')
    expect(shown(document)).toHaveLength(members.length)
    expect(count(document)).toBe(`${members.length} members`)
  })

  it('highlights the matches in a name and a summary, and takes them away with the query', async () => {
    const { win, document } = await list()
    const everythingText = rows(document).map(text)
    bind(win)
    type(win, document, 'capture')
    const marks = [...document.querySelectorAll('.api-member-list mark')]
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) expect(mark.textContent!.toLowerCase()).toBe('capture')
    expect(shown(document).every((row) => row.querySelector('mark'))).toBe(true)
    expect(document.querySelector('.api-member-link mark'), 'the name').not.toBeNull()
    type(win, document, '')
    expect(document.querySelector('.api-member-list mark')).toBeNull()
    expect(rows(document).map(text), 'the text is whole again').toEqual(everythingText)
  })

  it('counts what the search leaves in each group chip, and disables a group with no match', async () => {
    const { win, document } = await list()
    bind(win)
    type(win, document, 'capture')
    const tiers = chips(document, 'groups')
    const left = shown(document)
    expect(Number(tiers[0]![1])).toBe(left.length)
    expect(tiers.slice(1).reduce((sum, [, figure]) => sum + Number(figure), 0)).toBe(left.length)
    for (const [, figure, disabled] of tiers.slice(1)) expect(disabled).toBe(figure === '0')
    expect(tiers.slice(1).some(([, , disabled]) => disabled), 'a tier with no Capture member').toBe(true)
  })

  it('narrows to one tier with its chip, hides the other tiers\' panels, and counts the tier\'s rows', async () => {
    const { win, document } = await list()
    bind(win)
    const chip = document.querySelector<HTMLButtonElement>('[data-member-groups] button[data-v="api-operations"]')!
    chip.click()
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-member-groups] button[data-v=""]')!.getAttribute('aria-pressed')).toBe('false')
    expect(shown(document)).toHaveLength(groupsOf(members).find((group) => group.id === 'api-operations')!.members.length)
    for (const section of document.querySelectorAll<HTMLElement>('.api-member-group')) expect(section.hidden).toBe(section.dataset.memberGroup !== 'api-operations')
    expect(count(document)).toMatch(/^\d+ of \d+ members$/)
  })

  it('says nothing matches, and links to the search of the whole API', async () => {
    const { win, document } = await list()
    bind(win)
    type(win, document, 'zzzz')
    const empty = document.querySelector<HTMLElement>('[data-member-empty]')!
    expect(empty.hidden).toBe(false)
    expect(empty.textContent).toContain('zzzz')
    expect(empty.querySelector('a')!.getAttribute('href')).toBe(searchHref)
    type(win, document, 'capture')
    expect(empty.hidden).toBe(true)
  })
})
