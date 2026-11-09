import { describe, expect, it } from 'vitest'
import { PORT_BY_SLUG, productAvailable, productIncluded, type Port } from '../src/lib/ports'

describe('excluded companion products', () => {
  it('does not advertise an excluded MCP implementation as available', () => {
    const port = { ...PORT_BY_SLUG.elixir, productAvailability: { mcp: 'excluded' } } as unknown as Port
    expect(productAvailable(port, 'mcp')).toBe(false)
    expect(productIncluded(port, 'mcp')).toBe(false)
    const unpublished = { ...port, productAvailability: { mcp: 'unpublished' as const } }
    expect(productAvailable(unpublished, 'mcp')).toBe(false)
    expect(productIncluded(unpublished, 'mcp')).toBe(true)
  })
})
