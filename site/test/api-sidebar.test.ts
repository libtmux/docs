import { describe, expect, it } from 'vitest'
import { sidebarCatalog, sidebarInventory, sidebarNodes, quietSidebarKinds, SIDEBAR_PRESENTATIONS, type SidebarNode } from '../src/lib/api-sidebar'
import { apiTreeHref, searchApi, type ApiSearchResult, type ApiTreeJson } from '../src/lib/api-search'
import { tmuxReferenceTree, tmuxReferenceUrl, tmuxSourceModel } from '../src/lib/tmux-reference'

const json: ApiTreeJson = {
  port: 'sample',
  buckets: [{ id: 'objects', label: 'Objects', count: 3, slug: 'a', children: [], types: [
    { id: 'a', name: 'Session', slug: 'a', m: 1, kind: 'class', category: 'types' },
    { id: 'b', name: 'Window', slug: 'b', m: 1, kind: 'class', category: 'types' },
    { id: 'empty', name: 'Empty', slug: 'empty', m: 0, kind: 'class', category: 'types' },
  ] }],
  members: {
    a: [['Companion', 'companion', 'nested', 'module', 'types'], ['name', 'a-name', 'a-name', 'property'], ['zoom', 'zoom', 'zoom', 'method'], ['attach', 'attach', 'attach', 'method']],
    b: [['name', 'b-name', 'b-name', 'property']],
    nested: [['create', 'create', 'create', 'method']],
  },
  hrefs: { create: '/pr/42/kotlin/latest/reference/create/' },
}

describe('API sidebar presentations', () => {
  it('uses identities and member edges for repeated names and nested owners', () => {
    const catalog = sidebarCatalog(json)
    expect(catalog.ownerOf('a-name')?.id).toBe('a')
    expect(catalog.ownerOf('b-name')?.id).toBe('b')
    expect(catalog.ownerOf('create')?.id).toBe('nested')
    expect(catalog.parent.get('nested')).toBe('a')
    expect(catalog.owners.map((owner) => owner.id)).toContain('empty')
  })

  it('opens the selected ancestry in Outline and keeps canonical prefixed links', () => {
    const nodes = sidebarNodes(json, '/pr/42/kotlin/latest/reference/', 'outline', 'create')
    expect(nodes.map((node) => node.label)).toEqual(['Objects'])
    const owner = nodes[0]?.children?.find((node) => node.label === 'Session')
    const nested = owner?.children?.find((node) => node.label === 'Companion')
    expect(owner?.expanded).toBe(true)
    expect(nested?.expanded).toBe(true)
    expect(nested?.children?.[0]).toMatchObject({ current: true, href: json.hrefs!.create })
    expect(nodes[0]?.children?.find((node) => node.label === 'Window')?.expanded).toBe(false)
    expect(owner?.level).toBe(2)
    expect(nested?.level).toBe(3)
    expect(nodes[0]?.kind).toBeUndefined()
  })

  it('focuses the selected owner and represents empty owners without invented members', () => {
    const nodes = sidebarNodes(json, '/reference/', 'focus', 'create')
    expect(nodes.map((node) => node.label)).toEqual(['Companion', 'create'])
    expect(nodes[1]?.current).toBe(true)
    expect(sidebarNodes(json, '/reference/', 'focus', 'empty').map((node) => node.label)).toEqual(['Empty'])
  })

  it('groups direct members by kind, sorts names, and counts the actual members', () => {
    const nodes = sidebarNodes(json, '/reference/', 'grouped', 'a-name')
    expect(nodes[0]?.label).toBe('Objects')
    const groups = nodes[0]?.children?.find((node) => node.label === 'Session')?.children ?? []
    const methods = groups.find((node) => node.label === 'Methods')
    expect(methods?.count).toBe(2)
    expect(methods?.children?.map((node) => node.label)).toEqual(['attach', 'zoom'])
    expect(groups.find((node) => node.label === 'Properties')?.children?.[0]?.current).toBe(true)
    expect(groups.find((node) => node.label === 'Modules')?.children?.[0]?.label).toBe('Companion')
  })

  it('distinguishes standalone functions with the same name by receiver', () => {
    const extensions = structuredClone(json)
    for (const receiver of ['OptionalInt', 'OptionalLong']) extensions.buckets[0]!.types.push({
      id: `java.util.${receiver}.orNull`, qualifiedName: `java.util.${receiver}.orNull`,
      name: 'orNull', slug: receiver.toLowerCase(), m: 0, kind: 'function', category: 'members',
    })
    const nodes = sidebarNodes(extensions, '/reference/', 'outline', 'java.util.OptionalInt.orNull')
    expect(nodes[0]?.children?.filter((node) => node.kind === 'function').map((node) => node.label)).toEqual(['OptionalInt.orNull', 'OptionalLong.orNull'])
  })

  it('distinguishes roots with the same name by the namespace their language writes', () => {
    const namespaces: ApiTreeJson = { port: 'cxx', buckets: [{ id: 'objects', label: 'Objects', count: 3, slug: 'a-server', children: [], types: [
      ['a', 'libtmux::a::Server'], ['b', 'libtmux::b::Server'], ['c', 'libtmux::c::Server'],
    ].map(([key, qualifiedName]) => ({ id: qualifiedName!, name: 'Server', symbolName: 'Server', qualifiedName: qualifiedName!,
      slug: `${key}-server`, m: 0 as const, kind: 'class', category: 'types' })) }], members: {} }
    const roots = sidebarNodes(namespaces, '/reference/', 'outline', 'libtmux::a::Server')[0]!.children!
    expect(roots.map((row) => row.label)).toEqual(['a::Server', 'b::Server', 'c::Server'])
  })

  it('shows escaped Kotlin identifiers without changing their destinations', () => {
    const quoted = structuredClone(json)
    quoted.port = 'kotlin'
    quoted.members.a!.push(['`set`', 'escaped-set', 'a.`set`', 'method'])
    const owner = sidebarNodes(quoted, '/reference/', 'outline', 'a.`set`')[0]?.children?.find((node) => node.label === 'Session')
    expect(owner?.children?.find((node) => node.current)).toMatchObject({ label: 'set', href: '/reference/escaped-set/' })
  })

  it('uses manual sections as command owners without presenting them as library types', () => {
    const commands: ApiTreeJson = { port: 'tmux', buckets: [{ id: 'manual', label: 'Commands', count: 1, slug: null, children: [], types: [
      { id: 'windows', name: 'Windows and panes', slug: '', kind: 'section', m: 1 },
    ] }], members: { windows: [['capture-pane', 'capture-pane', 'capture-pane', 'command']] }, hrefs: { windows: '/pr-42/en/tmux/latest/manual/#windows-and-panes' } }
    const outline = sidebarNodes(commands, '/pr-42/en/tmux/latest/manual/', 'outline', 'capture-pane')
    expect(outline.map((node) => node.label)).toEqual(['Windows and panes'])
    expect(outline[0]?.children?.[0]).toMatchObject({ kind: 'command', current: true, href: '/pr-42/en/tmux/latest/manual/capture-pane/' })
    expect(sidebarCatalog(commands)).toMatchObject({ ownerLabel: 'section', ownerPlural: 'sections' })
  })

  it('resolves section anchors beneath a preview prefix and keeps homogeneous protocol rows quiet', () => {
    expect(apiTreeHref('/pr-42/en/rs/latest/mcp/', { id: 'group', slug: '' }, { group: 'tools/#windows' }))
      .toBe('/pr-42/en/rs/latest/mcp/tools/#windows')
    const nodes = sidebarNodes(json, '/reference/', 'grouped', 'a-name')
    quietSidebarKinds(nodes)
    expect(nodes[0]?.children?.[0]?.children?.find((node) => node.label === 'Methods')?.children?.every((node) => node.quiet)).toBe(true)
  })

  it.each(['outline', 'grouped'] as const)('keeps curated nested buckets collapsed outside the current path in %s', (mode) => {
    const inventory = structuredClone(json)
    inventory.buckets.push({ id: 'formats', label: 'Format variables', count: 1, slug: 'fields-server', types: [], children: [
      { id: 'fields', label: 'Fields', count: 1, slug: 'fields-server', children: [], types: [
        { id: 'Fields.Server', name: 'Server fields', slug: 'fields-server', m: 0, kind: 'class' },
      ] },
    ] })
    const nodes = sidebarNodes(inventory, '/reference/', mode, 'Fields.Server')
    expect(nodes.map((node) => node.label)).toEqual(['Objects', 'Format variables'])
    expect(nodes[0]).toMatchObject({ lazy: 'bucket:objects', expanded: false })
    expect(nodes[0]?.children).toBeUndefined()
    expect(nodes[1]?.children?.[0]).toMatchObject({ label: 'Fields', expanded: true })
    expect(nodes[1]?.children?.[0]?.children?.[0]).toMatchObject({ label: 'Server fields', current: true, href: '/reference/fields-server/' })
  })
})

const rowsOf = (nodes: SidebarNode[]): SidebarNode[] => nodes.flatMap((node) => [node, ...rowsOf(node.children ?? [])])
const ANONYMOUS = /^anonymous (?:enum|struct|union)$/

describe('anonymous declarations in the sidebar', () => {
  const anonymous: ApiTreeJson = {
    port: 'tmux',
    buckets: [{ id: 'types', label: 'Types', count: 4, slug: 'client', children: [], types: [
      { id: 'c:struct:client', name: 'client', qualifiedName: 'client', slug: 'client', m: 1, kind: 'struct', category: 'types' },
      { id: 'c:enum:key_code_type', name: 'key_code_type', qualifiedName: 'key_code_type', slug: 'key-code-type', m: 1, kind: 'enum', category: 'types' },
      { id: 'c:enum:tmux.h:@1', name: 'anonymous enum', qualifiedName: 'anonymous enum', slug: 'anon-1', m: 1, kind: 'enum', category: 'types' },
      { id: 'c:enum:tmux.h:@2', name: 'anonymous enum', qualifiedName: 'anonymous enum', slug: 'anon-2', m: 1, kind: 'enum', category: 'types' },
    ] }],
    members: {
      'c:struct:client': [
        ['flags', 'client-flags', 'c:struct:client::flags', 'attribute', 'members', '', 'client.flags'],
        ['anonymous union', 'client-union', 'c:struct:client::@3', 'union', 'types', '', 'client (anonymous union)'],
      ],
      'c:struct:client::@3': [['inner', 'client-inner', 'c:struct:client::@3::inner', 'attribute', 'members', '', 'inner']],
      'c:enum:key_code_type': [['KEYC_TYPE', 'keyc-type', 'c:enum:key_code_type::KEYC_TYPE', 'constant', 'members', '', 'KEYC_TYPE']],
      'c:enum:tmux.h:@1': [['KEYC_FOCUS_IN', 'keyc-focus-in', 'c:enum:tmux.h:@1::KEYC_FOCUS_IN', 'constant', 'members', '', 'KEYC_FOCUS_IN']],
      'c:enum:tmux.h:@2': [['KEYC_USER', 'keyc-user', 'c:enum:tmux.h:@2::KEYC_USER', 'constant', 'members', '', 'KEYC_USER']],
    },
  }

  it('leaves them, and what they hold, out of every layout and the owner list', () => {
    const base = '/reference/'
    const layouts = [
      ...SIDEBAR_PRESENTATIONS.flatMap((mode) => ['', 'c:struct:client', 'c:enum:key_code_type'].map((selected) => sidebarNodes(anonymous, base, mode, selected))),
      sidebarNodes(anonymous, base, 'grouped', 'c:struct:client', true),
    ]
    const rows = layouts.flatMap(rowsOf)
    const hrefs = new Set(rows.map((row) => row.href))
    expect(rows.map((row) => row.label).filter((label) => ANONYMOUS.test(label) || /c:/.test(label))).toEqual([])
    for (const slug of ['anon-1', 'anon-2', 'keyc-focus-in', 'keyc-user', 'client-union', 'client-inner']) expect(hrefs, slug).not.toContain(`${base}${slug}/`)
    // Neighbours stay, with the destinations they had.
    expect(hrefs).toContain(`${base}client-flags/`)
    expect(hrefs).toContain(`${base}key-code-type/`)
    expect(hrefs).toContain(`${base}keyc-type/`)
    const catalog = sidebarCatalog(anonymous)
    expect(catalog.owners.map((owner) => owner.id)).toEqual(['c:struct:client', 'c:enum:key_code_type'])
    expect(catalog.symbols.has('c:enum:tmux.h:@1')).toBe(false)
    expect(catalog.membersOf('c:struct:client').map((member) => member.name)).toEqual(['flags'])
    expect(sidebarNodes(anonymous, base, 'outline', '')[0]?.count).toBe(2)
  })

  it('builds one catalog for an inventory and for the view the sidebar navigates', () => {
    expect(sidebarCatalog(anonymous)).toBe(sidebarCatalog(anonymous))
    expect(sidebarCatalog(sidebarInventory(anonymous))).toBe(sidebarCatalog(anonymous))
    expect(sidebarCatalog(structuredClone(anonymous))).not.toBe(sidebarCatalog(anonymous))
  })

  it('drops a category that held only anonymous declarations, with its landing link', () => {
    const unnamed = structuredClone(anonymous)
    unnamed.buckets = [
      { id: 'types', label: 'Types', count: 2, slug: 'client', children: [], types: unnamed.buckets[0]!.types.slice(0, 2) },
      { id: 'unnamed', label: 'Unnamed', count: 2, slug: 'anon-1', children: [
        { id: 'unnamed-inner', label: 'Unnamed inner', count: 1, slug: 'anon-2', children: [], types: [unnamed.buckets[0]!.types[3]!] }],
        types: [unnamed.buckets[0]!.types[2]!] },
    ]
    for (const mode of ['outline', 'grouped'] as const) {
      const nodes = sidebarNodes(unnamed, '/reference/', mode, 'c:struct:client')
      expect(nodes.map((node) => [node.label, node.count]), mode).toEqual([['Types', 2]])
    }
    // A category that keeps a named entry stays, and lands on it rather than on a hidden page.
    const mixed = structuredClone(anonymous)
    mixed.buckets[0]!.slug = 'anon-1'
    mixed.buckets[0]!.types = [mixed.buckets[0]!.types[2]!, mixed.buckets[0]!.types[0]!]
    expect(sidebarNodes(mixed, '/reference/', 'outline', '').map((node) => [node.label, node.count, node.href])).toEqual([['Types', 1, '/reference/client/']])
  })

  it('leaves them out of rows opened later, by category and by owner', () => {
    const base = '/reference/'
    const category = sidebarNodes(anonymous, base, 'outline', '', false, { lazy: 'bucket:types', level: 2 })
    expect(category.map((row) => row.label)).toEqual(['client', 'key_code_type'])
    const owner = sidebarNodes(anonymous, base, 'outline', '', false, { lazy: 'type:c:struct:client', level: 3 })
    expect(owner.map((row) => row.label)).toEqual(['flags'])
    expect(sidebarNodes(anonymous, base, 'outline', '', false, { lazy: 'type:c:enum:tmux.h:@1', level: 3 })).toEqual([])
    // A category opened later counts and lands on what the sidebar shows, not on what it hides.
    const nested = structuredClone(anonymous)
    const [client, , anon] = nested.buckets[0]!.types
    nested.buckets = [{ id: 'outer', label: 'Outer', count: 2, slug: 'anon-1', types: [], children: [
      { id: 'inner', label: 'Inner', count: 2, slug: 'anon-1', children: [], types: [anon!, client!] }] }]
    expect(sidebarNodes(nested, base, 'outline', '', false, { lazy: 'bucket:outer', level: 2 }).map((row) => [row.label, row.count, row.href]))
      .toEqual([['Inner', 1, '/reference/client/']])
  })

  it('names roots that share a name by that name, never by id', () => {
    const shared: ApiTreeJson = { port: 'tmux', buckets: [{ id: 'types', label: 'Types', count: 2, slug: 'sessions', children: [], types: [
      { id: 'c:struct:sessions', name: 'sessions', qualifiedName: 'sessions', slug: 'struct-sessions', m: 0, kind: 'struct', category: 'types' },
      { id: 'c:variable:sessions', name: 'sessions', qualifiedName: 'sessions', slug: 'variable-sessions', m: 0, kind: 'attribute', category: 'members' },
    ] }], members: {} }
    const roots = sidebarNodes(shared, '/reference/', 'outline', 'c:struct:sessions')[0]!.children!
    expect(roots.map((row) => [row.label, row.kind, row.href])).toEqual([
      ['sessions', 'struct', '/reference/struct-sessions/'], ['sessions', 'attribute', '/reference/variable-sessions/'],
    ])
  })

  it('does not change the inventory that search and the pages use', () => {
    const before = JSON.stringify(anonymous)
    sidebarNodes(anonymous, '/reference/', 'outline', '')
    expect(JSON.stringify(anonymous)).toBe(before)
    expect(searchApi(anonymous, 'KEYC_FOCUS_IN').map((record) => record.id)).toEqual(['c:enum:tmux.h:@1::KEYC_FOCUS_IN'])
    expect(searchApi(anonymous, '', 'types').filter((record) => ANONYMOUS.test(record.name)).map((record) => record.id).sort())
      .toEqual(['c:enum:tmux.h:@1', 'c:enum:tmux.h:@2', 'c:struct:client::@3'])
  })
})

describe.each(['3.7c', '3.2a'])('tmux %s C reference sidebar', (version) => {
  const json = tmuxReferenceTree(version)
  const base = tmuxReferenceUrl(version)
  const records = searchApi(json, '')
  const href = (record: ApiSearchResult) => apiTreeHref(base, record, json.hrefs)
  const anonymousRecords = records.filter((record) => ANONYMOUS.test(record.name))
  // What an anonymous declaration holds goes with it.
  const hidden = new Set<string>()
  const hide = (id: string) => {
    if (hidden.has(id)) return
    hidden.add(id)
    for (const [name, , member] of json.members[id] ?? []) hide(member ?? `${id}.${name}`)
  }
  for (const record of anonymousRecords) hide(record.id)
  const hiddenHrefs = new Set(records.filter((record) => hidden.has(record.id)).map(href))
  const holders = Object.entries(json.members)
    .filter(([owner, members]) => !hidden.has(owner) && members.some(([name, , id]) => hidden.has(id ?? `${owner}.${name}`))).map(([owner]) => owner)
  const outlines = [sidebarNodes(json, base, 'outline', ''), sidebarNodes(json, base, 'outline', 'c:function:cmd_find_target'),
    ...['outline', 'focus', 'grouped'].flatMap((mode) => holders.map((owner) => sidebarNodes(json, base, mode as 'outline', owner))),
    sidebarNodes(json, base, 'grouped', holders[0]!, true)]
  const rows = outlines.flatMap(rowsOf)
  const ids = new Set(records.map((record) => record.id))

  it('has anonymous declarations to leave out, in the roots and inside named structs', () => {
    expect(anonymousRecords.length).toBeGreaterThan(0)
    expect(hidden.size).toBeGreaterThan(anonymousRecords.length)
    expect(holders.length).toBeGreaterThan(0)
    expect(sidebarNodes(json, base, 'outline', '').some((row) => row.lazy?.startsWith('bucket:'))).toBe(true)
  })

  it('never labels a row with a record id or a clang USR', () => {
    const labels = rows.map((row) => row.label)
    expect(labels.filter((label) => /^c:|c:enum:|c:@|@\d/.test(label) || ids.has(label))).toEqual([])
  })

  it('shows no anonymous declaration or member of one as a row', () => {
    expect(rows.map((row) => row.label).filter((label) => ANONYMOUS.test(label))).toEqual([])
    expect(rows.filter((row) => row.href && hiddenHrefs.has(row.href)).map((row) => `${row.label} ${row.href}`)).toEqual([])
    const catalog = sidebarCatalog(json)
    expect(catalog.records.filter((record) => hidden.has(record.id))).toEqual([])
    expect(catalog.owners.filter((owner) => hidden.has(owner.id))).toEqual([])
  })

  it.each(['window_copy_cmd_action', ...(version === '3.7c' ? ['key_code_type'] : [])])('keeps the named enum %s and its members, at their own URLs', (name) => {
    const named = records.find((record) => record.kind === 'enum' && record.name === name)!
    const members = (json.members[named.id] ?? []).map(([member, slug, id]) => ({ id: id ?? `${named.id}.${member}`, slug }))
    expect(members.length).toBeGreaterThan(0)
    const outline = sidebarNodes(json, base, 'outline', named.id)
    const row = rowsOf(outline).find((node) => node.label === name)
    expect(row).toMatchObject({ kind: 'enum', href: href(named), count: members.length, expanded: true })
    expect(row?.children?.map((child) => child.href)).toEqual(members.map((member) => `${base}${member.slug}/`))
    expect(sidebarNodes(json, base, 'focus', named.id).slice(1).map((child) => child.href)).toEqual(members.map((member) => `${base}${member.slug}/`))
  })

  it('leaves the pages, their URLs and search alone', () => {
    const before = JSON.stringify(json)
    sidebarCatalog(json)
    expect(JSON.stringify(json)).toBe(before)
    const symbols = new Map(tmuxSourceModel(version).symbols.map((symbol) => [symbol.id, symbol]))
    expect(anonymousRecords.filter((record) => !symbols.has(record.id))).toEqual([])
    for (const record of anonymousRecords) {
      expect(href(record)).toBe(tmuxReferenceUrl(version, symbols.get(record.id)))
    }
    for (const name of ['anonymous enum', 'anonymous union']) {
      expect(searchApi(json, name, 'types').filter((record) => record.name === name).map((record) => record.id).sort(), name)
        .toEqual(anonymousRecords.filter((record) => record.name === name && record.category === 'types').map((record) => record.id).sort())
    }
    for (const record of anonymousRecords.filter((candidate) => candidate.category === 'types' && json.members[candidate.id]?.length)) {
      const [name, , id] = json.members[record.id]![0]!
      expect(searchApi(json, name, 'members').map((member) => member.id), name).toContain(id)
    }
  })
})
