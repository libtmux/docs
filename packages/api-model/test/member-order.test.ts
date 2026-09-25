import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONCEPTS } from '../src/concepts.ts'
import { compareMembers, memberSignals, memberTier, type MemberSignals } from '../src/member-order.ts'
import type { ApiModel, ApiSymbol } from '../src/model.ts'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '../../../site/src/data')
const PORTS = ['py', 'ruby', 'lua', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'] as const
const LISTINGS = ['list-sessions', 'list-windows', 'list-panes']
const TOP = 3
const available = existsSync(join(DATA, 'api/py.json'))
const d = available ? describe : describe.skip

type Compare = (signals: MemberSignals) => (a: ApiSymbol, b: ApiSymbol) => number

const models = new Map<string, ApiModel>()
const model = (port: string) => {
  if (!models.has(port)) models.set(port, JSON.parse(readFileSync(join(DATA, `api/${port}.json`), 'utf8')) as ApiModel)
  return models.get(port)!
}
const alphabetical: Compare = () => (a, b) => a.name.localeCompare(b.name)

/**
 * What a member order must get right on every port, as named failures.
 *
 * Returned rather than asserted so the same function runs against the real
 * comparator and against plain alphabetical order: a property that the old
 * order also satisfied would prove nothing about the new one.
 */
function violations(compare: Compare): string[] {
  const mentions = JSON.parse(readFileSync(join(DATA, 'mentions.json'), 'utf8')).mentions
  const found: string[] = []
  for (const port of PORTS) {
    const { symbols } = model(port)
    const signals = memberSignals(port, mentions)
    const cmp = compare(signals)
    const children = new Map<string, ApiSymbol[]>()
    for (const s of symbols) if (s.parent) children.set(s.parent, [...(children.get(s.parent) ?? []), s])
    const byId = new Map(symbols.map((s) => [s.publicId ?? s.id, s]))

    for (const concept of LISTINGS) {
      const listing = byId.get(CONCEPTS[concept]!.symbols[port] ?? '')
      if (!listing?.parent) continue
      const rank = [...children.get(listing.parent)!].sort(cmp).indexOf(listing)
      if (rank >= TOP) found.push(`${port}: ${concept} is #${rank + 1} on ${listing.parent}`)
    }
    for (const [owner, members] of children) {
      const sorted = [...members].sort(cmp)
      const firstHidden = sorted.findIndex((s) => ['private', 'special'].includes(memberTier(s, signals)))
      const lastShown = sorted.findLastIndex((s) => !['private', 'special'].includes(memberTier(s, signals)))
      if (firstHidden !== -1 && firstHidden < lastShown) {
        found.push(`${port}: ${sorted[firstHidden]!.name} ranks above public members of ${owner}`)
      }
    }
  }
  return found
}

d('member order', () => {
  it('leads with listing accessors and ends with private members on every port', () => {
    expect(violations(compareMembers)).toEqual([])
  })

  it('fails alphabetical order for the reasons it exists', () => {
    const found = violations(alphabetical)
    expect(found.some((v) => /^py: list-sessions is #\d+ on libtmux\.server\.Server$/.test(v))).toBe(true)
    expect(found.some((v) => /^py: __\w+__ ranks above public members/.test(v))).toBe(true)
  })

  it('leads a Lua Server, which has no sessions accessor, with its queries', () => {
    const server = model('lua').symbols.filter((s) => s.parent === 'libtmux.Server')
    const order = server.sort(compareMembers(memberSignals('lua'))).map((s) => s.name)
    expect(order.slice(0, 3).sort()).toEqual(['query', 'query_panes', 'snapshot'])
  })

  it('ranks by concept breadth inside the concept tier', () => {
    const server = model('py').symbols.filter((s) => s.parent === 'libtmux.server.Server')
    const order = server.sort(compareMembers(memberSignals('py'))).map((s) => s.name)
    expect(order.indexOf('new_session')).toBeLessThan(order.indexOf('bind_key'))
    expect(order.indexOf('sessions')).toBeLessThan(10)
  })
})
