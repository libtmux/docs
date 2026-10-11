import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { describe, expect, it, vi } from 'vitest'
import { compareMembers, membersOf, memberSignals } from '@libtmux/api-model'
import mentions from '../src/data/mentions.json'
import { API_MODELS, API_NAV, OWNER_KINDS, topLevelTypesOf } from '../src/lib/api-models'
import { bucketForSymbol, firstEntry, membersByType, navTree, referenceNavigation, referenceIndexSections } from '../src/lib/api-tree'
import { API_MODEL_PORTS } from '../src/lib/ports'
import type { ApiTreeBucket, ApiTreeJson } from '../src/lib/api-search'
import { GET as referenceTreeRoute } from '../src/pages/reference/tree.json'
import { versionsOf } from '../../scripts/reference-trees.mjs'
import { SITE_BUILT, SITE_ROOT, sitePath } from './site-root'

const PRIMARY_OBJECT_BUCKETS = new Set(['server', 'session', 'window', 'pane', 'client'])
const PORTS = API_MODEL_PORTS.map((port) => port.slug)

const segments = (id: string) => id.split(/::|[.:/]/).filter(Boolean)

describe('active API sidebar category', () => {
  it.each(PORTS)('honors the explicit placement of each %s declaration', (port) => {
    const model = API_MODELS[port]
    const nav = API_NAV[port]
    for (const symbol of model.symbols) {
      const expected = nav.placement[symbol.publicId ?? symbol.id]
      if (expected !== undefined) expect(bucketForSymbol(model, nav, symbol), symbol.id).toBe(expected)
    }
  })

  it.each([
    ['Connect-TmuxServer', 'server'], ['Get-TmuxPane', 'pane'],
    ['Get-TmuxClient', 'client'], ['Connect-TmuxControl', 'control'],
  ])('opens %s in %s instead of its parent module under Other', (name, expected) => {
    const model = API_MODELS.powershell
    const symbol = model.symbols.find((item) => item.name === name)!
    expect(symbol.parent).toBe('LibTmux')
    expect(API_NAV.powershell.placement.LibTmux).toBe('__unplaced')
    expect(bucketForSymbol(model, API_NAV.powershell, symbol)).toBe(expected)
  })

  it('falls back to the nearest placed owner and stops at missing or cyclic parents', () => {
    const original = API_MODELS.powershell
    const owner = original.symbols.find((item) => item.name === 'Get-TmuxPane')!
    const member = { ...owner, id: 'pane-member', parent: owner.id, publicId: undefined }
    const model = { ...original, symbols: [...original.symbols, member] }
    expect(bucketForSymbol(model, API_NAV.powershell, member)).toBe('pane')
    expect(bucketForSymbol(model, API_NAV.powershell, { ...member, parent: 'missing' })).toBeUndefined()
    const cycle = { ...member, parent: member.id }
    expect(bucketForSymbol({ ...model, symbols: [cycle] }, API_NAV.powershell, cycle)).toBeUndefined()
    expect(bucketForSymbol(undefined, undefined, undefined)).toBeUndefined()
  })
})

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
    if (port === 'powershell') expect(sections[0].free.map((symbol) => symbol.name))
      .toEqual(expect.arrayContaining(['Connect-TmuxServer', 'Get-TmuxServer', 'New-TmuxServer']))
    else expect(sections[0].types[0].name).toBe('Server')
    const ids = sections.flatMap((section) => [...section.types, ...section.free]).map((symbol) => symbol.id)
    expect(new Set(ids).size).toBe(ids.length)
    const available = new Set(sections.map((section) => section.id))
    expect(sections.map((section) => section.id).filter((id) => PRIMARY_OBJECT_BUCKETS.has(id)))
      .toEqual([...PRIMARY_OBJECT_BUCKETS].filter((id) => available.has(id)))
  })

  it('lists every core PowerShell cmdlet under its module without workspace-only commands', () => {
    const expected = API_MODELS.powershell.symbols.filter((symbol) => symbol.command && symbol.product === 'core').map((symbol) => symbol.id).sort()
    const listed = referenceIndexSections('powershell').flatMap((section) => [...section.types, ...section.free])
      .filter((symbol) => symbol.command).map((symbol) => symbol.id).sort()
    expect(expected).toHaveLength(55)
    expect(listed).toEqual(expected)
  })
})

describe('core reference inventory', () => {
  it.each(PORTS)('publishes every reachable %s core declaration without product-only records', async (port) => {
    const navigation = referenceNavigation(port)!
    const model = navigation.model
    const core = model.symbols.filter((symbol) =>
      !['mcp', 'workspace'].includes(symbol.product ?? 'core') || symbol.apiScope === 'internal')
    const coreIds = new Set(core.map((symbol) => symbol.id))
    const expected = [...coreIds].sort()
    const identities = new Map(model.symbols.flatMap((symbol) =>
      [[symbol.id, symbol.id], [symbol.publicId ?? symbol.id, symbol.id]] as const))
    const allMembers = navigation.members
    const before = structuredClone([...membersByType(port)])
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
  it('exposes Julia snapshot discovery in Server without inventing Server methods', () => {
    const server = navTree('julia').find((bucket) => bucket.id === 'server')!
    expect(server.entries.slice(0, 6).map((entry) => entry.name)).toEqual([
      'Server', 'snapshot', 'sessions', 'windows', 'panes', 'clients',
    ])
    expect(API_NAV.julia.placement['LibTmux.sessions']).toBe('session')
    expect(membersByType('julia').get('LibTmux.Server')?.map((member) => member.name))
      .not.toContain('sessions')
    const sections = referenceIndexSections('julia')
    for (const name of ['sessions', 'windows', 'panes', 'clients']) {
      const entries = sections.flatMap((section) => [...section.types, ...section.free])
        .filter((symbol) => symbol.id === `LibTmux.${name}`)
      expect(entries, name).toHaveLength(1)
      expect(entries[0].signatures.some((signature) => signature.params.some((param) => param.type === 'LibTmux.Snapshot'))).toBe(true)
    }
  })

  it.each([
    ['session', ['sessions', 'session', 'new_session', 'rename_session', 'kill_session']],
    ['window', ['windows', 'window', 'new_window', 'split_window', 'select_window', 'rename_window']],
    ['pane', ['panes', 'select_pane', 'resize_pane', 'move_pane', 'swap_pane', 'respawn_pane', 'kill_pane']],
    ['client', ['clients', 'switch_client', 'detach_client']],
  ])('puts Julia %s operations before supporting identities and predicates', (id, names) => {
    const bucket = navTree('julia').find((bucket) => bucket.id === id)!
    expect(bucket.entries.slice(0, names.length).map((entry) => entry.name))
      .toEqual(names)
    expect(firstEntry(bucket)?.name).toBe(names[0])
  })

  it.each([
    ['server', ['New-TmuxServer', 'Get-TmuxServer', 'Connect-TmuxServer']],
    ['session', ['Get-TmuxSession', 'Select-TmuxSession', 'New-TmuxSession', 'Enter-TmuxSession', 'Remove-TmuxSession']],
    ['window', ['Get-TmuxWindow', 'Select-TmuxWindow', 'New-TmuxWindow', 'New-TmuxWindowLink', 'Set-TmuxWindowSize', 'Move-TmuxWindow', 'Remove-TmuxWindowLink', 'Remove-TmuxWindow']],
    ['pane', ['Get-TmuxPane', 'Select-TmuxPane', 'Get-TmuxPaneContent', 'Split-TmuxPane', 'Send-TmuxText', 'Invoke-TmuxPaneCommand', 'Wait-TmuxPaneText', 'Update-TmuxPane', 'Set-TmuxPaneSize', 'Remove-TmuxPane']],
    ['control', ['Connect-TmuxControl', 'Watch-TmuxEvent', 'Wait-TmuxChannel', 'Invoke-TmuxControlCommand', 'Disconnect-TmuxControl']],
  ])('orders PowerShell %s cmdlets around reading, selection, work and teardown', (id, names) => {
    const bucket = navTree('powershell').find((bucket) => bucket.id === id)!
    expect(bucket.entries.map((entry) => entry.name)).toEqual(names)
    expect(firstEntry(bucket)?.name).toBe(names[0])
  })

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
    const owners = model.symbols.filter((symbol) => port === 'powershell'
      ? symbol.kind === 'module'
      : OWNER_KINDS.has(symbol.kind) && ['Server', 'Session', 'Window', 'Pane', 'Client', 'Snapshot'].includes(symbol.name))
    if (port === 'powershell') expect(owners.map((owner) => owner.name).sort()).toEqual(['LibTmux', 'LibTmux.Workspace'])
    else expect(owners.some((owner) => owner.name === 'Server'), port).toBe(true)
    for (const owner of owners) {
      const displayed = membersOf(model, owner, memberSignals(port, mentions.mentions)).sort(compare)
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
        const navigation = referenceNavigation(port)!
        const tree = navTree(port).filter((bucket) => PRIMARY_OBJECT_BUCKETS.has(bucket.id))
        const cardIds = new Set(topLevelTypesOf(API_MODELS[port]!).map((symbol) => symbol.publicId ?? symbol.id))
        for (const bucket of tree) {
          const section = template.content.getElementById(`section-${bucket.id}`)?.closest('details')
          const cards = [...section?.querySelectorAll('.api-index-card__link') ?? []]
            .map((link) => new URL(link.getAttribute('href')!, 'https://libtmux.org').pathname.split('/').filter(Boolean).at(-1))
          const types = bucket.entries.filter((entry) => !entry.shortcut && cardIds.has(entry.id))
          const free = bucket.entries.filter((entry) => !entry.shortcut && !cardIds.has(entry.id))
          expect(cards, `${port}/${version}:${bucket.id}`).toEqual([...types, ...free].map((entry) => entry.slug))
          const declarations = [...section?.querySelectorAll(':scope > div > dl > dt[id]') ?? []]
            .map((entry) => entry.id)
          expect(declarations, `${port}/${version}:${bucket.id} inline declarations`)
            .toEqual([])
          for (const entry of free) {
            expect(template.content.getElementById(entry.id)?.querySelector('.api-index-card__link')?.getAttribute('href'),
              `${port}/${version}:${entry.id} retains its index fragment`).toContain(`/${entry.slug}/`)
          }
          expect(lazy.buckets.find((entry: { id: string }) => entry.id === bucket.id)?.types.map((entry: { id: string }) => entry.id))
            .toEqual(navigation.tree.find((entry) => entry.id === bucket.id)!.entries.map((entry) => entry.id))
        }
        const coreIds = new Set(navigation.model.symbols.filter((symbol) =>
          !['mcp', 'workspace'].includes(symbol.product ?? 'core') || symbol.apiScope === 'internal')
          .flatMap((symbol) => [symbol.id, symbol.publicId ?? symbol.id]))
        const coreMembers = [...navigation.members].filter(([owner]) => coreIds.has(owner))
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
