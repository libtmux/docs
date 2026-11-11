import { describe, expect, it } from 'vitest'
import type { Port } from '../src/lib/ports.ts'
import { checkoutCandidates, checkoutOverride, resolveCheckout } from '../../scripts/lib/port-checkout.mjs'

const ports = [
  { slug: 'java', repo: 'libtmux/libtmux-java', checkout: '/src/java', worktree: '/src/java-docs' },
  { slug: 'clojure', repo: 'libtmux/libtmux-java', checkout: '/src/java', worktree: '/src/java-clojure', parentLibrary: { slug: 'java', runtime: 'JVM' } },
  { slug: 'other', repo: 'libtmux/libtmux-other', checkout: '/src/other-clone', worktree: '/src/other-docs' },
] as unknown as readonly Port[]

describe('port checkout resolver', () => {
  it('prefers the port override over ports.ts', () => {
    expect(resolveCheckout('other', { ports, env: { LIBTMUX_DOCS_CHECKOUT_OTHER: '/ci/other' } })).toBe('/ci/other')
  })

  it('falls back to the worktree, then the checkout, in the order asked', () => {
    expect(checkoutCandidates('other', { ports, env: {} })).toEqual(['/src/other-docs', '/src/other-clone'])
    expect(resolveCheckout('other', { ports, env: {}, order: ['checkout'] })).toBe('/src/other-clone')
  })

  it('serves the parent from a wrapper checkout when only the wrapper is set', () => {
    const env = { LIBTMUX_DOCS_CHECKOUT_CLOJURE: '/ci/java' }
    expect(resolveCheckout('java', { ports, env })).toBe('/ci/java')
    expect(checkoutOverride('other', { ports, env })).toBeUndefined()
  })

  it('lets an explicit parent override win over the wrapper', () => {
    const env = { LIBTMUX_DOCS_CHECKOUT_CLOJURE: '/ci/clojure', LIBTMUX_DOCS_CHECKOUT_JAVA: '/ci/java' }
    expect(resolveCheckout('java', { ports, env })).toBe('/ci/java')
    expect(resolveCheckout('clojure', { ports, env })).toBe('/ci/clojure')
  })
})

describe('call sites use the resolver', () => {
  it('serves tmux-usage scans of the parent from the only checkout a wrapper leg has', async () => {
    const { checkoutFor } = await import('../../scripts/gen-tmux-usage.mjs')
    const { PORT_BY_SLUG } = await import('../src/lib/ports.ts')
    const before = process.env.LIBTMUX_DOCS_CHECKOUT_CLOJURE
    const javaBefore = process.env.LIBTMUX_DOCS_CHECKOUT_JAVA
    delete process.env.LIBTMUX_DOCS_CHECKOUT_JAVA
    process.env.LIBTMUX_DOCS_CHECKOUT_CLOJURE = '/ci/java-only'
    try {
      expect(checkoutFor(PORT_BY_SLUG.java)).toBe('/ci/java-only')
    } finally {
      if (before === undefined) delete process.env.LIBTMUX_DOCS_CHECKOUT_CLOJURE
      else process.env.LIBTMUX_DOCS_CHECKOUT_CLOJURE = before
      if (javaBefore !== undefined) process.env.LIBTMUX_DOCS_CHECKOUT_JAVA = javaBefore
    }
  })
})
