import { describe, expect, it, vi } from 'vitest'
import { boostExactMembers, leafOf, nameWords, namesMember, RANK_WINDOW } from '../src/lib/search-rank'

const result = (id: string, title: string, owner?: string) => ({
  id,
  data: vi.fn(async () => ({ meta: { title, owner } })),
})

describe('naming a member by its owner and its name', () => {
  it('reads the words of a name or a query the way a reader says them', () => {
    expect(nameWords('CapturePaneRequest')).toEqual(['capture', 'pane', 'request'])
    expect(nameWords('Pane.Capture')).toEqual(['pane', 'capture'])
    expect(nameWords('new_session')).toEqual(['new', 'session'])
    expect(nameWords('HTTPServer')).toEqual(['http', 'server'])
    expect(leafOf('Pane.Capture', 'Pane')).toBe('Capture')
    expect(leafOf('open!', 'libtmux.core')).toBe('open!')
  })

  it('takes the owner and the name together as exactly the words of the query', () => {
    const query = nameWords('capture pane')
    expect(namesMember(query, 'Pane', 'Capture')).toBe(true)
    expect(namesMember(nameWords('Pane.Capture'), 'Pane', 'Capture')).toBe(true)
    expect(namesMember(query, 'Pane', 'CaptureBytes')).toBe(false)
    expect(namesMember(query, 'CapturePaneRequest', 'End')).toBe(false)
    expect(namesMember(nameWords('capture'), 'Pane', 'Capture')).toBe(false)
  })
})

describe('moving an exact member to the front', () => {
  const list = () => [
    result('a', 'CapturePaneRequest.End', 'CapturePaneRequest'),
    result('b', 'CapturePaneRequest'),
    result('c', 'Pane.CaptureBytes', 'Pane'),
    result('d', 'Pane.Capture', 'Pane'),
  ]
  const order = (found: { id: string }[]) => found.map((item) => item.id)

  it('puts Pane.Capture first for "capture pane" and keeps Pagefind\'s order for the rest', async () => {
    expect(order(await boostExactMembers('capture pane', list()))).toEqual(['d', 'a', 'b', 'c'])
    expect(order(await boostExactMembers('Pane.Capture', list()))).toEqual(['d', 'a', 'b', 'c'])
  })

  it('leaves a one-word query alone and reads nothing', async () => {
    const found = list()
    expect(order(await boostExactMembers('capture', found))).toEqual(['a', 'b', 'c', 'd'])
    expect(found.every((item) => item.data.mock.calls.length === 0)).toBe(true)
  })

  it('reads each result once, so painting it does not fetch it again', async () => {
    const found = list()
    const [first] = await boostExactMembers('capture pane', found)
    await first!.data()
    expect(found[3]!.data).toHaveBeenCalledTimes(1)
  })

  it('reads only the window and appends what lies beyond it', async () => {
    const many = Array.from({ length: RANK_WINDOW + 5 }, (_, i) => result(`r${i}`, `Other.Item${i}`, 'Other'))
    many.push(result('late', 'Pane.Capture', 'Pane'))
    const found = await boostExactMembers('capture pane', many)
    expect(order(found).at(-1)).toBe('late')
    expect(many.at(-1)!.data).not.toHaveBeenCalled()
    expect(many[0]!.data).toHaveBeenCalledOnce()
  })

  it('keeps a result whose data fails to load', async () => {
    const broken = { id: 'x', data: vi.fn(async () => { throw new Error('fragment') }) }
    expect(order(await boostExactMembers('capture pane', [broken, result('d', 'Pane.Capture', 'Pane')]))).toEqual(['d', 'x'])
  })
})
