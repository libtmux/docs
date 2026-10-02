import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { compareMembers, memberSignals } from '@libtmux/api-model'
import mentions from '../src/data/mentions.json'
import { API_MODELS, API_NAV, OWNER_KINDS } from '../src/lib/api-models'
import { membersByType, navTree } from '../src/lib/api-tree'
import { API_MODEL_PORTS } from '../src/lib/ports'
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

describe('major tmux object domains', () => {
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
        for (const bucket of tree) {
          const section = template.content.getElementById(`section-${bucket.id}`)?.closest('details')
          const cards = [...section?.querySelectorAll('.api-index-card__link') ?? []]
            .map((link) => new URL(link.getAttribute('href')!, 'https://libtmux.org').pathname.split('/').filter(Boolean).at(-1))
          const types = bucket.entries.filter((entry) => OWNER_KINDS.has(entry.kind))
          expect(cards, `${port}/${version}:${bucket.id}`).toEqual(types.map((entry) => entry.slug))
          expect(lazy.buckets.find((entry: { id: string }) => entry.id === bucket.id)?.types.map((entry: { id: string }) => entry.id))
            .toEqual(bucket.entries.map((entry) => entry.id))
        }
        for (const [owner, members] of membersByType(port)) {
          expect(lazy.members[owner]?.map((member: string[]) => member.slice(0, 2)), `${port}/${version}:${owner}`)
            .toEqual(members.map((member) => [member.name, member.slug]))
        }
      } finally {
        window.happyDOM.abort()
      }
    }
  })
})
