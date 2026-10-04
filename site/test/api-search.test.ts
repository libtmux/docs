import { describe, expect, it } from 'vitest'
import { API_MODELS, OWNER_KINDS } from '../src/lib/api-models'
import { searchApi } from '../src/lib/api-search'
import { referenceTree } from '../src/lib/api-tree'
import { API_MODEL_PORTS } from '../src/lib/ports'

describe('reference symbol search', () => {
  it('finds Java source-qualified names while retaining stable result identities and URLs', () => {
    const tree = referenceTree('java')
    for (const [query, id, slug] of [
      ['io.github.libtmux.Server', 'io.github.libtmux.Server.Server', 'io-github-libtmux-server-server'],
      [
        'io.github.libtmux.Server.Builder',
        'io.github.libtmux.Server.Server.Builder',
        'io-github-libtmux-server-server-builder-dv7l',
      ],
      [
        'io.github.libtmux.Server.sessions',
        'io.github.libtmux.Server.Server.sessions',
        'io-github-libtmux-server-server-sessions',
      ],
    ]) {
      expect(searchApi(tree, query)[0]).toMatchObject({ id, qualifiedName: query, slug })
      expect(searchApi(tree, id)[0].id).toBe(id)
    }
  })
  it.each(['Server.panes', 'Server panes'])('finds an owner and member from %s', (query) => {
    const found = searchApi(referenceTree('ts'), query)
    expect(found[0].id).toBe('server.Server.panes')
  })

  it.each(['new session', 'newSession', 'newsession'])('finds a creation method from %s', (query) => {
    const found = searchApi(referenceTree('ts'), query)
    expect(found[0].id).toBe('server.Server.newSession')
  })

  it('distinguishes Scala variants and ranks qualified matches first', () => {
    const found = searchApi(referenceTree('scala'), 'cats.Server.panes')
    expect(found[0].id).toMatch(/\.cats\.Server\.panes$/)
    expect(found[0].category).toBe('members')
  })

  it('uses core APIs before builders for a broad query', () => {
    const found = searchApi(referenceTree('kotlin'), 'session').map((symbol) => symbol.id)
    const position = (suffix: string) => found.findIndex((id) => id.endsWith(suffix))
    expect(position('.Session')).toBeGreaterThanOrEqual(0)
    expect(position('.Session')).toBeLessThan(position('.SessionBuilder'))
    expect(position('.Server.sessions')).toBeLessThan(position('.SessionBuilder'))
  })

  it('keeps Swift listings ahead of operators for an owner query', () => {
    const inventory = referenceTree('swift')
    const found = searchApi(inventory, 'Server').map((symbol) => symbol.id)
    expect(found.indexOf('Server.sessions()')).toBeGreaterThanOrEqual(0)
    expect(found.indexOf('Server.sessions()')).toBeLessThan(found.indexOf('Server.==(_:_:)'))
    expect(searchApi(inventory, 'Server.==(_:_:)')[0].id).toBe('Server.==(_:_:)')
    expect(searchApi(inventory, '==').every((symbol) => symbol.name.includes('=='))).toBe(true)
  })

  it.each(API_MODEL_PORTS.map((port) => port.slug))('retains %s native kinds and searchable identities', (port) => {
    const inventory = referenceTree(port)
    const symbols = new Map(
      API_MODELS[port].symbols.flatMap(
        (symbol) =>
          [
            [symbol.id, symbol],
            [symbol.publicId ?? symbol.id, symbol],
          ] as const,
      ),
    )
    const results = searchApi(inventory, '')
    expect(results.length).toBeGreaterThan(0)
    expect(new Set(results.map((entry) => entry.id)).size).toBe(results.length)
    for (const result of results) {
      const symbol = symbols.get(result.id)
      expect(symbol, result.id).toBeDefined()
      expect(result.kind, result.id).toBe(symbol!.kind)
      expect(result.category, result.id).toBe(OWNER_KINDS.has(symbol!.kind) ? 'types' : 'members')
    }
    expect(searchApi(inventory, '', 'types').every((entry) => entry.category === 'types')).toBe(true)
    expect(searchApi(inventory, '', 'members').every((entry) => entry.category === 'members')).toBe(true)
    const server = searchApi(inventory, 'Server')[0]
    expect(server.category, `${port}: Server type precedes properties with the same name`).toBe('types')
    expect(symbols.get(server.id)?.name).toBe('Server')
  })
})
