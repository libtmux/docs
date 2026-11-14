import { describe, expect, it } from 'vitest'
import { leaves } from '../src/lib/panels/layout'
import { planWorkspace } from '../src/lib/panels/plan'
import { activeTab, clone, closePanel, fromTemplate, go, isStale, openResource, partners, resync, setLink, step, violations, type Workspace } from '../src/lib/panels/state'

const KNOWN = new Set(['capture-pane', 'send-keys', 'split-window', 'kill-pane'])
const known = (loc: string) => KNOWN.has(loc)
const loc = (ws: Workspace, id: string) => activeTab(ws.panels[id]!).loc
const ui = { railPinned: true, fullWidth: false }

describe('linked panels', () => {
  it('a driving panel moves its set and every unlocked panel in it; a follower never moves the set', () => {
    const ws = fromTemplate('study')
    expect(go(ws, 'p1', 'send-keys', known)).toMatchObject({ ok: true, moved: ['p2', 'p3'] })
    expect([loc(ws, 'p1'), loc(ws, 'p2'), loc(ws, 'p3'), loc(ws, 'p4')]).toEqual(['send-keys', 'send-keys', 'send-keys', 'capture-pane'])
    expect(ws.linkSets.A).toBe('send-keys')
    // The follower wanders alone and is stale; the set stays put.
    go(ws, 'p3', 'kill-pane', known)
    expect(ws.linkSets.A).toBe('send-keys')
    expect(loc(ws, 'p1')).toBe('send-keys')
    expect(isStale(ws, ws.panels.p3!)).toBe(true)
  })

  it('a locked panel ignores links and the set moves on without it', () => {
    const ws = fromTemplate('study')
    ws.panels.p2!.locked = true
    expect(go(ws, 'p1', 'split-window', known).moved).toEqual(['p3'])
    expect(loc(ws, 'p2')).toBe('capture-pane')
    expect(isStale(ws, ws.panels.p2!)).toBe(true)
    expect(go(ws, 'p2', 'kill-pane', known)).toMatchObject({ ok: false, reason: 'locked' })
  })

  it('Re-sync jumps a drifted panel back, relinks a panel that left, and works on a locked one', () => {
    const ws = fromTemplate('study')
    setLink(ws, 'p2', 'none')
    go(ws, 'p2', 'kill-pane', known)
    go(ws, 'p1', 'send-keys', known)
    expect(ws.panels.p2!.formerSet).toBe('A')
    expect(isStale(ws, ws.panels.p2!)).toBe(true)
    ws.panels.p2!.locked = true
    resync(ws, 'p2', known)
    expect(ws.panels.p2).toMatchObject({ linkSet: 'A', formerSet: null, locked: true })
    expect(loc(ws, 'p2')).toBe('send-keys')
    expect(isStale(ws, ws.panels.p2!)).toBe(false)
  })

  it('refuses a locator the data does not know and leaves everything where it was', () => {
    const ws = fromTemplate('compare')
    const before = clone(ws)
    expect(go(ws, 'p1', 'nope', known)).toMatchObject({ ok: false, reason: 'unknown' })
    expect(ws).toEqual(before)
  })

  it('walks one panel back and forward, and a driving panel takes its set along', () => {
    const ws = fromTemplate('compare')
    go(ws, 'p1', 'send-keys', known)
    go(ws, 'p1', 'kill-pane', known)
    step(ws, 'p1', -1, known)
    expect([loc(ws, 'p1'), loc(ws, 'p2'), ws.linkSets.A]).toEqual(['send-keys', 'send-keys', 'send-keys'])
    expect(step(ws, 'p1', 1, known)).toMatchObject({ ok: true })
    expect(loc(ws, 'p5')).toBe('kill-pane')
    expect(step(ws, 'p1', 1, known)).toBeNull()
  })

  it('joining a set takes its locator, and a panel in a new set starts it', () => {
    const ws = fromTemplate('read')
    go(ws, 'p1', 'send-keys', known)
    setLink(ws, 'p4', 'A')
    expect(loc(ws, 'p4')).toBe('send-keys')
    setLink(ws, 'p4', 'B')
    expect(ws.linkSets.B).toBe('send-keys')
    expect(partners(ws, 'p1')).toEqual([])
  })
})

describe('opening resources', () => {
  it('reuses a panel already showing the port, else adds a tab to the active panel', () => {
    const ws = fromTemplate('read')
    expect(openResource(ws, 'api:go', 'send-keys', 'policy', known)).toBe('p1')
    expect(loc(ws, 'p1')).toBe('send-keys')
    expect(openResource(ws, 'api:rs', 'send-keys', 'policy', known)).toBe('p1')
    expect(ws.panels.p1!.tabs.map((t) => t.res)).toEqual(['api:go', 'api:rs'])
    expect(activeTab(ws.panels.p1!).res).toBe('api:rs')
  })

  it('opens a new panel beside the active one and never loses the others', () => {
    const ws = fromTemplate('read')
    const id = openResource(ws, 'api:py', 'capture-pane', 'panel', known)!
    expect(leaves(ws.layoutTree)).toEqual(['p1', id, 'p4'])
    expect(violations(ws, known)).toEqual([])
  })

  it('closes a panel but never the last one', () => {
    const ws = fromTemplate('read')
    expect(closePanel(ws, 'p1')).toBe(true)
    expect(ws.activePanelId).toBe('p4')
    expect(closePanel(ws, 'p4')).toBe(false)
    expect(violations(ws, known)).toEqual([])
  })

  it('reports a broken state instead of rendering it', () => {
    const ws = fromTemplate('read')
    delete ws.panels.p4
    ws.panels.p1!.tabs[0]!.loc = 'nope'
    expect(violations(ws, known)).toEqual(['leaf p4 has no panel', 'panel p1 is at unknown nope'])
  })
})

describe('fitting panels to the width', () => {
  const widths = [320, 390, 479, 480, 767, 768, 834, 1023, 1024, 1194, 1439, 1440, 1728, 2099, 2100, 2400, 3440]

  it('never loses a panel, a tab, a locator, a set, a role or a lock at any width', () => {
    for (const template of ['read', 'compare', 'study'] as const) {
      const ws = fromTemplate(template)
      ws.panels.p1!.locked = true
      const before = clone(ws)
      const all = Object.keys(ws.panels).sort()
      for (const width of widths) {
        for (const height of [390, 844, 1117]) {
          const p = planWorkspace(ws, width, height, ui)
          const shown = p.narrow ? p.order : [...p.visible, ...p.hidden]
          expect(new Set(shown).size, `${template} ${width}x${height}`).toBe(shown.length)
          expect([...shown].sort(), `${template} ${width}x${height}`).toEqual(all)
          if (!p.narrow) {
            expect(p.visible.length).toBeLessThanOrEqual(p.cap)
            expect(Object.values(p.folded).flat().sort()).toEqual([...p.hidden].sort())
          }
        }
      }
      expect(ws).toEqual(before)
    }
  })

  it('shows one panel on a phone and two on a tablet, and restores the exact arrangement widening', () => {
    const ws = fromTemplate('study')
    expect(planWorkspace(ws, 390, 844, ui)).toMatchObject({ narrow: true, order: ['p1', 'p2', 'p3', 'p4'] })
    const medium = planWorkspace(ws, 834, 1194, ui)
    expect(medium.visible).toHaveLength(2)
    expect(medium.hidden).toHaveLength(2)
    const wide = planWorkspace(ws, 1728, 1117, ui)
    expect(wide.visible).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(wide.cap).toBe(4)
    expect(planWorkspace(ws, 1728, 1117, ui).view).toEqual(wide.view)
  })

  it('keeps the active panel and its link partners by recency, and folds the rest into the nearest region', () => {
    const ws = fromTemplate('study')
    const p = planWorkspace(ws, 834, 1194, ui)
    expect(p.visible).toEqual(['p1', 'p2'])
    expect(p.folded.p2).toEqual(['p3', 'p4'])
    // Moving the follower into focus brings it and its partners forward.
    ws.activePanelId = 'p3'
    ws.recent = ['p3', 'p2']
    expect(planWorkspace(ws, 834, 1194, ui).visible.sort()).toEqual(['p2', 'p3'])
  })

  it('collapses the sidebar to icons before folding a panel, and says so', () => {
    const ws = fromTemplate('study')
    const p = planWorkspace(ws, 1440, 900, ui)
    expect(p).toMatchObject({ railWidth: 48, railAuto: true, cap: 4 })
    expect(planWorkspace(ws, 1400, 900, ui)).toMatchObject({ railAuto: false, railWidth: 240, cap: 3 })
  })

  it('a maximized panel is the only one drawn, and Restore returns the layout', () => {
    const ws = fromTemplate('compare')
    ws.maximized = 'p2'
    const p = planWorkspace(ws, 1728, 1117, ui)
    expect(p.visible).toEqual(['p2'])
    ws.maximized = null
    expect(planWorkspace(ws, 1728, 1117, ui).visible).toEqual(['p1', 'p2', 'p5'])
  })

  it('centres at 2400 px on an ultra-wide stage unless Full width is on', () => {
    const ws = fromTemplate('study')
    expect(planWorkspace(ws, 3440, 1440, ui).workWidth).toBe(2400)
    expect(planWorkspace(ws, 3440, 1440, { ...ui, fullWidth: true }).workWidth).toBe(3440)
  })
})
