import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONCEPTS, type ApiSymbol } from '@libtmux/api-model/reference'
import { API_MODELS, referenceAlternatives } from '../src/lib/api-models'
import { equivalentsFor, genericAbsenceSentence, unmappedSentence, type EquivalentsGroup } from '../src/lib/api-equivalents'
import { pagePortLinks } from '../src/lib/page-port-links'
import { loadAstroTemplate, withoutScope } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))

const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

const symbolOf = (port: string, id: string): ApiSymbol => API_MODELS[port].symbols.find((entry) => (entry.publicId ?? entry.id) === id)!
const capture = symbolOf('go', 'tmux.Pane.Capture')
const group = (port: string, symbol: ApiSymbol, label: string): EquivalentsGroup => equivalentsFor(port, symbol).find((entry) => entry.label === label)!
const rowOf = (g: EquivalentsGroup, port: string) => g.rows.find((row) => row.port === port)!

describe('the equivalents of Pane.Capture', () => {
  const g = group('go', capture, CONCEPTS['capture-pane'].label)

  it('lead with the page\'s own row, then every mapped port', () => {
    expect(g.rows[0]).toMatchObject({ port: 'go', current: true, chips: [] })
    expect(g.rows.slice(1).map((row) => row.port)).toEqual(expect.arrayContaining(['py', 'rs', 'swift', 'erlang', 'cxx', 'java']))
    expect(g.mappedCount).toBe(g.rows.length - 1)
  })

  it('carry the difference chips the model records, relative to Go', () => {
    expect(rowOf(g, 'rs').chips).toEqual(['async'])
    expect(rowOf(g, 'csharp').chips).toEqual(['async'])
    expect(rowOf(g, 'swift').chips).toEqual(['async', 'on Server'])
    expect(rowOf(g, 'erlang').chips).toEqual(['free function'])
    expect(rowOf(g, 'ocaml').chips).toEqual(['free function'])
    expect(rowOf(g, 'clojure').chips).toEqual(['free function', '2 overloads'])
    expect(rowOf(g, 'cxx').chips).toEqual(['2 overloads', 'readonly'])
    expect(rowOf(g, 'java').chips).toEqual(['3 overloads'])
    expect(rowOf(g, 'perl').chips).toEqual(['on Server'])
    expect(rowOf(g, 'perl').note).toBe(CONCEPTS['capture-pane'].notes!.perl)
    // The same method name and owner in another port adds nothing.
    expect(rowOf(g, 'ts').chips).toEqual([])
    expect(rowOf(g, 'ruby').chips).toEqual([])
  })

  it('name a recorded absence apart from a port the concept table says nothing about', () => {
    expect(g.absent.map((row) => row.port)).toEqual(['haskell'])
    expect(g.absent[0].reason).toBe(CONCEPTS['capture-pane'].absent!.haskell)
    expect(g.genericAbsent).toEqual(['PowerShell', 'Julia', 'Elixir', 'Common Lisp'])
    expect(genericAbsenceSentence(g.genericAbsent)).toBe('No equivalent is recorded in PowerShell, Julia, Elixir or Common Lisp.')
    // Unmapped is a different statement from absent: the sentence says the data is silent.
    expect(unmappedSentence(['Perl', 'Raku'])).toBe('Perl and Raku. Unmapped is not evidence of absence.')
    expect(unmappedSentence([])).toBeNull()
  })
})

describe('a concept that records nothing for some ports', () => {
  // The concept table gives every current port a symbol or a reason; a port added later starts with neither.
  const alternatives = referenceAlternatives('go', 'tmux.Pane.Capture').map((entry) => ({
    ...entry,
    ports: entry.ports.map((port) => port.port === 'raku' || port.port === 'haskell' ? { ...port, publicId: undefined, href: undefined, kind: undefined, absent: undefined } : port),
  })) as unknown as ReturnType<typeof referenceAlternatives>

  it('lists them as unmapped, never as absent', () => {
    const [entry] = equivalentsFor('go', capture, alternatives)
    expect(entry.unmapped).toEqual(['Haskell', 'Raku'])
    expect(entry.rows.some((row) => ['haskell', 'raku'].includes(row.port))).toBe(false)
    expect(entry.absent).toEqual([])
    expect(entry.genericAbsent).not.toContain('Haskell')
    expect(unmappedSentence(entry.unmapped)).toBe('Haskell and Raku. Unmapped is not evidence of absence.')
  })
})

describe('equivalence is never inferred from spelling', () => {
  it('gives a declaration no concept names no rows, however its name reads', () => {
    // `Window.Capture` would look like a sibling of `Pane.Capture`; only the concept table creates a row.
    const unnamed = API_MODELS.go.symbols.find((symbol) => symbol.name === 'CaptureBytes' && !equivalentsFor('go', symbol).length)
    expect(unnamed).toBeDefined()
    expect(equivalentsFor('go', unnamed!)).toEqual([])
  })
})

describe('the header picker', () => {
  it('links exactly the mapped rows of the table and no absent or unmapped port', () => {
    const links = pagePortLinks({ pagePath: 'reference/tmux-pane-capture', portSlug: 'go', version: 'latest', defaults: {}, docs: [] })
    const linked = links.filter((entry) => entry.links.length).map((entry) => entry.port).sort()
    const g = group('go', capture, CONCEPTS['capture-pane'].label)
    expect(linked).toEqual(g.rows.filter((row) => row.status === 'mapped').map((row) => row.port).sort())
    for (const row of g.absent) expect(links.find((entry) => entry.port === row.port)!.links).toEqual([])
  })
})

describe('the rendered table', () => {
  async function render(groups: EquivalentsGroup[], port: string) {
    const template = await loadAstroTemplate('components/api/EquivalentsTable.astro', { real: ['components/api/ApiBadge.astro', 'components/api/ApiDoc.astro', 'components/api/SymbolName.astro', 'components/api/RelationshipCollection.astro'] })
    const container = await experimental_AstroContainer.create({ astroConfig: { site: 'https://libtmux.org' } } as never)
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = withoutScope(await container.renderToString(template as never, {
      request: new Request('https://libtmux.org/en/go/latest/reference/tmux-pane-capture/'), props: { groups, port, id: 'api-other-ports' },
    }))
    return win.document
  }

  it('draws Port, API and Differs columns with the current row marked', async () => {
    const document = await render(equivalentsFor('go', capture), 'go')
    expect([...document.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['Port', 'API', 'Differs from Go'])
    const current = document.querySelector('tbody tr[aria-current]')!
    expect(current.querySelector('th')!.textContent).toBe('Go')
    expect(current.textContent).toContain('This page')
    // The page's own name is a chip like the others, and says where the reader is.
    expect(current.querySelector('td a')!.getAttribute('aria-current')).toBe('page')
    const swift = document.querySelector('tr[data-port="swift"]')!
    expect([...swift.querySelectorAll('.api-eq-diff')].map((chip) => chip.textContent)).toEqual(['async', 'on Server'])
    expect(swift.querySelector('td a')!.getAttribute('href')).toContain('/swift/')
    // A mapped port with nothing recorded says so, in words.
    expect(document.querySelector('tr[data-port="ts"]')!.textContent).toContain('None recorded in the model')
    expect(document.querySelector('.api-collection__count')!.textContent).toBe('17 other ports mapped')
  })

  it('names the recorded absence as a block and the generic reasons as one sentence', async () => {
    const document = await render(equivalentsFor('go', capture), 'go')
    expect(document.querySelector('.api-eq-state strong')!.textContent).toBe('No Haskell equivalent.')
    expect([...document.querySelectorAll('.api-eq-line')].map((line) => line.textContent)).toEqual(['No equivalent is recorded in PowerShell, Julia, Elixir or Common Lisp.'])
  })

  it('offers "Only with differences" once the table is long, and the filter stays hidden until script runs', async () => {
    const document = await render(equivalentsFor('go', capture), 'go')
    const bar = document.querySelector('[data-eq-filter]')!
    expect(bar.hasAttribute('hidden')).toBe(true)
    expect([...bar.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['All mapped', 'Only with differences'])
    // Rows that differ carry the attribute the filter reads; the current row is kept by its own marker.
    const differing = [...document.querySelectorAll('tbody tr[data-differs]')].map((row) => row.getAttribute('data-port'))
    expect(differing).toEqual(expect.arrayContaining(['rs', 'swift', 'perl']))
    expect(differing).not.toContain('ts')
    // A short table has no filter.
    const short = equivalentsFor('go', capture).map((entry) => ({ ...entry, rows: entry.rows.slice(0, 4) }))
    expect((await render(short, 'go')).querySelector('[data-eq-filter]')).toBeNull()
  })
})
