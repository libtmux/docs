import { describe, expect, it, vi } from 'vitest'

const entry = (since: string, extra = {}) => ({
  id: 'layout-json', name: 'JSON layouts', summary: 'Read a layout as JSON.', since, handling: 'refuse',
  error: 'Err', apis: ['Api'], commands: [{ command: 'select-layout' }], ...extra,
})
const port = (capability: ReturnType<typeof entry>) => ({ floor: { minimum: '3.3a' }, capabilities: [capability], workarounds: [] })

vi.mock('../src/data/capabilities.json', () => ({
  default: {
    releases: ['3.3a', '3.8-rc2', '3.8'],
    ports: {
      julia: port(entry('3.8')),
      rs: port(entry('3.8-rc2')),
      go: port(entry('3.8-rc2')),
      ts: port(entry('3.8-rc2', { id: 'agree', name: 'Agreement', commands: [{ command: 'agree' }] })),
    },
  },
}))

const { mapRows, commandRows } = await import('../src/lib/capabilities')

describe('the tmux line of a row that spans ports', () => {
  it('names each port that needs a different release, in the root map', () => {
    const row = mapRows().find((r) => r.id === 'layout-json')!
    expect(row.requirement).toBe('3.8 and later (Julia); 3.8-rc2 and later (Rust, Go)')
    // Each cell already carries its own port's release; ts has no entry for this row.
    expect(row.cells.map((c) => c.text)).toEqual(['3.8+', undefined, '3.8-rc2+', '3.8-rc2+'])
  })

  it('names them on a command page too', () => {
    const row = commandRows('select-layout').find((r) => r.id === 'layout-json')!
    expect(row.requirement).toBe('3.8 and later (Julia); 3.8-rc2 and later (Rust, Go)')
  })

  it('states one release once when every port agrees', () => {
    expect(mapRows().find((r) => r.id === 'agree')!.requirement).toBe('3.8-rc2 and later')
    expect(commandRows('agree')[0].requirement).toBe('3.8-rc2 and later')
  })
})
