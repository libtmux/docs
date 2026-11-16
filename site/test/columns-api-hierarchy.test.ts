import { describe, expect, it } from 'vitest'
import type { ApiTreeJson } from '../src/lib/api-search'
import { apiRootId, apiSource, plainSummary } from '../src/lib/columns/api-hierarchy'
import { listCount, pathTo } from '../src/lib/columns/selection'

const BASE = '/en/go/latest/reference/'

const fixture: ApiTreeJson = {
  port: 'go',
  buckets: [
    { id: 'pane', label: 'Pane', count: 3, slug: 'tmux-pane', children: [], types: [
      { id: 'tmux.Pane', name: 'Pane', slug: 'tmux-pane', m: 1, kind: 'struct', summary: 'Pane is one pane. See [Server.Pane].' },
      { id: 'tmux.PaneID', name: 'PaneID', slug: 'tmux-paneid', m: 0, kind: 'struct' },
      { id: 'tmux.Server', name: 'Server', slug: 'tmux-server', m: 0, kind: 'struct', shortcut: true },
    ] },
    { id: 'workspace', label: 'Workspaces', count: 2, slug: 'tmux-ref', types: [], children: [
      { id: 'plans', label: 'Plans', count: 1, slug: 'tmux-plan', children: [], types: [{ id: 'tmux.Plan', name: 'Plan', slug: 'tmux-plan', m: 0, kind: 'struct' }] },
    ] },
  ],
  members: {
    'tmux.Pane': [
      ['Capture', 'tmux-pane-capture', 'tmux.Pane.Capture', 'method', 'members', 'Capture reads the pane.', 'tmux.Pane.Capture', 'Pane.Capture'],
      ['Window', 'tmux-pane-window', 'tmux.Pane.Window', 'method', 'members', '', 'tmux.Pane.Window', 'Pane.Window'],
    ],
  },
}

describe('the API reference hierarchy', () => {
  const source = apiSource(fixture, { base: BASE, portName: 'Go' })

  it('lists groups, then types, then members, each level in the tree inventory order', () => {
    const root = source.find(apiRootId('go'))!
    expect(source.children(root).map((n) => n.id)).toEqual(['b:pane', 'b:workspace'])
    const pane = source.find('b:pane')!
    expect(source.children(pane).map((n) => n.id)).toEqual(['sym:tmux.Pane', 'sym:tmux.PaneID'])
    expect(source.children(source.find('sym:tmux.Pane')!).map((n) => n.label)).toEqual(['Capture', 'Window'])
  })

  it('nests a bucket the way the tree nests it, and never lists a shortcut twice', () => {
    expect(source.children(source.find('b:workspace')!).map((n) => n.id)).toEqual(['b:plans'])
    expect(source.find('sym:tmux.Server')).toBeUndefined()
  })

  it('marks a type without members as a leaf and gives each declaration its page', () => {
    expect(source.find('sym:tmux.PaneID')).toMatchObject({ leaf: true, href: `${BASE}tmux-paneid/` })
    expect(source.find('sym:tmux.Pane')).toMatchObject({ leaf: false, count: 2 })
    expect(source.find('sym:tmux.Pane.Capture')).toMatchObject({ leaf: true, href: `${BASE}tmux-pane-capture/`, kind: 'method' })
  })

  it('walks a member six levels below nothing: root, group, type, member', () => {
    const path = pathTo(source, source.find('sym:tmux.Pane.Capture'))
    expect(path.map((n) => n.id)).toEqual([apiRootId('go'), 'b:pane', 'sym:tmux.Pane', 'sym:tmux.Pane.Capture'])
    expect(listCount(path)).toBe(3)
  })

  it('resolves only ids it produces, a group by its label too, and a declaration by its page path', () => {
    expect(source.find('sym:nope')).toBeUndefined()
    expect(source.find('b:Pane')?.id).toBe('b:pane')
    expect(source.nodeForHref(`${BASE}tmux-pane-capture/`)?.id).toBe('sym:tmux.Pane.Capture')
    expect(source.nodeForHref(`https://libtmux.org${BASE}tmux-pane/#api-members`)?.id).toBe('sym:tmux.Pane')
    expect(source.nodeForHref(BASE)?.id).toBe(apiRootId('go'))
  })

  it('reads doc summaries as plain text', () => {
    expect(plainSummary('Pane is one pane. See [Server.Pane].')).toBe('Pane is one pane. See Server.Pane.')
    expect(plainSummary('Returns {@link Pane#id}, a `String`.')).toBe('Returns Pane#id, a String.')
    expect(source.find('sym:tmux.Pane')!.summary).toBe('Pane is one pane. See Server.Pane.')
  })
})
