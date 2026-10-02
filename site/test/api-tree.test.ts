import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { describe, expect, it, vi } from 'vitest'
import { compareMembers, memberSignals } from '@libtmux/api-model'
import mentions from '../src/data/mentions.json'
import { API_MODELS, API_NAV, OWNER_KINDS, topLevelTypesOf } from '../src/lib/api-models'
import { membersByType, navTree, referenceIndexSections } from '../src/lib/api-tree'
import { API_MODEL_PORTS } from '../src/lib/ports'
import type { ApiTreeBucket, ApiTreeJson } from '../src/lib/api-search'
import { GET as referenceTreeRoute } from '../src/pages/reference/tree.json'
import { versionsOf } from '../../scripts/reference-trees.mjs'
import { SITE_BUILT, SITE_ROOT, sitePath } from './site-root'

const PRIMARY_OBJECT_BUCKETS = new Set(['server', 'session', 'window', 'pane', 'client'])
const PORTS = API_MODEL_PORTS.map((port) => port.slug)

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

  it('keeps field records and command results out of the Server domain', () => {
    const tree = navTree('lua')
    const ids = (id: string) => tree.find((bucket) => bucket.id === id)?.entries.map((entry) => entry.id) ?? []

    expect(ids('server')).toEqual(['libtmux.Server'])
    expect(ids('formats')).toEqual(expect.arrayContaining(['libtmux.Fields.Server', 'libtmux.Fields.Pane']))
    expect(ids('commands')).toContain('libtmux.CommandOutcome')
  })

  it('opens each tmux object domain on its handle class', () => {
    const tree = navTree('lua')
    for (const [bucket, id] of [
      ['session', 'libtmux.Session'],
      ['window', 'libtmux.Window'],
      ['pane', 'libtmux.Pane'],
      ['client', 'libtmux.Client'],
    ]) {
      expect(tree.find((b) => b.id === bucket)?.entries[0]?.id, bucket).toBe(id)
    }
  })
})

describe('shared reference index sections', () => {
  it.each(PORTS)('leads the %s index and exports with the primary server', (port) => {
    const sections = referenceIndexSections(port)
    expect(sections[0].id).toBe('server')
    expect(sections[0].types[0].name).toBe('Server')
    const ids = sections.flatMap((section) => [...section.types, ...section.free]).map((symbol) => symbol.id)
    expect(new Set(ids).size).toBe(ids.length)
    const available = new Set(sections.map((section) => section.id))
    expect(sections.map((section) => section.id).filter((id) => PRIMARY_OBJECT_BUCKETS.has(id)))
      .toEqual([...PRIMARY_OBJECT_BUCKETS].filter((id) => available.has(id)))
  })
})

describe('core reference inventory', () => {
  it.each(PORTS)('publishes every reachable %s core declaration without product-only records', async (port) => {
    const model = API_MODELS[port]
    const core = model.symbols.filter((symbol) =>
      !['mcp', 'workspace'].includes(symbol.product ?? 'core') || symbol.apiScope === 'internal')
    const coreIds = new Set(core.map((symbol) => symbol.id))
    const expected = [...coreIds].sort()
    const identities = new Map(model.symbols.flatMap((symbol) =>
      [[symbol.id, symbol.id], [symbol.publicId ?? symbol.id, symbol.id]] as const))
    const allMembers = membersByType(port)
    const before = structuredClone([...allMembers])
    vi.stubEnv('LIBTMUX_DOCS_PORT', port)
    let tree: ApiTreeJson
    try {
      const response = await referenceTreeRoute({} as never)
      expect(response.status).toBe(200)
      tree = await response.json()
    } finally {
      vi.unstubAllEnvs()
    }
    const roots = (buckets: ApiTreeBucket[]): string[] => buckets.flatMap((bucket) =>
      [...bucket.types.map((entry) => entry.id), ...roots(bucket.children)])
    const listed = [...roots(tree.buckets), ...Object.values(tree.members).flatMap((rows) => rows.map((row) => row[2]!))]
    expect([...new Set(listed.map((id) => identities.get(id) ?? id))].sort()).toEqual(expected)
    const reachable = new Set<string>()
    const visit = (id: string) => {
      if (reachable.has(id)) return
      reachable.add(id)
      for (const row of tree.members[id] ?? []) visit(row[2]!)
    }
    roots(tree.buckets).forEach(visit)
    expect([...new Set([...reachable].map((id) => identities.get(id) ?? id))].sort()).toEqual(expected)
    for (const [owner, rows] of Object.entries(tree.members)) {
      expect(reachable.has(owner), `${port}: orphan owner ${owner}`).toBe(true)
      expect(rows.map((row) => row.slice(0, 3))).toEqual(allMembers.get(owner)!
        .filter((member) => coreIds.has(member.id))
        .map((member) => [member.name, member.slug, member.id]))
    }
    expect([...membersByType(port)]).toEqual(before)
  })
})

describe('major tmux object domains', () => {
  it('puts Kotlin handles before builders and Rust Server before helpers', () => {
    for (const [port, bucket, name] of [['rs', 'server', 'Server'], ['kotlin', 'session', 'Session'], ['kotlin', 'window', 'Window']]) {
      expect(navTree(port).find((entry) => entry.id === bucket)?.entries[0].name).toBe(name)
    }
    expect(navTree('rs').find((entry) => entry.id === 'server')?.entries.some((entry) => entry.name.startsWith('__fuzz_'))).toBe(false)
    expect(navTree('rs').find((entry) => entry.id === 'internal')?.entries.some((entry) => entry.name.startsWith('__fuzz_'))).toBe(true)
  })
  it('distinguishes Scala variants without long package labels', () => {
    const names = navTree('scala').find((entry) => entry.id === 'window')!.entries.map((entry) => entry.name)
    expect(names).toContain('Window (Direct API)')
    expect(names).toContain('Window (Cats Effect)')
  })
  it('covers every reference port in both the model and navigation', () => {
    expect(Object.keys(API_MODELS).sort()).toEqual([...PORTS].sort())
    expect(Object.keys(API_NAV).sort()).toEqual([...PORTS].sort())
  })
  it.each(PORTS)('uses the same useful member order for %s pages and lazy branches', (port) => {
    const model = API_MODELS[port]!
    const branches = membersByType(port)
    const compare = compareMembers(memberSignals(port, mentions.mentions))
    const owners = model.symbols.filter((symbol) => OWNER_KINDS.has(symbol.kind) &&
      ['Server', 'Session', 'Window', 'Pane', 'Client', 'Snapshot'].includes(symbol.name))
    expect(owners.some((owner) => owner.name === 'Server'), port).toBe(true)
    for (const owner of owners) {
      const displayed = model.symbols.filter((symbol) => symbol.parent === owner.id).sort(compare)
      expect(branches.get(owner.publicId ?? owner.id)?.map((member) => member.id) ?? [], `${port}:${owner.id}`)
        .toEqual(displayed.map((member) => member.id))
    }
  })
  it.each(['kotlin', 'scala', 'ts'])('puts %s listings first in lazily expanded branches', (port) => {
    const servers = API_MODELS[port]!.symbols.filter((symbol) => symbol.name === 'Server' && !symbol.parent)
    expect(servers.length).toBeGreaterThan(0)
    for (const server of servers) {
      const names = membersByType(port).get(server.publicId ?? server.id)!.map((member) => member.name)
      for (const listing of ['sessions', 'windows', 'panes', 'clients']) {
        expect(names.indexOf(listing), `${server.id}.${listing}`).toBeGreaterThanOrEqual(0)
        expect(names.indexOf(listing), `${server.id}.${listing}`).toBeLessThan(names.indexOf('newSession'))
      }
      expect(names.indexOf('newSession'), server.id).toBeLessThan(names.indexOf(port === 'ts' ? 'toString' : 'asJava'))
    }
  })
  it('puts a domain’s shallowest primary object first across ports', () => {
    for (const port of PORTS) {
      for (const bucket of navTree(port).filter((candidate) => PRIMARY_OBJECT_BUCKETS.has(candidate.id))) {
        const primary = bucket.entries
          .filter((entry) => OWNER_KINDS.has(entry.kind) && segments(entry.id).at(-1)?.toLowerCase() === bucket.label.toLowerCase())
          .toSorted((left, right) => segments(left.id).length - segments(right.id).length)[0]

        if (primary) expect(bucket.entries[0]?.id, `${port}:${bucket.id}`).toBe(primary.id)
      }
    }
  })
})

describe.skipIf(!SITE_BUILT)('rendered reference ordering', () => {
  it.each(PORTS)('keeps %s index cards and lazy navigation in the curated order', (port) => {
    const versions = versionsOf(SITE_ROOT, port)
    expect(versions.length, `${port}: assembled reference versions`).toBeGreaterThan(0)
    for (const version of versions) {
      const window = new Window()
      try {
        // A template keeps scripts and preload links inert during this HTML audit.
        const template = window.document.createElement('template')
        template.innerHTML = readFileSync(sitePath(port, version, 'reference/index.html'), 'utf8')
        const lazy = JSON.parse(readFileSync(sitePath(port, version, 'reference/tree.json'), 'utf8'))
        const tree = navTree(port).filter((bucket) => PRIMARY_OBJECT_BUCKETS.has(bucket.id))
        const cardIds = new Set(topLevelTypesOf(API_MODELS[port]!).map((symbol) => symbol.publicId ?? symbol.id))
        for (const bucket of tree) {
          const section = template.content.getElementById(`section-${bucket.id}`)?.closest('details')
          const cards = [...section?.querySelectorAll('.api-index-card__link') ?? []]
            .map((link) => new URL(link.getAttribute('href')!, 'https://libtmux.org').pathname.split('/').filter(Boolean).at(-1))
          const types = bucket.entries.filter((entry) => cardIds.has(entry.id))
          expect(cards, `${port}/${version}:${bucket.id}`).toEqual(types.map((entry) => entry.slug))
          const declarations = [...section?.querySelectorAll(':scope > div > dl > dt[id]') ?? []]
            .map((entry) => entry.id)
          expect(declarations, `${port}/${version}:${bucket.id} inline declarations`)
            .toEqual(bucket.entries.filter((entry) => !cardIds.has(entry.id)).map((entry) => entry.id))
          expect(lazy.buckets.find((entry: { id: string }) => entry.id === bucket.id)?.types.map((entry: { id: string }) => entry.id))
            .toEqual(bucket.entries.map((entry) => entry.id))
        }
        const coreIds = new Set(API_MODELS[port].symbols.filter((symbol) =>
          !['mcp', 'workspace'].includes(symbol.product ?? 'core') || symbol.apiScope === 'internal')
          .flatMap((symbol) => [symbol.id, symbol.publicId ?? symbol.id]))
        const coreMembers = [...membersByType(port)].filter(([owner]) => coreIds.has(owner))
          .map(([owner, members]) => [owner, members.filter((member) => coreIds.has(member.id))] as const)
          .filter(([, members]) => members.length)
        expect(Object.keys(lazy.members), `${port}/${version}: core owner keys`).toEqual(coreMembers.map(([owner]) => owner))
        for (const [owner, members] of coreMembers) {
          expect(lazy.members[owner]?.map((member: string[]) => member.slice(0, 2)), `${port}/${version}:${owner}`)
            .toEqual(members.map((member) => [member.name, member.slug]))
        }
      } finally {
        window.happyDOM.abort()
      }
    }
  })
})
