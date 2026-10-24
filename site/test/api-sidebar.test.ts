import { describe, expect, it } from 'vitest'
import { sidebarCatalog, sidebarNodes } from '../src/lib/api-sidebar'
import type { ApiTreeJson } from '../src/lib/api-search'

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
    const owner = nodes.find((node) => node.label === 'Session')
    const nested = owner?.children?.find((node) => node.label === 'Companion')
    expect(owner?.expanded).toBe(true)
    expect(nested?.expanded).toBe(true)
    expect(nested?.children?.[0]).toMatchObject({ current: true, href: json.hrefs!.create })
    expect(nodes.find((node) => node.label === 'Window')?.expanded).toBe(false)
    expect(owner?.level).toBe(1)
    expect(nested?.level).toBe(2)
    expect(nodes.filter((node) => node.section).map((node) => node.label)).toEqual(['Core objects', 'Supporting types'])
    const items = (rows: typeof nodes): typeof nodes => rows.flatMap((node) => node.section ? [] : [node, ...items(node.children ?? [])])
    expect(items(nodes).every((node) => node.kind && node.href)).toBe(true)
  })

  it('focuses the selected owner and represents empty owners without invented members', () => {
    const nodes = sidebarNodes(json, '/reference/', 'focus', 'create')
    expect(nodes.map((node) => node.label)).toEqual(['Companion', 'create'])
    expect(nodes[1]?.current).toBe(true)
    expect(sidebarNodes(json, '/reference/', 'focus', 'empty').map((node) => node.label)).toEqual(['Empty'])
  })

  it('groups direct members by kind, sorts names, and counts the actual members', () => {
    const nodes = sidebarNodes(json, '/reference/', 'grouped', 'a-name')
    const methods = nodes.find((node) => node.label === 'Methods')
    expect(methods?.count).toBe(2)
    expect(methods?.children?.map((node) => node.label)).toEqual(['attach', 'zoom'])
    expect(nodes.find((node) => node.label === 'Properties')?.children?.[0]?.current).toBe(true)
    expect(nodes.find((node) => node.label === 'Modules')?.children?.[0]?.label).toBe('Companion')
  })

  it('distinguishes standalone functions with the same name by receiver', () => {
    const extensions = structuredClone(json)
    for (const receiver of ['OptionalInt', 'OptionalLong']) extensions.buckets[0]!.types.push({
      id: `java.util.${receiver}.orNull`, qualifiedName: `java.util.${receiver}.orNull`,
      name: 'orNull', slug: receiver.toLowerCase(), m: 0, kind: 'function', category: 'members',
    })
    const nodes = sidebarNodes(extensions, '/reference/', 'outline', 'java.util.OptionalInt.orNull')
    expect(nodes.filter((node) => node.kind === 'function').map((node) => node.label)).toEqual(['OptionalInt.orNull', 'OptionalLong.orNull'])
  })

  it('shows escaped Kotlin identifiers without changing their destinations', () => {
    const quoted = structuredClone(json)
    quoted.port = 'kotlin'
    quoted.members.a!.push(['`set`', 'escaped-set', 'a.`set`', 'method'])
    const owner = sidebarNodes(quoted, '/reference/', 'outline', 'a.`set`').find((node) => node.label === 'Session')
    expect(owner?.children?.find((node) => node.current)).toMatchObject({ label: 'set', href: '/reference/escaped-set/' })
  })
})
