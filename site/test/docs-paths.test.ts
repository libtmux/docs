import { describe, expect, it } from 'vitest'
import { docsPath, docsRoutePath } from '../src/lib/docs-paths'

const pythonGuide = { id: 'ports/py/workspace/guides', data: { port: 'py', product: 'workspace' } }

describe('product document URLs', () => {
  it('uses the same path in root and per-port builds', () => {
    expect(docsRoutePath(pythonGuide, undefined, { py: 'stable' })).toBe('py/stable/workspace/guides')
    expect(docsRoutePath(pythonGuide, 'py')).toBe('workspace/guides')
    expect(docsPath(pythonGuide)).toBe('workspace/guides')
  })

  it('keeps shared core routes and rejects malformed product identities', () => {
    expect(docsRoutePath({ id: 'guides/queries', data: {} }, 'ts')).toBe('guides/queries')
    expect(() => docsPath({ ...pythonGuide, id: 'ports/ts/workspace/guides' })).toThrow('Invalid product document id')
  })
})
