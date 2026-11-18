import { describe, expect, it } from 'vitest'
import {
  countLine,
  filterCount,
  filtersFor,
  nativeSection,
  needsMoreResults,
  orderedSections,
  pageSection,
  parseSearchState,
  readSnapshot,
  ROOT_PORT,
  scopeLabel,
  searchStateQuery,
  withSnapshot,
  type SearchSnapshot,
} from '../src/lib/search-state'

describe('search URL state', () => {
  it('round-trips query, scope, section and kind', () => {
    const state = { q: 'capture pane', scope: 'reference' as const, section: 'reference', kind: 'method' }
    const query = searchStateQuery(state, 'port')
    expect(query).toBe('?q=capture+pane&scope=reference&section=reference&kind=method')
    expect(parseSearchState(query, 'port')).toEqual(state)
  })

  it('leaves the default scope and empty parameters out of the URL', () => {
    expect(searchStateQuery({ q: '', scope: 'port' }, 'port')).toBe('')
    expect(searchStateQuery({ q: 'x', scope: 'all' }, 'all')).toBe('?q=x')
    expect(parseSearchState('?q=x', 'all')).toEqual({ q: 'x', scope: 'all', section: undefined, kind: undefined })
  })

  it('takes the default scope for an unknown one', () => {
    expect(parseSearchState('?q=x&scope=nope', 'port').scope).toBe('port')
    expect(parseSearchState('', 'all')).toEqual({ q: '', scope: 'all', section: undefined, kind: undefined })
  })
})

describe('the section of a page', () => {
  it('is the first path segment after any port and version, as the layout writes it', () => {
    expect(pageSection('guides/capturing-output')).toBe('guides')
    expect(pageSection('reference/tmux-pane-capture')).toBe('reference')
    expect(pageSection('tmux/latest/manual/new-session')).toBe('manual')
    expect(pageSection('')).toBe('home')
  })

  it('places a native Sphinx page by its path in the tree, with the names the Astro pages use', () => {
    expect(nativeSection('api/pane/')).toBe('reference')
    expect(nativeSection('api/testing/')).toBe('reference')
    expect(nativeSection('genindex/')).toBe('reference')
    expect(nativeSection('py-modindex/')).toBe('reference')
    expect(nativeSection('quickstart/')).toBe('guides')
    expect(nativeSection('topics/architecture/')).toBe('topics')
    expect(nativeSection('')).toBe('home')
  })
})

describe('scope and facets as Pagefind filters', () => {
  it('searches the current port and the root pages for the port scope', () => {
    expect(filtersFor({ q: 'x', scope: 'port' }, 'Go')).toEqual({ port: { any: ['Go', ROOT_PORT] } })
    expect(filtersFor({ q: 'x', scope: 'port', section: 'guides' }, 'Go')).toEqual({ port: { any: ['Go', ROOT_PORT] }, section: ['guides'] })
  })

  it('narrows the API scope to reference pages whatever section was asked for', () => {
    expect(filtersFor({ q: 'x', scope: 'reference', section: 'guides', kind: 'method' }, 'Go')).toEqual({
      port: ['Go'],
      section: ['reference'],
      kind: ['method'],
    })
  })

  it('applies the Port facet only under all languages, and ORs several ports', () => {
    expect(filtersFor({ q: 'x', scope: 'all' }, 'Go', ['Go', 'Rust'])).toEqual({ port: { any: ['Go', 'Rust'] } })
    expect(filtersFor({ q: 'x', scope: 'all' }, 'Go', ['Rust'])).toEqual({ port: ['Rust'] })
    expect(filtersFor({ q: 'x', scope: 'all' }, 'Go')).toBeUndefined()
    expect(filtersFor({ q: 'x', scope: 'port' }, 'Go', ['Rust'])).toEqual({ port: { any: ['Go', ROOT_PORT] } })
  })

  it('names the scope and counts the filters a reader can clear', () => {
    expect(scopeLabel('port', 'Go')).toBe('Go docs and API')
    expect(scopeLabel('reference', 'Go')).toBe('Go API only')
    expect(scopeLabel('port', undefined)).toBe('All languages')
    expect(filterCount({ q: '', scope: 'port', section: 'guides', kind: 'method' })).toBe(2)
    expect(filterCount({ q: '', scope: 'reference', section: 'reference' })).toBe(0)
    expect(filterCount({ q: '', scope: 'all' }, ['Go', 'Rust'])).toBe(2)
  })

  it('orders sections as the site does, unknown ones last', () => {
    expect(orderedSections({ topics: 1, mcp: 2, other: 3, guides: 4 }).map(([name]) => name)).toEqual(['guides', 'topics', 'mcp', 'other'])
  })

  it('states the count and how many are showing', () => {
    expect(countLine(145, 16, 'Go docs and API')).toBe('145 results in Go docs and API · showing 16')
    expect(countLine(1, 8, 'Go docs and API')).toBe('1 result in Go docs and API')
  })
})

describe('history.state.libtmuxSearch', () => {
  const snapshot: SearchSnapshot = {
    q: 'capture pane', scope: 'reference', section: undefined, kind: 'method',
    ports: [], shown: 16, selected: 11, scroll: 480, open: true,
  }

  it('restores what was stored, beside the router entry it sits in', () => {
    const stored = withSnapshot({ index: 3, scrollY: 120 }, snapshot)
    expect(stored.index).toBe(3)
    expect(stored.scrollY).toBe(120)
    expect(readSnapshot(stored)).toEqual(snapshot)
  })

  it('reads nothing from a state that has no usable snapshot', () => {
    expect(readSnapshot(null)).toBeNull()
    expect(readSnapshot({ index: 1 })).toBeNull()
    expect(readSnapshot({ libtmuxSearch: { q: 3, scope: 'port' } })).toBeNull()
    expect(readSnapshot({ libtmuxSearch: { q: 'x', scope: 'sideways' } })).toBeNull()
  })

  it('clamps stored numbers so a damaged entry cannot select a row that is not there', () => {
    const read = readSnapshot({ libtmuxSearch: { q: 'x', scope: 'all', shown: -5, selected: 'a', scroll: -9, ports: ['Go', 4] } })
    expect(read).toMatchObject({ shown: 0, selected: -1, scroll: 0, ports: ['Go'], open: false })
  })

  it('needs extra pages only when the reader had opened more than the first', () => {
    expect(needsMoreResults({ shown: 16 }, 8)).toBe(true)
    expect(needsMoreResults({ shown: 8 }, 8)).toBe(false)
  })
})
