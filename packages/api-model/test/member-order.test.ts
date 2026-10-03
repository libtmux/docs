import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { API_MODEL_PORTS } from '../../../site/src/lib/ports.ts'
import { CONCEPTS } from '../src/concepts.ts'
import { compareMembers, membersOf, memberSignals, memberTier, type MemberSignals } from '../src/member-order.ts'
import type { ApiModel, ApiSymbol } from '../src/model.ts'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '../../../site/src/data')
const PORTS = API_MODEL_PORTS.map((port) => port.slug)
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
      const rank = [...children.get(listing.parent)!].sort(cmp)
        .filter((member) => memberTier(member, signals) !== 'parent').indexOf(listing)
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
  it('breaks equal-name ties by public identity, independent of input order', () => {
    const symbol = model('ts').symbols.find((entry) => entry.name === 'Server')!
    const left = { ...symbol, name: 'handle', id: 'a.handle', publicId: 'a.handle', doc: undefined }
    const right = { ...left, id: 'b.handle', publicId: 'b.handle' }
    const compare = compareMembers(memberSignals('ts'))
    expect([right, left].sort(compare)).toEqual([left, right])
    expect([left, right].sort(compare)).toEqual([left, right])
  })
  it('leads operations with listing accessors and ends with private members on every port', () => {
    expect(violations(compareMembers)).toEqual([])
  })

  it('fails alphabetical order for the reasons it exists', () => {
    const found = violations(alphabetical)
    expect(found.some((v) => /^py: list-sessions is #\d+ on libtmux\.server\.Server$/.test(v))).toBe(true)
    expect(found.some((v) => /^py: __\w+__ ranks above public members/.test(v))).toBe(true)
  })

  it.each(PORTS)('puts %s listings and queries before creation and utility methods', (port) => {
    const { symbols } = model(port)
    const signals = memberSignals(port)
    let checked = 0
    for (const owner of symbols.filter((symbol) => ['Server', 'Session', 'Window', 'Pane', 'Client', 'Snapshot'].includes(symbol.name))) {
      const members = symbols.filter((symbol) => symbol.parent === owner.id)
      const ordered = members.toSorted(compareMembers(signals))
      const routine = members.filter((symbol) => /^(new_?session|new_?window|create_?session|create_?window|close|dispose|asjava|tostring|__enter__|kill_?server)$/.test(
        symbol.name.replace(/\(.*$/, '').replace(/Async$/, '').toLowerCase()))
      const priority = members.filter((symbol) => symbol.doc?.deprecated === undefined && !symbol.modifiers?.includes('deprecated') && (
        /^(?:list_?|get)?(?:sessions|windows|panes|clients|buffers)$/.test(symbol.name.replace(/\(.*$/, '').replace(/Async$/, '').toLowerCase()) ||
        /^(search-|snapshot$)/.test(signals.conceptIds.get(symbol.publicId ?? symbol.id) ?? '')))
      for (const listing of priority) for (const helper of routine) {
        expect(ordered.indexOf(listing), `${owner.id}: ${listing.name} before ${helper.name}`).toBeLessThan(ordered.indexOf(helper))
        checked++
      }
      // F# currently exposes listPanes without creation or lifecycle helpers.
      if (priority.length && !routine.length) {
        expect(priority, owner.id).toContain(ordered.find((member) => memberTier(member, signals) !== 'parent'))
        checked++
      }
    }
    expect(checked, `${port} must exercise at least one real listing or query`).toBeGreaterThan(0)
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

  it.each([
    ['py', 'libtmux.pane.Pane', ['window', 'session', 'server']],
    ['ts', 'pane.Pane', ['window', 'session', 'server']],
    ['rs', 'pane.Pane', ['window', 'session']],
    ['go', 'tmux.Pane', ['Window', 'ResolveWindow', 'Session', 'ResolveSession', 'Server']],
    ['java', 'io.github.libtmux.Pane.Pane', ['window', 'server']],
    ['kotlin', 'io.github.libtmux.kotlin.Pane', ['window', 'server']],
    ['scala', 'io.github.libtmux.scaladsl.Pane', ['window', 'server']],
    ['scala', 'io.github.libtmux.scaladsl.cats.Pane', ['window', 'server']],
    ['dotnet', 'LibTmux.Pane', ['Window', 'Session', 'Server']],
    ['cxx', 'libtmux::Pane', ['window', 'session', 'server']],
    ['cxx', 'libtmux::Window', ['session', 'server']],
    ['cxx', 'libtmux::Session', ['server']],
    ['cxx', 'libtmux::Client', ['session', 'server']],
    ['ruby', 'LibTmux::Pane', ['server']],
    ['ruby', 'LibTmux::PaneSnapshot', ['window']],
    ['ruby', 'LibTmux::WindowLink', ['window', 'session', 'server']],
    ['ruby', 'LibTmux::WindowLinkSnapshot', ['window', 'session']],
    ['lua', 'libtmux.SnapshotPane', ['window']],
    ['lua', 'libtmux.SnapshotWindowLink', ['window', 'session']],
    ['swift', 'WindowAppearance', ['window']],
  ] as const)('puts %s %s parents first, walking toward the server', (port, owner, expected) => {
    const signals = memberSignals(port)
    const api = model(port)
    const members = membersOf(api, api.symbols.find((symbol) => symbol.id === owner)!, signals)
    expect(members.slice(0, expected.length).map((member) => member.name)).toEqual(expected)
    expect(members.filter((member) => memberTier(member, signals) === 'parent').map((member) => member.name)).toEqual(expected)
  })

  it.each(PORTS)('puts every mapped %s parent before collections and operations', (port) => {
    const signals = memberSignals(port)
    const symbols = model(port).symbols
    const parents = symbols.filter((symbol) => memberTier(symbol, signals) === 'parent')
    // F# supplies functions over .NET handles, not a second set of handle properties.
    expect(parents.length > 0).toBe(port !== 'fsharp')
    for (const parent of parents) {
      const siblings = symbols.filter((symbol) => symbol.parent === parent.parent).toSorted(compareMembers(signals))
      for (const sibling of siblings.filter((symbol) => memberTier(symbol, signals) !== 'parent')) {
        expect(siblings.indexOf(parent), `${parent.id} before ${sibling.id}`).toBeLessThan(siblings.indexOf(sibling))
      }
    }
  })

  it('does not promote scalar names, query fields, downward lookups, private or deprecated parents', () => {
    for (const [port, id] of [
      ['go', 'tmux.Client.Session'], ['go', 'tmux.Pane.SessionID'],
      ['java', 'io.github.libtmux.Server.Server.session'], ['rs', 'session.Session.window'],
      ['kotlin', 'io.github.libtmux.kotlin.Window.Companion.session'],
      ['scala', 'io.github.libtmux.scaladsl.generated.WindowFields.session'],
      ['ts', 'selection.PaneWhere.window'], ['swift', 'Pane.windowID'],
    ]) {
      const symbol = model(port).symbols.find((entry) => (entry.publicId ?? entry.id) === id)!
      expect(symbol, id).toBeDefined()
      expect(memberTier(symbol, memberSignals(port)), id).not.toBe('parent')
    }
    const symbol = model('ts').symbols.find((entry) => entry.id === 'pane.Pane.server')!
    expect(memberTier({ ...symbol, modifiers: ['private'] }, memberSignals('ts'))).toBe('private')
    expect(memberTier({ ...symbol, apiScope: 'internal' }, memberSignals('ts'))).toBe('private')
    expect(memberTier({ ...symbol, doc: { summary: '', deprecated: 'Use another handle.' } }, memberSignals('ts'))).toBe('deprecated')
  })

  it('retains the parent relation when a broader concept also names the symbol', () => {
    const symbol = model('ts').symbols.find((entry) => entry.id === 'pane.Pane.server')!
    const signals = memberSignals('ts', [], {
      broad: { label: 'Generic access', symbols: { ts: symbol.id, py: 'other' } },
      parent: { label: 'Owning server', symbols: { ts: symbol.id }, parentObject: 'server' },
    })
    expect(signals.conceptIds.get(symbol.id)).toBe('broad')
    expect(memberTier(symbol, signals)).toBe('parent')
  })

  it('exposes only explicit C++ public using declarations and keeps their original targets', () => {
    const api = model('cxx')
    const before = JSON.stringify(api)
    const source = api.symbols.find((entry) => entry.id === 'libtmux::detail::Row::server')!
    const owner = api.symbols.find((entry) => entry.id === 'libtmux::Pane')!
    const inherited = membersOf(api, owner).filter((member) => member.inheritedFrom)
    expect(inherited).toEqual([{ ...source, parent: owner.id, inheritedFrom: 'libtmux::detail::Row' }])
    const privateReceiver = { ...owner, id: 'libtmux::PrivateRow', publicId: 'libtmux::PrivateRow' }
    expect(membersOf({ ...api, symbols: [...api.symbols, privateReceiver] }, privateReceiver)).toEqual([])
    const override = { ...source, id: `${owner.id}::server`, publicId: `${owner.id}::server`, parent: owner.id }
    expect(membersOf({ ...api, symbols: [...api.symbols, override] }, owner).filter((member) => member.name === 'server')).toEqual([override])
    expect(JSON.stringify(api)).toBe(before)
  })
})
