import { describe, expect, it } from 'vitest'
import { docsPath, docsRedirects, docsRoutePath, workspaceRedirectPath } from '../src/lib/docs-paths'

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

  it('uses an explicit staged source-guide route and projects its aliases through versions', () => {
    const staged = {
      id: '_staged/ruby/ownership/index',
      data: {
        port: 'ruby',
        route: 'guides/ownership-errors',
        aliases: ['guides/source/ownership-errors'],
      },
    }
    expect(docsPath(staged)).toBe('guides/ownership-errors')
    expect(docsRoutePath(staged, undefined, { ruby: 'latest' })).toBe('ruby/latest/guides/ownership-errors')
    expect(docsRoutePath(staged, 'ruby', { ruby: 'latest' })).toBe('guides/ownership-errors')
    expect(docsRedirects([staged], undefined, { ruby: 'latest' })).toEqual([
      {
        path: 'ruby/latest/guides/source/ownership-errors',
        target: 'ruby/latest/guides/ownership-errors',
      },
    ])
  })

  it('rejects aliases that collide with a canonical route or a reserved route', () => {
    const canonical = { id: 'guides/core', data: { port: 'ruby', route: 'guides/core' } }
    const staged = { id: '_staged/ruby/core/index', data: { port: 'ruby', route: 'guides/overview', aliases: ['guides/core'] } }
    expect(() => docsRedirects([canonical, staged], undefined, { ruby: 'latest' })).toThrow('alias collides')
    expect(() => docsRedirects([staged], undefined, { ruby: 'latest' }, ['ruby/latest/mcp'])).not.toThrow()
    expect(() => docsRedirects([staged], undefined, { ruby: 'latest' }, ['ruby/latest/guides/core'])).toThrow('reserved route')
  })

  it('filters legacy aliases according to published pages, independently of CLI availability', () => {
    const nativePages = new Set(['workspace/guides/installation', 'workspace/examples/gallery'])
    for (const path of ['workspace/guides/automation/', 'workspace/examples/gallery/', 'workspace/cli/load/']) {
      expect(workspaceRedirectPath(path, nativePages), path).toBe(false)
    }
    expect(workspaceRedirectPath('workspace/guides/', nativePages)).toBe(true)
    expect(workspaceRedirectPath('workspace/guides/', new Set(['workspace/guides']))).toBe(false)
    expect(workspaceRedirectPath('workspace/api/builder/', nativePages)).toBe(true)
    expect(workspaceRedirectPath('workspace/api/builder/', new Set(['workspace/api/builder']))).toBe(false)
  })
})
