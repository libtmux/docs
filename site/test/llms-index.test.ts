import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))
import { exportsMcpContracts, llmsPage, referenceEntries } from '../src/lib/llms'
import { parseSlots } from '../src/lib/workspace-shared-slots'
import { PORTS, productAvailable } from '../src/lib/ports'
import { API_MODELS } from '../src/lib/api-models'
import { resolveCoreHome } from '../src/lib/core-home'
import type { ApiModel } from '@libtmux/api-model/reference'
import type { CollectionEntry } from 'astro:content'
import RUST_MODELS from './fixtures/rust-core-home.json'

afterEach(() => vi.unstubAllEnvs())

const origin = 'https://libtmux.org'

it.each(['native', 'release'] as const)('exports every Rust core home link from the %s source model', (source) => {
  const previous = API_MODELS.rs!
  const model = RUST_MODELS[source]
  const version = source === 'release' ? '0.1.2' : 'latest'
  vi.stubEnv('LIBTMUX_DOCS_PORT', 'rs')
  vi.stubEnv('LIBTMUX_DOCS_VERSION', version)
  try {
    API_MODELS.rs = { port: 'rs', revision: model.revision, symbols: model.symbols } as unknown as ApiModel
    const entry = { id: 'ports/rs/core/index', collection: 'docs', body: '', data: { title: 'Core library', port: 'rs', route: 'core' } } as CollectionEntry<'docs'>
    const exported = llmsPage(entry, origin, `/rs/${version}/`)
    const home = resolveCoreHome('rs', version)
    expect(exported.url).toBe(`${origin}/rs/${version}/core/`)
    for (const row of [...home.objects, ...Object.values(home.capabilities).flat()]) {
      expect(exported.body).toContain(`${origin}${row.href}`)
    }
  } finally { API_MODELS.rs = previous }
})

it('lists a port\'s root classes and modules with their first-sentence summaries', () => {
  vi.stubEnv('LIBTMUX_DOCS_PORT', 'clojure')
  vi.stubEnv('LIBTMUX_DOCS_VERSION', 'latest')
  const lines = referenceEntries(origin)
  expect(lines.length).toBeGreaterThanOrEqual(5)
  expect(lines.join('\n')).toMatch(/\[libtmux\.core\]\(https:\/\/libtmux\.org\/\S+\/libtmux-core\/\): Explicit tmux effects through open! and snapshot!\./)
  expect(lines.join('\n')).not.toContain('[[')
  vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  expect(referenceEntries(origin)).toEqual([])
})

it('mentions MCP contracts only where the port ships an MCP server', () => {
  for (const port of PORTS.filter((entry) => !entry.parentLibrary)) {
    vi.stubEnv('LIBTMUX_DOCS_PORT', port.slug)
    expect(exportsMcpContracts(), port.slug).toBe(productAvailable(port, 'mcp'))
  }
})

it('scopes the llms-full.txt row of the linking guide to the same ports', () => {
  const raw = readFileSync(new URL('../src/content/docs/meta/linking.md', import.meta.url), 'utf8')
  const regions = parseSlots(raw).children.flatMap((child) => typeof child === 'string' ? [] : [child])
  const scoped = (text: string) => regions.find((region) => region.children.some((child) => typeof child === 'string' && child.includes(text)))!
  const shipping = PORTS.filter((port) => !port.parentLibrary && productAvailable(port, 'mcp')).map((port) => port.slug)
  const without = PORTS.filter((port) => !port.parentLibrary && !productAvailable(port, 'mcp')).map((port) => port.slug)
  expect([...scoped('MCP contracts').ports!].sort()).toEqual([...shipping, 'root'].sort())
  expect([...scoped('Fetch the guides together').ports!].sort()).toEqual(without.sort())
})
