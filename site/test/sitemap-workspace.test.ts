import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AstroIntegration } from 'astro'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { sitemapOptions } = vi.hoisted(() => ({
  sitemapOptions: {
    filter: undefined as ((page: string) => boolean) | undefined,
    integration: undefined as AstroIntegration | undefined,
  },
}))

vi.mock('@astrojs/sitemap', async (importOriginal) => {
  const { default: sitemap } = await importOriginal<typeof import('@astrojs/sitemap')>()
  return {
    default: (options: { filter: (page: string) => boolean }) => {
      sitemapOptions.filter = options.filter
      sitemapOptions.integration = sitemap(options)
      return sitemapOptions.integration
    },
  }
})

beforeAll(async () => {
  vi.stubEnv('LIBTMUX_DOCS_IS_DEFAULT', 'true')
  vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  vi.stubEnv('LIBTMUX_DOCS_VERSION_KIND', 'trunk')
  await import('../astro.config')
  expect(sitemapOptions.filter).toBeTypeOf('function')
})

afterAll(() => vi.unstubAllEnvs())

const includes = (port: string, path: string) =>
  sitemapOptions.filter!(`https://libtmux.org/en/${port}/latest/workspace/${path}/`)

describe('canonical workspace sitemap routes', () => {
  it.each(['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift', 'ruby'])(
    'includes real %s Guides and Examples pages', (port) => {
      expect(includes(port, 'guides')).toBe(true)
      expect(includes(port, 'examples')).toBe(true)
    },
  )

  it.each(['ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'])(
    'excludes retired %s Topics and API routes', (port) => {
      expect(includes(port, 'topics')).toBe(false)
      expect(includes(port, 'api/builder')).toBe(false)
      expect(includes(port, 'internals/topics')).toBe(true)
    },
  )

  it.each(['lua', 'kotlin', 'scala', 'fsharp'])(
    'does not invent shared %s browse pages', (port) => {
      expect(includes(port, 'guides')).toBe(false)
      expect(includes(port, 'examples')).toBe(false)
    },
  )

  it('retains the published Python and Ruby Topics pages', () => {
    expect(includes('py', 'topics')).toBe(true)
    expect(includes('ruby', 'topics')).toBe(true)
  })

  it('writes canonical browse URLs through the configured sitemap integration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'workspace-sitemap-'))
    const hooks = sitemapOptions.integration!.hooks
    const run = async (name: keyof typeof hooks, value: unknown) => {
      await (hooks[name] as (input: unknown) => unknown)(value)
    }
    const kept = ['ts/latest/workspace/guides/', 'go/latest/workspace/examples/', 'py/stable/workspace/guides/', 'ruby/latest/workspace/topics/']
    const omitted = ['ts/latest/workspace/topics/', 'go/latest/workspace/api/builder/', 'lua/latest/workspace/guides/', 'kotlin/latest/workspace/examples/']
    try {
      await run('astro:config:done', { config: { site: 'https://libtmux.org', base: '/en/', trailingSlash: 'always', build: { format: 'directory' } } })
      await run('astro:routes:resolved', { routes: [] })
      await run('astro:build:done', {
        dir: pathToFileURL(`${dir}/`), pages: [...kept, ...omitted].map((pathname) => ({ pathname })),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      })
      const xml = await readFile(join(dir, 'sitemap-0.xml'), 'utf8')
      expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]).sort())
        .toEqual(kept.map((path) => `https://libtmux.org/en/${path}`).sort())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
