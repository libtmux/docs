import { describe, expect, it } from 'vitest'
import { productFromSearch, searchWithProduct } from '../src/lib/landing-selection'

describe('landing page product in the address', () => {
  it('reads a product the page offers', () => {
    expect(productFromSearch('?product=mcp', ['core', 'mcp', 'workspace'])).toBe('mcp')
    expect(productFromSearch('?errors=1&product=workspace', ['core', 'mcp', 'workspace'])).toBe('workspace')
  })

  it('ignores a product the page does not offer', () => {
    expect(productFromSearch('?product=mcp', ['core'])).toBeUndefined()
    expect(productFromSearch('?product=', ['core', 'mcp'])).toBeUndefined()
    expect(productFromSearch('', ['core', 'mcp'])).toBeUndefined()
  })

  it('writes the choice and keeps the homepage example options', () => {
    expect(searchWithProduct('', 'mcp', 'core')).toBe('?product=mcp')
    expect(searchWithProduct('?errors=1', 'workspace', 'core')).toBe('?errors=1&product=workspace')
    expect(searchWithProduct('?errors=1&product=mcp', 'workspace', 'core')).toBe('?errors=1&product=workspace')
  })

  it('leaves the address alone for the first product', () => {
    expect(searchWithProduct('?product=mcp', 'core', 'core')).toBe('')
    expect(searchWithProduct('?cleanup=1&product=mcp', 'core', 'core')).toBe('?cleanup=1')
  })
})
