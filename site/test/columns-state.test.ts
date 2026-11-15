import { describe, expect, it } from 'vitest'
import { API_COLUMN_DEFAULTS, configCall, mergeColumns } from '../src/lib/columns/config'
import { intentFor, type KeyContext } from '../src/lib/columns/keys'
import { matching, moveIndex, pageOf, pageRows, pageSpan, virtualWindow, withHeadings } from '../src/lib/columns/list-window'
import { backTarget, discardedColumns, inScope, listCount, listFor, pathTo, singleBack, singleInto, singleSelect, singleUp, type SingleState } from '../src/lib/columns/selection'
import { parseUrlState, serializeUrlState } from '../src/lib/columns/url-state'
import type { ColumnNode, ColumnSource } from '../src/lib/columns/types'

function tree(): ColumnSource {
  const nodes = new Map<string, ColumnNode>()
  const kids = new Map<string, ColumnNode[]>()
  const add = (id: string, parent: string | undefined, leaf: boolean, children: string[] = []) => {
    const node: ColumnNode = { id, label: id.toUpperCase(), kind: leaf ? 'leaf' : 'node', parent, leaf }
    nodes.set(id, node)
    kids.set(id, children.map((c) => ({ id: c } as ColumnNode)))
  }
  add('root', undefined, false, ['g1', 'g2'])
  add('g1', 'root', false, ['t1', 't2'])
  add('g2', 'root', false, [])
  add('t1', 'g1', false, ['m1', 'm2'])
  add('t2', 'g1', true)
  add('m1', 't1', true)
  add('m2', 't1', true)
  for (const [id, list] of kids) kids.set(id, list.map((c) => nodes.get(c.id)!))
  return { root: 'root', find: (id) => nodes.get(id), children: (n) => kids.get(n.id) ?? [] }
}

describe('selection and truncation', () => {
  const src = tree()
  it('walks the path from the root and rejects ids outside the scope', () => {
    expect(pathTo(src, src.find('m2')).map((n) => n.id)).toEqual(['root', 'g1', 't1', 'm2'])
    expect(inScope(src, 'nope')).toBeUndefined()
    expect(inScope(src, null)).toBeUndefined()
  })

  it('counts lists as the path less a leaf', () => {
    expect(listCount(pathTo(src, src.find('m2')))).toBe(3)
    expect(listCount(pathTo(src, src.find('t1')))).toBe(3)
  })

  it('discards the columns at or beyond the new selection, and always the preview', () => {
    expect(discardedColumns([0, 1, 2, null], 2)).toEqual([2, null])
    expect(discardedColumns([0, 1], 3)).toEqual([])
  })

  it('names the list variant F shows for a node', () => {
    expect(listFor(src, src.find('m1')!)).toBe('t1')
    expect(listFor(src, src.find('t1')!)).toBe('t1')
    expect(listFor(src, src.find('root')!)).toBe('root')
  })
})

describe('variant F: Up and Back are different', () => {
  const src = tree()
  const start: SingleState = { at: 'm1', list: 't1', hist: [] }

  it('Up climbs a level and keeps the level just left highlighted', () => {
    const up = singleUp(src, start)!
    expect(up).toMatchObject({ at: 't1', list: 'g1' })
    expect(singleUp(src, { at: 'root', list: 'root', hist: [] })).toBeNull()
  })

  it('after Up then a sibling, Up goes higher still while Back undoes the sibling', () => {
    const up = singleUp(src, start)!
    const sibling = singleSelect(up, 't2', up.list)
    const higher = singleUp(src, sibling)!
    expect(higher).toMatchObject({ at: 'g1', list: 'root' })
    const back = singleBack(sibling, () => true)!
    expect(back).toMatchObject({ at: 't1', list: 'g1' })
    expect(back.hist).toHaveLength(sibling.hist.length - 1)
  })

  it('moves into an item with children, and refuses a leaf', () => {
    const at: SingleState = { at: 't1', list: 'g1', hist: [] }
    expect(singleInto(src, at, 't1')).toMatchObject({ at: 't1', list: 't1' })
    expect(singleInto(src, at, 't2')).toBeNull()
  })

  it('records nothing for a reselect, skips stale entries, and names where Back returns', () => {
    expect(singleSelect(start, 'm1', 't1').hist).toEqual([])
    const s = singleSelect(start, 'm2', 't1')
    expect(backTarget(src, s)?.id).toBe('m1')
    const stale = { ...s, hist: [{ at: 'gone', list: 'gone' }, ...s.hist] }
    expect(singleBack(stale, (id) => src.find(id) !== undefined)).toMatchObject({ at: 'm1' })
    expect(singleBack({ at: 'm1', list: 't1', hist: [] }, () => true)).toBeNull()
  })

  it('keeps the last fifty positions', () => {
    let s = start
    for (let i = 0; i < 80; i++) s = singleSelect(s, i % 2 ? 'm1' : 'm2', 't1')
    expect(s.hist.length).toBe(50)
  })
})

describe('keyboard map', () => {
  const base: KeyContext = { variant: 'c', surface: 'columns', pane: true, hasChildren: true, leaf: false, hasParentColumn: true, tools: false }
  const key = (k: string, ctx: Partial<KeyContext> = {}, alt = false) => intentFor({ key: k, altKey: alt }, { ...base, ...ctx })

  it('moves within a column, and Home and End jump', () => {
    expect(key('ArrowDown')).toEqual({ kind: 'move', move: 'next' })
    expect(key('ArrowUp')).toEqual({ kind: 'move', move: 'prev' })
    expect(key('Home')).toEqual({ kind: 'move', move: 'first' })
    expect(key('End')).toEqual({ kind: 'move', move: 'last' })
  })

  it('Right opens the next level, Left returns to the parent column', () => {
    expect(key('ArrowRight')).toEqual({ kind: 'child' })
    expect(key('ArrowRight', { leaf: true, hasChildren: false })).toBeNull()
    expect(key('ArrowLeft')).toEqual({ kind: 'parent' })
    expect(key('ArrowLeft', { hasParentColumn: false })).toBeNull()
  })

  it('Enter in C opens the page and Escape closes it', () => {
    expect(key('Enter')).toEqual({ kind: 'open-pane' })
    expect(key('Escape')).toEqual({ kind: 'close-pane' })
    expect(key('Escape', { pane: false })).toBeNull()
    expect(key('Enter', { variant: 'a' })).toEqual({ kind: 'child' })
  })

  it('Page Down and Page Up move a page of rows only with column tools', () => {
    expect(key('PageDown')).toBeNull()
    expect(key('PageDown', { tools: true })).toEqual({ kind: 'move', move: 'page-next' })
    expect(key('PageUp', { tools: true })).toEqual({ kind: 'move', move: 'page-prev' })
  })

  it('F: Right or Enter go into an item, Left goes up, Backspace and Alt+Left go back', () => {
    const f: Partial<KeyContext> = { variant: 'f', surface: 'single' }
    expect(key('ArrowRight', f)).toEqual({ kind: 'into' })
    expect(key('Enter', f)).toEqual({ kind: 'into' })
    expect(key('Enter', { ...f, leaf: true, hasChildren: false })).toEqual({ kind: 'focus-page' })
    expect(key('ArrowLeft', f)).toEqual({ kind: 'up' })
    expect(key('ArrowLeft', f, true)).toEqual({ kind: 'history' })
    expect(key('Backspace', f)).toEqual({ kind: 'history' })
  })

  it('phones: Left or Backspace goes back, Escape goes back', () => {
    const s: Partial<KeyContext> = { surface: 'stack' }
    expect(key('ArrowLeft', s)).toEqual({ kind: 'back' })
    expect(key('Backspace', s)).toEqual({ kind: 'back' })
    expect(key('Escape', s)).toEqual({ kind: 'back' })
    expect(key('Enter', s)).toEqual({ kind: 'open' })
  })

  it('tree: Right expands, Left collapses, Enter selects', () => {
    const t: Partial<KeyContext> = { variant: 'e', surface: 'tree' }
    expect(key('ArrowRight', t)).toEqual({ kind: 'expand' })
    expect(key('ArrowLeft', t)).toEqual({ kind: 'collapse' })
    expect(key('Enter', t)).toEqual({ kind: 'select' })
  })

  it('leaves browser shortcuts alone', () => {
    expect(intentFor({ key: 'ArrowLeft', metaKey: true }, base)).toBeNull()
  })
})

describe('filter, pages and the virtual window', () => {
  const items = Array.from({ length: 175 }, (_, i) => ({ label: `item${i}`, group: i < 100 ? 'Owners' : 'Queries' }))

  it('filters labels case-insensitively within one column', () => {
    expect(matching(items, 'ITEM17').map((i) => i.label)).toEqual(['item17', 'item170', 'item171', 'item172', 'item173', 'item174'])
    expect(matching(items, '  ')).toHaveLength(175)
  })

  it('pages rows and repeats a heading at the top of a page that opens inside a group', () => {
    const page = pageRows(items, 2, 50)
    expect(page[0]).toEqual({ group: 'Queries' })
    expect(page).toHaveLength(51)
    expect(page.filter((r) => r.group).length).toBe(1)
    expect(pageRows(items, 1, 50).filter((r) => r.group).map((r) => r.group)).toEqual(['Owners'])
    expect(pageRows(items, 1, 60).filter((r) => r.group).map((r) => r.group)).toEqual(['Owners', 'Queries'])
  })

  it('reports the span and clamps the page', () => {
    expect(pageSpan(175, 3, 50)).toEqual({ from: 151, to: 175, total: 175 })
    expect(pageSpan(175, 99, 50).from).toBe(151)
    expect(pageSpan(0, 0, 50)).toEqual({ from: 0, to: 0, total: 0 })
    expect(pageOf(120, 50)).toBe(2)
  })

  it('numbers matches across headings', () => {
    const rows = withHeadings(items.slice(95, 105))
    expect(rows.find((r) => r.node?.label === 'item100')!.pos).toBe(5)
  })

  it('renders the rows in view plus six either side, and spacers keep the scroll height', () => {
    const w = virtualWindow(175, 640, 560)
    expect(w).toMatchObject({ start: 14, end: 44 })
    expect(w.before + (w.end - w.start) * 32 + w.after).toBe(175 * 32)
    expect(virtualWindow(10, 0, 560)).toMatchObject({ start: 0, end: 10, before: 0, after: 0 })
  })

  it('moves a selection by one, to the edges, and by a page', () => {
    expect(moveIndex(10, 175, 'page-next', 50)).toBe(60)
    expect(moveIndex(170, 175, 'page-next', 50)).toBe(174)
    expect(moveIndex(3, 175, 'page-prev', 50)).toBe(0)
    expect(moveIndex(-1, 5, 'next', 50)).toBe(0)
    expect(moveIndex(-1, 5, 'last', 50)).toBe(4)
    expect(moveIndex(0, 0, 'next', 50)).toBe(-1)
  })
})

describe('address state', () => {
  const defaults = { view: 'tree' as const, variant: 'c' as const, columns: API_COLUMN_DEFAULTS }

  it('reads every parameter and ignores values it does not know', () => {
    const s = parseUrlState('?view=columns&variant=f&at=sym:tmux.Pane.Capture&search=open&paginate=1&pagesize=25&virtual=0&filter=bottom&width=720')
    expect(s).toMatchObject({ view: 'columns', variant: 'f', at: 'sym:tmux.Pane.Capture', width: '720',
      columns: { search: 'open', paginate: true, pageSize: 25, virtual: false, filterAt: 'bottom' } })
    expect(parseUrlState('?view=x&variant=z&search=loud&paginate=2&pagesize=30&virtual=x&filter=left&width=999')).toEqual({ columns: {} })
    expect(parseUrlState('?variant=b', ['c', 'f']).variant).toBeUndefined()
  })

  it('writes only what differs from the defaults and keeps other parameters', () => {
    expect(serializeUrlState('?theme=dark', { view: 'columns', variant: 'c', columns: API_COLUMN_DEFAULTS }, defaults)).toBe('?theme=dark&view=columns')
    const c = { ...API_COLUMN_DEFAULTS, search: 'open' as const, paginate: true, pageSize: 25, virtual: false, filterAt: 'bottom' as const }
    const out = new URLSearchParams(serializeUrlState('', { view: 'columns', variant: 'f', at: 'sym:a.B', columns: c }, defaults))
    expect(Object.fromEntries(out)).toEqual({ view: 'columns', variant: 'f', at: 'sym:a.B', search: 'open', paginate: '1', pagesize: '25', virtual: '0', filter: 'bottom' })
  })

  it('removes a parameter that returns to its default', () => {
    expect(serializeUrlState('?view=columns&search=open', { view: 'tree', columns: API_COLUMN_DEFAULTS }, defaults)).toBe('')
  })
})

describe('configuration', () => {
  it('ignores invalid patches and writes the call that reproduces the settings', () => {
    const c = mergeColumns(API_COLUMN_DEFAULTS, { search: 'open', pageSize: 30, paginate: 'yes', virtual: false })
    expect(c).toEqual({ ...API_COLUMN_DEFAULTS, search: 'open', virtual: false })
    expect(configCall('single', c)).toBe("mountApiColumns(root, { layout: 'single', columns: { search: 'open', paginate: false, pageSize: 50, virtual: false, filterAt: 'top' } })")
  })
})
