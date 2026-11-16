import { afterEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'
import { PORT_BY_SLUG, portPageUrl, referenceUrl } from '../src/lib/ports'
import {
  OTHER_LETTER,
  countStatus,
  firstLetter,
  groupByLetter,
  groupRepeats,
  isSpecialName,
  kindCounts,
  letterLabel,
  letterOf,
  sortEntries,
  summaryLine,
  type IndexEntry,
} from '../src/lib/symbol-index'

vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))

const entry = (name: string, port = 'go', over: Partial<IndexEntry> = {}): IndexEntry => ({ port, name, id: `${port}.${name}`, kind: 'method', ...over })

describe('letter grouping', () => {
  it('files a name under its first letter, skipping leading underscores and tildes', () => {
    expect(letterOf('capture')).toBe('C')
    expect(letterOf('__call__')).toBe('C')
    expect(letterOf('_clauses')).toBe('C')
    expect(letterOf('~CommandExecutor')).toBe('C')
    expect(letterOf('2D')).toBe(OTHER_LETTER)
    expect(letterOf('___')).toBe(OTHER_LETTER)
    expect(letterLabel(OTHER_LETTER)).toBe('#')
  })

  it('puts the same name in different cases together, public names before special ones', () => {
    const sorted = sortEntries([entry('_clauses'), entry('Capture', 'rs'), entry('capture'), entry('Capacity'), entry('~CommandExecutor'), entry('capture', 'py')])
    expect(sorted.map((e) => `${e.name}:${e.port}`)).toEqual([
      'Capacity:go', 'capture:go', 'capture:py', 'Capture:rs', '_clauses:go', '~CommandExecutor:go',
    ].map((value) => value))
    expect(isSpecialName('__call__')).toBe(true)
    expect(isSpecialName('Capture')).toBe(false)
  })

  it('groups by letter with the other bucket last and every entry in exactly one group', () => {
    const entries = [entry('zip'), entry('Alpha'), entry('9lives'), entry('_beta'), entry('alpine')]
    const groups = groupByLetter(entries)
    expect(groups.map((g) => g.letter)).toEqual(['A', 'B', 'Z', OTHER_LETTER])
    expect(groups.flatMap((g) => g.entries)).toHaveLength(entries.length)
    expect(groups[0]!.entries.map((e) => e.name)).toEqual(['alpine', 'Alpha'].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })))
  })
})

describe('repeated names', () => {
  it('folds names declared by three or more owners into one row with an owner count', () => {
    const entries = [entry('Name', 'go', { owner: 'A' }), entry('String', 'go', { owner: 'A' }), entry('String', 'go', { owner: 'B' }), entry('String', 'go', { owner: 'C' }), entry('Valid', 'go', { owner: 'A' }), entry('Valid', 'go', { owner: 'B' })]
    const rows = groupRepeats(entries)
    expect(rows.map((row) => (row.type === 'group' ? `${row.name}×${row.entries.length}` : row.entry.name))).toEqual(['Name', 'String×3', 'Valid', 'Valid'])
  })
})

describe('counts', () => {
  it('lists the kinds present, most common first, and states both numbers when filtered', () => {
    expect(kindCounts([entry('a'), entry('b', 'go', { kind: 'struct' }), entry('c')])).toEqual([['method', 2], ['struct', 1]])
    expect(countStatus(12, 176)).toBe('12 of 176 symbols')
    expect(countStatus(176, 176)).toBe('176 symbols')
    expect(countStatus(1, 1)).toBe('1 symbol')
  })
})

describe('the index front link', () => {
  it('opens the first letter that has names, leaving # for ports with nothing else', () => {
    expect(firstLetter(['capture', 'Attach', '_hidden'])).toBe('A')
    expect(firstLetter(['_x', 'zed'])).toBe('X')
    expect(firstLetter(['9a', '___'])).toBe(OTHER_LETTER)
  })
})

describe('row summaries', () => {
  it('keeps one plain line, empty when the source has no summary', () => {
    expect(summaryLine('Reads `what` a **pane**\n  shows.')).toBe('Reads what a pane shows.')
    expect(summaryLine(undefined)).toBeUndefined()
    expect(summaryLine('   ')).toBeUndefined()
    expect(summaryLine('x'.repeat(200))).toHaveLength(160)
  })
})

describe('the A-Z page of a port build', () => {
  afterEach(() => vi.unstubAllEnvs())

  // check-canonicals walks every page under a port's reference tree and wants
  // its canonical to name that page. The page reaches Seo through BaseLayout,
  // so a port build must hand the layout its port and version.
  it('gives the layout the port and version, and keeps the page out of the inventory', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
    const page = await loadAstroTemplate('pages/reference/symbols/[letter].astro', {
      stubs: {
        'layouts/BaseLayout.astro': '---\nconst { portSlug, version, inventoryExclude } = Astro.props\n---\n<main data-port={portSlug} data-version={version} data-exclude={String(inventoryExclude)}><slot /></main>',
        'components/api/SymbolIndex.astro': '---\n---\n<div></div>',
      },
      modules: { '../../../i18n/resolve': { buildLocale: () => 'en' } },
    })
    const html = await renderAstroTemplate(page, { url: 'https://libtmux.org/en/go/latest/reference/symbols/c/', props: {
      letter: 'C', letters: ['C'], entries: [], total: 0, shared: [], port: 'go',
    } })
    expect(html).toContain('data-port="go"')
    expect(html).toContain('data-version="latest"')
    expect(html).toContain('data-exclude="true"')
  })

  // A port's A-Z page is a page of the port's core reference (record 0021): four levels in the breadcrumb, the sidebar's head
  // above the column, and the way up at the end. The tree beside it is the reference's, so it is stubbed to say what it was given.
  it('names Core Library in the breadcrumb, heads the column with the way up and ends on the ladder', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', 'go')
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
    const page = await loadAstroTemplate('pages/reference/symbols/[letter].astro', {
      real: ['components/api/SymbolIndex.astro', 'components/api/ApiBadge.astro', 'components/PageToolbar.astro', 'components/docs/PageEnd.astro'],
      stubs: {
        'layouts/BaseLayout.astro': '<slot name="context" /><slot />',
        'components/api/ApiTree.astro': '---\nconst { head } = Astro.props\n---\n<aside data-tree><a data-up href={head?.up.href}>{head?.up.label}</a><a data-title href={head?.title.href}>{head?.title.label}</a></aside>',
      },
      modules: { '../../../i18n/resolve': { buildLocale: () => 'en' } },
    })
    const go = PORT_BY_SLUG.go!
    const [home, core, reference] = [portPageUrl(go, 'latest'), portPageUrl(go, 'latest', 'core'), referenceUrl(go, 'latest')]
    const window = new Window()
    window.document.body.innerHTML = await renderAstroTemplate(page, { url: `https://libtmux.org${reference}symbols/c/`, props: {
      letter: 'C', letters: ['C'], entries: [entry('Capture')], total: 1, shared: [], port: 'go',
    } })
    const document = window.document
    const trail = [...document.querySelectorAll('nav[aria-label="Breadcrumb"] [data-breadcrumb-item]')]
    expect(trail.map((item) => item.textContent?.trim())).toEqual(['Go', 'Core Library', 'API reference', 'Symbols: C'])
    expect(trail.map((item) => item.getAttribute('href'))).toEqual([home, core, reference, null])
    expect(document.querySelector('[data-up]')?.textContent).toBe('Core Library')
    expect(document.querySelector('[data-up]')?.getAttribute('href')).toBe(core)
    expect(document.querySelector('[data-title]')?.textContent).toBe('API reference')
    const up = [...document.querySelectorAll('nav.page-end [data-page-end-up] a')]
    expect(up.map((link) => link.textContent?.trim())).toEqual(['API reference', 'Core Library', 'Go'])
    expect(up.map((link) => link.getAttribute('href'))).toEqual([reference, core, home])
    // One main landmark, and the list is in the column the tree sits beside.
    expect(document.querySelectorAll('main')).toHaveLength(1)
    expect(document.querySelector('main .api-reference-content [data-symidx]')).not.toBeNull()
  })

  // The shared shell build runs with LIBTMUX_DOCS_PORT set to the empty
  // string. A port of '' must reach the layout as no port at all: its
  // inventory scope falls back with `??`, and an empty scope fails the build.
  it('gives the layout no port when the build names the empty port', async () => {
    vi.stubEnv('LIBTMUX_DOCS_PORT', '')
    vi.stubEnv('LIBTMUX_DOCS_LOCALE', 'en')
    vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
    const page = await loadAstroTemplate('pages/reference/symbols/[letter].astro', {
      stubs: {
        'layouts/BaseLayout.astro': '---\nconst { portSlug, version, inventoryExclude } = Astro.props\n---\n<main data-port={JSON.stringify(portSlug ?? null)} data-version={JSON.stringify(version ?? null)} data-exclude={String(inventoryExclude)}><slot /></main>',
        'components/api/SymbolIndex.astro': '---\n---\n<div></div>',
      },
      modules: { '../../../i18n/resolve': { buildLocale: () => 'en' } },
    })
    const html = await renderAstroTemplate(page, { url: 'https://libtmux.org/en/reference/symbols/c/', props: {
      letter: 'C', letters: ['C'], entries: [], total: 0, shared: [], port: '',
    } })
    expect(html).toContain('data-port="null"')
    expect(html).toContain('data-version="null"')
    expect(html).toContain('data-exclude="false"')
    // The cross-port page is a root page: no port ladder to end on.
    expect(html).not.toContain('page-end')
  })
})
