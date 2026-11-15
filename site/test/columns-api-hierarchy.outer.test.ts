/**
 * The Go reference as a hierarchy. Outer loop: it loads the generated Go
 * model, which takes about ten seconds to import.
 */
import { describe, expect, it } from 'vitest'
import { apiSource } from '../src/lib/columns/api-hierarchy'
import { pathTo } from '../src/lib/columns/selection'
import { referenceTree } from '../src/lib/api-tree'

const BASE = '/en/go/latest/reference/'

describe('the Go reference hierarchy', () => {
  const source = apiSource(referenceTree('go'), { base: BASE, portName: 'Go' })

  it('is built from the Go model: Pane.Capture sits under Pane, under the Pane group', () => {
    const capture = source.find('sym:tmux.Pane.Capture')!
    expect(capture).toBeDefined()
    expect(pathTo(source, capture).map((n) => n.label)).toEqual(['API reference', 'Pane', 'Pane', 'Capture'])
  })

  it('reaches every declaration through its group, and no node repeats', () => {
    const seen = new Set<string>()
    const visit = (id: string) => {
      const node = source.find(id)!
      expect(seen.has(id)).toBe(false)
      seen.add(id)
      for (const child of source.children(node)) visit(child.id)
    }
    visit(source.root)
    expect(seen.size).toBeGreaterThan(1000)
  })
})
