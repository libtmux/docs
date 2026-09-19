import { describe, expect, it } from 'vitest'
import { parseSlots, resolvePortBody, resolvePortData, resolveSlots } from '../src/lib/workspace-shared-slots'

describe('workspace-shared slots', () => {
  it('keeps unmarked text and a matching port, drops a non-matching one', () => {
    const raw = 'shared\n<!-- port:go -->\ngo only\n<!-- /port -->\nafter'
    expect(resolvePortBody(raw, 'go')).toBe('shared\n\ngo only\n\nafter')
    expect(resolvePortBody(raw, 'ts')).toBe('shared\n\nafter')
  })

  it('resolves nested blocks against the innermost matching scope', () => {
    const raw = '<!-- port:go,ts -->outer<!-- port:go -->-go<!-- /port --><!-- /port -->'
    expect(resolveSlots(parseSlots(raw), 'go')).toBe('outer-go')
    expect(resolveSlots(parseSlots(raw), 'ts')).toBe('outer')
    expect(resolveSlots(parseSlots(raw), 'py')).toBe('')
  })

  // Negative control: a real page authoring mistake (a typo'd port slug)
  // must fail the build, not render silently as "no ports match".
  it('rejects an unknown port slug instead of silently dropping the block', () => {
    expect(() => parseSlots('<!-- port:golang -->x<!-- /port -->')).toThrow(/unknown port/)
  })

  it('rejects an unclosed or unopened block', () => {
    expect(() => parseSlots('<!-- port:go -->unterminated')).toThrow(/unclosed/)
    expect(() => parseSlots('<!-- /port -->')).toThrow(/no open/)
  })
})

describe('workspace-shared frontmatter merge', () => {
  it('layers a port override over shared defaults and stamps port/product', () => {
    const frontmatter = { title: 'Shared title', ports: { go: { title: 'Go title' } } }
    expect(resolvePortData(frontmatter, 'go', 'workspace')).toEqual({ title: 'Go title', port: 'go', product: 'workspace' })
    expect(resolvePortData(frontmatter, 'ts', 'workspace')).toEqual({ title: 'Shared title', port: 'ts', product: 'workspace' })
  })
})
