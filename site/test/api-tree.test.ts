import { describe, expect, it } from 'vitest'
import { API_NAV, OWNER_KINDS } from '../src/lib/api-models'
import { navTree } from '../src/lib/api-tree'

const PRIMARY_OBJECT_BUCKETS = new Set(['server', 'session', 'window', 'pane', 'client'])

const segments = (id: string) => id.split(/::|[.:/]/).filter(Boolean)

describe('Lua API sidebar', () => {
  it('files exported Server under its public tmux domain', () => {
    const tree = navTree('lua')
    const server = tree.find((bucket) => bucket.id === 'server')
    const internal = tree.find((bucket) => bucket.id === 'internal')

    expect(server).toBeDefined()
    expect(server!.entries.map((entry) => entry.id)).toContain('libtmux.Server')
    expect(internal?.entries.some((entry) => entry.id === 'libtmux.Server') ?? false).toBe(false)
  })

  it('puts the public Server object before its supporting types', () => {
    const server = navTree('lua').find((bucket) => bucket.id === 'server')

    expect(server?.entries.map((entry) => entry.id)).toEqual([
      'libtmux.Server',
      'libtmux.Fields.Server',
      'libtmux.CommandOutcome',
    ])
  })
})

describe('major tmux object domains', () => {
  it('puts a domain’s shallowest primary object first across ports', () => {
    for (const port of Object.keys(API_NAV)) {
      for (const bucket of navTree(port).filter((candidate) => PRIMARY_OBJECT_BUCKETS.has(candidate.id))) {
        const primary = bucket.entries
          .filter((entry) => OWNER_KINDS.has(entry.kind) && segments(entry.id).at(-1)?.toLowerCase() === bucket.label.toLowerCase())
          .toSorted((left, right) => segments(left.id).length - segments(right.id).length)[0]

        if (primary) expect(bucket.entries[0]?.id, `${port}:${bucket.id}`).toBe(primary.id)
      }
    }
  })
})
