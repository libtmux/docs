// Outer: reads the generated catalog and compiles production Astro components.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'
import { SymbolIndex } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { apiGlossary, apiGlossaryHref, apiGlossaryMarkdown } from '../src/lib/api-glossary'
import { referenceTree, apiTreeVersion } from '../src/lib/api-tree'
import { searchApi } from '../src/lib/api-search'
import { sidebarCatalog, sidebarNodes, type SidebarNode } from '../src/lib/api-sidebar'
import { symbolPreview } from '../src/lib/link-preview'
import { nativeQualifiedName, nativeShortName } from '../src/lib/native-name'
import { writtenForm } from '../src/lib/symbol-form'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))

const model = API_MODELS.haskell
const index = new SymbolIndex(model.symbols, (symbol) => `/en/haskell/latest/reference/${symbol.slug}/`, 'haskell')
const glossaryPath = '/en/haskell/latest/reference/glossary/'
const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })
const named = (name: string) => model.symbols.find((symbol) => symbol.name === name)!

describe('Haskell reference semantics', () => {
  it('preserves distinct kinds in previews and the searchable tree without changing source identities', () => {
    const kinds = model.symbols.map((symbol) => symbolPreview(model, symbol, 'latest').kind)
    expect(Object.fromEntries([...Map.groupBy(kinds, (kind) => kind)].map(([kind, values]) => [kind, values.length])))
      .toEqual({ module: 16, 'data-type': 55, 'data-constructor': 58, 'record-field': 75, function: 167 })
    const records = searchApi(referenceTree('haskell'), '')
    expect(new Set(records.map((entry) => entry.id))).toEqual(new Set(model.symbols.map((symbol) => symbol.id)))
    for (const entry of records) {
      const symbol = model.symbols.find((symbol) => symbol.id === entry.id)!
      expect(symbol, entry.id).toBeDefined()
      expect(entry.kind, entry.id).toBe(symbolPreview(model, symbol, 'latest').kind)
      expect(entry.category).toBe(['typealias', 'module'].includes(symbol.kind) ? 'types' : 'members')
    }
  })

  it('keeps short names bare and full names module-qualified even when a type documents the value', () => {
    for (const symbol of model.symbols) {
      expect(nativeShortName(model, symbol), symbol.id).toBe(symbol.name)
      const expected = symbol.kind === 'module' ? symbol.name : `${symbol.namespace}.${symbol.name}`
      expect(nativeQualifiedName(model, symbol), symbol.id).toBe(expected)
    }
    for (const name of ['InvalidId', 'expectedPrefix', 'parsePaneId']) {
      expect(writtenForm({ lang: 'haskell', kind: name === 'expectedPrefix' ? 'property' : 'function', label: `${name}()`, symbol: named(name) }))
        .toBe(name)
    }
  })

  it('authors contextual definitions for abstract types, constructors and non-selector field labels', () => {
    const terms = apiGlossary(glossaryPath).groups.flatMap((group) => group.terms)
    for (const id of ['module', 'data-type', 'data-constructor', 'record-field', 'function', 'opaque', 'package']) {
      expect(apiGlossaryHref(id, glossaryPath), id).toBe(`${glossaryPath}#${id}`)
    }
    expect(terms.find((term) => term.id === 'record-field')!.detail).toContain('NoFieldSelectors')
    expect(terms.find((term) => term.id === 'opaque')!.detail).toContain('constructors')
    expect(apiGlossaryMarkdown('https://libtmux.org', glossaryPath)).toContain('### data type')
    expect(apiGlossaryHref('data-constructor', '/en/java/latest/reference/glossary/')).toBeUndefined()
  })

  it('uses native kind words in Markdown twins', async () => {
    for (const [name, kind] of [['PaneId', 'data type'], ['InvalidId', 'data constructor'], ['input', 'record field'], ['parsePaneId', 'function']]) {
      const markdown = await symbolMarkdownWithLayout({ model, index, symbol: named(name) })
      expect(markdown, name).toContain(`- **Kind:** ${kind}`)
    }
  })

  it('renders native marks, existing palettes and accessible glossary links in the production badge', async () => {
    const template = await loadAstroTemplate('components/api/ApiBadge.astro')
    for (const [kind, word, mark, palette] of [['data-type', 'data type', 'T', 'typealias'],
      ['data-constructor', 'data constructor', 'c', 'function'], ['record-field', 'record field', 'r', 'property']]) {
      const win = new Window()
      windows.push(win)
      win.document.body.innerHTML = await renderAstroTemplate(template, {
        url: `https://libtmux.org${glossaryPath}`, props: { label: kind, value: kind, variant: 'kind' },
      })
      const badge = win.document.querySelector('a.api-leg')!
      expect(badge?.getAttribute('href'), kind).toBe(`${glossaryPath}#${kind}`)
      expect(badge.classList.contains(`api-badge--kind-${palette}`)).toBe(true)
      expect(badge.querySelector('.api-leg__g')!.textContent).toBe(mark)
      expect(badge.querySelector('.api-badge__label')!.textContent).toBe(word)
      expect(badge.getAttribute('aria-label')).toContain(word)
    }
    const treeTemplate = await loadAstroTemplate('components/api/ApiTreeItems.astro', {
      real: ['components/api/ApiBadge.astro', 'components/api/SymbolName.astro'],
    })
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = await renderAstroTemplate(treeTemplate, {
      url: `https://libtmux.org${glossaryPath}`, props: {
        nodes: sidebarNodes(referenceTree('haskell'), '/en/haskell/latest/reference/', 'focus', named('IdError').id),
      },
    })
    for (const [kind, word, mark, palette] of [['data-type', 'data type', 'T', 'typealias'],
      ['data-constructor', 'data constructor', 'c', 'function'], ['record-field', 'record field', 'r', 'property']]) {
      const row = win.document.querySelector(`[data-api-kind="${kind}"]`)!
      expect(row?.getAttribute('aria-description'), kind).toBe(word)
      expect(row.querySelector(`.api-badge--kind-${palette} .api-badge__label`)?.textContent).toBe(mark)
    }
  })

  it('renders bare declaration headings and module-qualified names in the production page', async () => {
    const template = await loadAstroTemplate('components/api/ApiReference.astro', {
      real: ['components/api/SymbolName.astro', 'components/api/ApiBadge.astro', 'components/api/ApiQualifiedName.astro'],
      modules: {
        'astro-expressive-code/components': { Code: () => '' },
        '../../lib/page-ports-for': { pagePortsFor: async () => [] },
        '../../lib/sidebar': { pageBreadcrumbs: async () => [] },
      },
    })
    for (const name of ['InvalidId', 'expectedPrefix']) {
      const win = new Window()
      windows.push(win)
      win.document.body.innerHTML = await renderAstroTemplate(template, {
        url: `https://libtmux.org/en/haskell/latest/reference/${named(name).slug}/`,
        props: { model, owner: named(name) },
      })
      expect(win.document.querySelector('h1')?.textContent?.trim()).toBe(name)
      expect(win.document.querySelector('.api-qualified-name code')?.textContent).toBe(`LibTmux.Id.${name}`)
      expect(win.document.querySelector('[data-pagefind-meta^="kind:"]')?.getAttribute('data-pagefind-meta'))
        .toBe(`kind:${name === 'InvalidId' ? 'data-constructor' : 'record-field'}`)
    }
  })

  it('keeps native declaration words in the extracted member-list component', async () => {
    const template = await loadAstroTemplate('components/api/ApiReference.astro', {
      real: ['components/api/ApiMemberList.astro', 'components/api/ApiBadge.astro'],
      modules: {
        'astro-expressive-code/components': { Code: () => '' },
        '../../lib/page-ports-for': { pagePortsFor: async () => [] },
        '../../lib/sidebar': { pageBreadcrumbs: async () => [] },
      },
    })
    const win = new Window()
    windows.push(win)
    win.document.body.innerHTML = await renderAstroTemplate(template, {
      url: `https://libtmux.org/en/haskell/latest/reference/${named('IdError').slug}/`,
      props: { model, owner: named('IdError') },
    })
    const row = [...win.document.querySelectorAll('.api-member-list li')]
      .find((entry) => entry.querySelector('.api-member-link')?.textContent === 'InvalidId')
    expect(row, 'IdError lists its data constructor').toBeDefined()
    expect(row!.querySelector('.api-member-badges')?.textContent).toContain('data constructor')
  })

  it('invalidates saved Haskell presentation while retaining the existing version for other ports', () => {
    expect(apiTreeVersion(model, [])).toMatch(/^3:/)
    expect(apiTreeVersion(API_MODELS.java, [])).toMatch(/^2:/)
  })

  it('marks one canonical row while retaining module ownership for Focus and Up', () => {
    const inventory = referenceTree('haskell')
    const rows = (nodes: SidebarNode[]): SidebarNode[] => nodes.flatMap((node) => [node, ...rows(node.children ?? [])])
    for (const symbol of model.symbols) for (const mode of ['outline', 'focus', 'grouped'] as const) {
      const current = rows(sidebarNodes(inventory, '/en/haskell/latest/reference/', mode, symbol.id)).filter((node) => node.current)
      expect(current.map((node) => node.href), `${mode}:${symbol.id}`).toEqual([`/en/haskell/latest/reference/${symbol.slug}/`])
    }
    const catalog = sidebarCatalog(inventory)
    const module = named('LibTmux.Id')
    for (const name of ['parsePaneId', 'PaneId']) expect(catalog.parent.get(named(name).id), name).toBe(module.id)
    expect(new Set(catalog.membersOf(module.id).map((entry) => entry.id))).toEqual(new Set(model.symbols.filter((entry) => entry.parent === module.id).map((entry) => entry.id)))
    const focused = sidebarNodes(inventory, '/en/haskell/latest/reference/', 'focus', named('parsePaneId').id)
    expect(focused[0]!.href).toBe(`/en/haskell/latest/reference/${module.slug}/`)
    expect(focused.map((entry) => entry.label)).toContain('PaneId')
    expect(sidebarNodes(inventory, '/en/haskell/latest/reference/', 'focus', module.id)).toHaveLength(catalog.membersOf(module.id).length + 1)
  })
})
